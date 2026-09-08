// Interpret the same Effect trees with async handlers, supporting mixed Task
// and AsyncTask nodes and reusing synchronous merge and failure semantics.

import * as Darkcore from '../darkcore.js';
import { ResultOps, Ok, Err, type Result } from '../result.js';
import { Focus } from '../focus.js';
import { Task } from '../task.js';
import { AsyncTask } from '../async-task.js';
import { Parallel } from '../parallel.js';
import { Branch } from '../branch.js';
import { Rescue, RescueBlock, Catch } from '../rescue.js';
import type { BerylxNode } from '../node.js';
import { build, TASK, PARALLEL, BRANCH, RESCUE, RECOVER } from './index.js';
import {
  decodeResult,
  decodeTaskPayload,
  decodeParallelPayload,
  decodeBranchPayload,
  decodeRescuePayload,
  decodeRecoverPayload,
  type TaskPayload,
} from './payload.js';
import {
  parallelHandleFailures,
  parallelMerge,
  branchMatches,
  rescueFailed,
} from './combinators.js';
import { Perform } from '../perform.js';

export type AsyncAroundWrapper = (
  tag: string,
  payload: unknown,
  inner: Darkcore.AsyncHandlerMap[string],
) => unknown | Promise<unknown>;

/**
 * Create handlers for Task, AsyncTask, and asynchronous combinators. Subtrees
 * and recovery inherit the supplied subtree map, or this map itself.
 */
export function asyncRealHandlers(
  effects: Darkcore.AsyncHandlerMap = {},
  subtree?: Darkcore.AsyncHandlerMap,
): Darkcore.AsyncHandlerMap {
  // Read live bindings at call time because index.ts participates in a circular import.
  const reservedTags = [TASK, PARALLEL, BRANCH, RESCUE, RECOVER];
  const collisions = Object.keys(effects).filter((tag) =>
    reservedTags.includes(tag),
  );
  if (collisions.length > 0) {
    throw new Error(`effect tags collide with berylx tags: ${JSON.stringify(collisions)}`);
  }

  const handlers: Darkcore.AsyncHandlerMap = {};
  const current = () => subtree ?? handlers;
  handlers[TASK] = (payload) =>
    asyncRealTask(decodeTaskPayload(payload), current());
  handlers[PARALLEL] = (payload) => {
    const [node, focus] = decodeParallelPayload(payload);
    return runParallelAsync(node, focus, current());
  };
  handlers[BRANCH] = (payload) => {
    const [node, focus] = decodeBranchPayload(payload);
    return runBranchAsync(node, focus, current());
  };
  handlers[RESCUE] = (payload) => {
    const [node, focus] = decodeRescuePayload(payload);
    return runRescueAsync(node, focus, current());
  };
  handlers[RECOVER] = (payload) => {
    const [node, errorResult] = decodeRecoverPayload(payload);
    return realRecoverAsync(node, errorResult, current());
  };
  Object.assign(handlers, effects);
  return handlers;
}

/** Wrap async handlers and propagate the wrapped map to subtrees and recovery. */
export function aroundAsync(
  effects: Darkcore.AsyncHandlerMap = {},
  wrapper?: AsyncAroundWrapper,
): Darkcore.AsyncHandlerMap {
  if (!wrapper) {
    throw new Error('aroundAsync requires a wrapper');
  }

  const wrapped: Darkcore.AsyncHandlerMap = {};
  const base = asyncRealHandlers(effects, wrapped);
  for (const [tag, handler] of Object.entries(base)) {
    wrapped[tag] = (payload) => wrapper(tag, payload, handler);
  }
  return wrapped;
}

/** Interpret a workflow asynchronously and return its berylx result. */
export function runAsync(
  node: BerylxNode,
  focus: unknown,
  handlers: Darkcore.AsyncHandlerMap = asyncRealHandlers(),
): Promise<Result> {
  return Darkcore.foldAsync(build(node, ResultOps.coerceFocus(focus)), (x) => x, handlers);
}

/** Interpret a subtree asynchronously using the supplied handlers. */
export function runSubtreeAsync(
  node: BerylxNode,
  focus: Focus,
  handlers: Darkcore.AsyncHandlerMap,
): Promise<Result> {
  return Darkcore.foldAsync(build(node, focus), (x) => x, handlers);
}

async function asyncRealTask(
  payload: TaskPayload,
  handlers: Darkcore.AsyncHandlerMap,
): Promise<Result> {
  const [task, focus] = payload;
  const performer = new Perform(handlers);
  if (task instanceof AsyncTask) {
    return task.callAsync(focus, task.effectful() ? performer : undefined);
  }
  return task.call(focus, task.effectful() ? performer : undefined);
}

/**
 * Start every branch concurrently and wait for all to settle. Rethrow the first
 * rejection in branch order, regardless of its type. When none rejects, apply
 * the same failure and merge rules as the synchronous interpreter.
 */
export async function runParallelAsync(
  node: Parallel,
  focus: Focus,
  handlers: Darkcore.AsyncHandlerMap,
): Promise<Result> {
  const settled = await Promise.allSettled(
    node.branches.map((branch) => runSubtreeAsync(branch, focus, handlers)),
  );
  const branchResults = settled.map((entry) => {
    if (entry.status === 'rejected') {
      throw entry.reason;
    }
    return entry.value;
  });
  const failures = branchResults.filter((r): r is Err => r instanceof Err);

  if (failures.length > 0) {
    return parallelHandleFailures(node, focus, failures);
  }

  const merged = parallelMerge(node, focus, branchResults);
  if (merged instanceof Err) {
    return merged;
  }
  return ResultOps.ok(merged);
}

/** Evaluate predicates synchronously, then run the first matching arm asynchronously. */
export async function runBranchAsync(
  node: Branch,
  focus: Focus,
  handlers: Darkcore.AsyncHandlerMap,
): Promise<Result> {
  const arm = node.arms.find((candidate) => branchMatches(candidate.predicate, focus));
  if (!arm) {
    return ResultOps.err(focus, 'no_branch_matched');
  }
  return runSubtreeAsync(arm.body, focus, handlers);
}

/** Run the body asynchronously, dispatching recovery only for Err results. */
export async function runRescueAsync(
  node: Rescue,
  focus: Focus,
  handlers: Darkcore.AsyncHandlerMap,
): Promise<Result> {
  const result = await runSubtreeAsync(node.body, focus, handlers);
  if (result instanceof Ok) {
    return result;
  }
  return dispatchRecoverAsync(node, result, handlers);
}

/** Dispatch RECOVER through the current asynchronous handler map. */
export function dispatchRecoverAsync(
  node: Rescue,
  errorResult: Err,
  handlers: Darkcore.AsyncHandlerMap,
): Promise<Result> {
  return Darkcore.foldAsync(
    Darkcore.op(RECOVER, [node, errorResult], decodeResult),
    (value) => value,
    handlers,
  );
}

/**
 * Interpret recovery with Perform for blocks and the same async handler map for
 * Task/AsyncTask subtrees. Failed recovery retains the original error in metadata.
 */
export async function realRecoverAsync(
  node: Rescue | Catch,
  errorResult: Err,
  handlers: Darkcore.AsyncHandlerMap,
): Promise<Result> {
  const recovery = node.handler;
  let handlerResult: Result;
  if (recovery instanceof RescueBlock) {
    handlerResult = recovery.call(errorResult.focus, errorResult, new Perform(handlers));
  } else {
    handlerResult = await runSubtreeAsync(recovery, errorResult.focus, handlers);
  }
  return handlerResult instanceof Err ? rescueFailed(errorResult, handlerResult) : handlerResult;
}

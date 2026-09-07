// Compile workflows into inspectable Effect trees. Handlers choose execution,
// dry-run, or other aspects; continuations provide berylx result semantics.
// Darkcore.bind only joins structure and does not interpret Ok/Err results.

import * as Darkcore from '../darkcore.js';
import { ResultOps, Ok, Err, type Result } from '../result.js';
import { Focus } from '../focus.js';
import { Task } from '../task.js';
import { AsyncTask } from '../async-task.js';
import { Sequence } from '../sequence.js';
import { Parallel } from '../parallel.js';
import { Branch } from '../branch.js';
import { Rescue, Catch } from '../rescue.js';
import type { BerylxNode } from '../node.js';
import { Perform } from '../perform.js';
import {
  decodeResult,
  decodeTaskPayload,
  decodeParallelPayload,
  decodeBranchPayload,
  decodeRescuePayload,
  decodeRecoverPayload,
  type TaskPayload,
} from './payload.js';

/** Reserved tags for dispatching berylx nodes through the effect tree. */
export const TASK = 'berylx_task';
export const PARALLEL = 'berylx_parallel';
export const BRANCH = 'berylx_branch';
export const RESCUE = 'berylx_rescue';
export const RECOVER = 'berylx_recover';

const RESERVED_TAGS = [TASK, PARALLEL, BRANCH, RESCUE, RECOVER] as const;

export type AroundWrapper = (
  tag: string,
  payload: unknown,
  inner: Darkcore.HandlerMap[string],
) => unknown;

/** A dry-run result and its task-name plan; tasks are skipped, so the result is Ok. */
export interface DryRun {
  result: Result;
  steps: string[];
}

/** A Kleisli arrow from Focus to an Effect tree. */
type Arrow = (focus: Focus) => Darkcore.Effect<Result>;

/**
 * Compile sequences through bind and other nodes into tagged effects. Payloads
 * retain inspectable [node, focus] data rather than opaque execution thunks.
 */
function compile(node: BerylxNode): Arrow {
  if (node instanceof Sequence) {
    return compileSequence(node);
  }
  if (node instanceof Task || node instanceof AsyncTask) {
    return (focus: Focus) => Darkcore.op(TASK, [node, focus], decodeResult);
  }
  if (node instanceof Parallel) {
    return (focus: Focus) => Darkcore.op(PARALLEL, [node, focus], decodeResult);
  }
  if (node instanceof Branch) {
    return (focus: Focus) => Darkcore.op(BRANCH, [node, focus], decodeResult);
  }
  if (node instanceof Rescue) {
    return (focus: Focus) => Darkcore.op(RESCUE, [node, focus], decodeResult);
  }
  if (node instanceof Catch) {
    return (focus: Focus) => Darkcore.pure(ResultOps.ok(focus));
  }
  throw new Error(
    `EffectTree supports Task / AsyncTask / Sequence / Parallel / Branch / Rescue / Catch, got ${
      (node as { constructor?: { name?: string } })?.constructor?.name ?? typeof node
    }`,
  );
}

function compileSequence(node: Sequence): Arrow {
  return (focus: Focus) =>
    node.steps.reduce<Darkcore.Effect<Result>>(
      (effect, step) => effect.bind((prev) => compileStep(step, prev)),
      Darkcore.pure(ResultOps.ok(focus)),
    );
}

/**
 * Catch can recover a preceding Err when its predicate matches; ordinary steps
 * propagate Err without running. Successful results pass through Catch unchanged.
 */
function compileStep(step: BerylxNode, prev: Result): Darkcore.Effect<Result> {
  if (step instanceof Catch) {
    return compileCatch(step, prev);
  }
  if (prev instanceof Err) {
    return Darkcore.pure(prev);
  }
  return compile(step)(prev.focus);
}

function compileCatch(step: Catch, prev: Result): Darkcore.Effect<Result> {
  if (!(prev instanceof Err) || !step.catches(prev)) {
    return Darkcore.pure(prev);
  }
  return Darkcore.op(RECOVER, [step, prev], decodeResult);
}

/** Build an Effect tree without executing tasks or effects. */
export function build(node: BerylxNode, focus: unknown): Darkcore.Effect<Result> {
  return compile(node)(ResultOps.coerceFocus(focus));
}

/**
 * Interpret a workflow with the supplied handlers, returning Ok(focus) or
 * Err(partialFocus, error). Changing handlers selects execution or other aspects.
 */
export function run(
  node: BerylxNode,
  focus: unknown,
  handlers: Darkcore.HandlerMap = realHandlers(),
): Result {
  return Darkcore.fold(build(node, focus), (x) => x, handlers);
}

/**
 * Create execution handlers for tasks and combinators. Subtrees and recovery use
 * the supplied subtree map, or this map itself, to preserve handler overrides.
 */
export function realHandlers(
  effects: Darkcore.HandlerMap = {},
  subtree?: Darkcore.HandlerMap,
): Darkcore.HandlerMap {
  const collisions = Object.keys(effects).filter((tag) =>
    (RESERVED_TAGS as readonly string[]).includes(tag),
  );
  if (collisions.length > 0) {
    throw new Error(`effect tags collide with berylx tags: ${JSON.stringify(collisions)}`);
  }

  const handlers: Darkcore.HandlerMap = {};
  const current = () => subtree ?? handlers;
  handlers[TASK] = (payload) => realTask(decodeTaskPayload(payload), current());
  handlers[PARALLEL] = (payload) => {
    const [node, focus] = decodeParallelPayload(payload);
    return runParallel(node, focus, current());
  };
  handlers[BRANCH] = (payload) => {
    const [node, focus] = decodeBranchPayload(payload);
    return runBranch(node, focus, current());
  };
  handlers[RESCUE] = (payload) => {
    const [node, focus] = decodeRescuePayload(payload);
    return runRescue(node, focus, current());
  };
  handlers[RECOVER] = (payload) => {
    const [node, errorResult] = decodeRecoverPayload(payload);
    return realRecover(node, errorResult, current());
  };
  Object.assign(handlers, effects);
  return handlers;
}

function realTask(payload: TaskPayload, handlers: Darkcore.HandlerMap): Result {
  const [task, focus] = payload;
  if (task instanceof Task) {
    return task.call(focus, task.effectful() ? new Perform(handlers) : undefined);
  }
  return task.call(focus);
}

/** Wrap all handlers and propagate the wrapped map to subtrees and recovery. */
export function around(
  effects: Darkcore.HandlerMap = {},
  wrapper?: AroundWrapper,
): Darkcore.HandlerMap {
  if (!wrapper) {
    throw new Error('around requires a wrapper');
  }

  const wrapped: Darkcore.HandlerMap = {};
  const base = realHandlers(effects, wrapped);
  for (const [tag, handler] of Object.entries(base)) {
    wrapped[tag] = (payload) => wrapper(tag, payload, handler);
  }
  return wrapped;
}

/** Interpret a subtree with the supplied handlers and return its berylx result. */
export function runSubtree(node: BerylxNode, focus: Focus, handlers: Darkcore.HandlerMap): Result {
  return Darkcore.fold(build(node, focus), (x) => x, handlers);
}

import {
  runParallel,
  runBranch,
  runRescue,
  realRecover,
  recover,
  branchMatches,
} from './combinators.js';
import { dryRun } from './dry-run.js';
import {
  runAsync,
  runSubtreeAsync,
  asyncRealHandlers,
  aroundAsync,
  runParallelAsync,
  runBranchAsync,
  runRescueAsync,
  realRecoverAsync,
} from './async.js';

export const EffectTree = {
  TASK,
  PARALLEL,
  BRANCH,
  RESCUE,
  RECOVER,
  build,
  run,
  realHandlers,
  around,
  runSubtree,
  runParallel,
  runBranch,
  runRescue,
  realRecover,
  recover,
  branchMatches,
  dryRun,
  runAsync,
  runSubtreeAsync,
  asyncRealHandlers,
  aroundAsync,
  runParallelAsync,
  runBranchAsync,
  runRescueAsync,
  realRecoverAsync,
};

export { runParallel, runBranch, runRescue, realRecover, recover, branchMatches, dryRun };
export {
  runAsync,
  runSubtreeAsync,
  asyncRealHandlers,
  aroundAsync,
  runParallelAsync,
  runBranchAsync,
  runRescueAsync,
  realRecoverAsync,
} from './async.js';

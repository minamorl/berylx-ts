// Combinator interpreters supply berylx semantics: short-circuiting, merging,
// recovery, and error context. Darkcore.bind only joins the effect-tree structure.

import * as Darkcore from '../darkcore.js';
import { ResultOps, Ok, Err, type Result } from '../result.js';
import { BerylxError } from '../error.js';
import { Focus } from '../focus.js';
import type { Parallel } from '../parallel.js';
import type { Branch, Predicate } from '../branch.js';
import type { Rescue, RescueHandler, Catch } from '../rescue.js';
import { RescueBlock } from '../rescue.js';
import { runSubtree, RECOVER, type DryRun } from './index.js';
import type { Reducer } from '../merge.js';
import { Perform } from '../perform.js';
import { ControlSignal } from '../control-signal.js';
import { decodeResult } from './payload.js';

/**
 * Run branches in declaration order in this synchronous interpreter. onErr is
 * carried in the node payload and selects failure handling after branches finish.
 */
export function runParallel(node: Parallel, focus: Focus, handlers: Darkcore.HandlerMap): Result {
  const branchResults: Result[] = [];
  const thrown: unknown[] = [];
  for (const branch of node.branches) {
    try {
      branchResults.push(runSubtree(branch, focus, handlers));
    } catch (error) {
      thrown.push(error);
    }
  }
  if (thrown.length > 0) {
    throw thrown[0];
  }
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

/** Return the first Err or collect every failure in parallelErrors, according to onErr. */
export function parallelHandleFailures(node: Parallel, focus: Focus, failures: Err[]): Result {
  if (node.onErr === 'short_circuit') {
    return failures[0];
  }
  return parallelError(focus, failures);
}

/** Merge branch focus values; convert reducer errors to Err and rethrow control signals. */
export function parallelMerge(node: Parallel, focus: Focus, branchResults: Result[]): Focus | Err {
  try {
    return branchResults
      .map((r) => (r as Ok).focus)
      .reduce<Focus>(
        (acc, branchFocus) => parallelCallReducer(node.reducer, acc, branchFocus, focus),
        focus,
      );
  } catch (e) {
    if (e instanceof ControlSignal) {
      throw e;
    }
    return ResultOps.err(focus, BerylxError.from(e, { failedNode: 'parallel', trace: ['parallel'] })) as Err;
  }
}

function parallelCallReducer(reducer: Reducer, left: Focus, right: Focus, base: Focus): Focus {
  // Three-argument reducers, including strict, also need the original focus.
  if (reducer.length === 3) {
    return (reducer as (l: Focus, r: Focus, b: Focus) => Focus)(left, right, base);
  }
  return (reducer as (l: Focus, r: Focus) => Focus)(left, right);
}

function parallelError(focus: Focus, failures: Err[]): Err {
  const primary = failures[0];
  const errors = failures.map((f) => f.error);
  const error = BerylxError.create(
    'parallel_failed',
    `${failures.length} parallel branch${failures.length === 1 ? '' : 'es'} failed`,
    {
      cause: primary.cause,
      failedNode: primary.failedNode,
      trace: [...primary.trace],
      parallelErrors: errors,
    },
  );
  return new Err(primary.focus ?? focus, error);
}

/** Run the first matching arm, or return no_branch_matched. Predicates run synchronously. */
export function runBranch(node: Branch, focus: Focus, handlers: Darkcore.HandlerMap): Result {
  const arm = node.arms.find((candidate) => branchMatches(candidate.predicate, focus));
  if (!arm) {
    return ResultOps.err(focus, 'no_branch_matched');
  }
  return runSubtree(arm.body, focus, handlers);
}

export function branchMatches(predicate: Predicate, focus: Focus): boolean {
  if (predicate.elseBranch) {
    return true;
  }
  return Boolean(predicate.block!(focus));
}

/** Run the body, dispatching recovery only for Err results. */
export function runRescue(node: Rescue, focus: Focus, handlers: Darkcore.HandlerMap): Result {
  const result = runSubtree(node.body, focus, handlers);
  if (result instanceof Ok) {
    return result;
  }
  return dispatchRecover(node, result, handlers);
}

/** Dispatch recovery through RECOVER in the current handler map. */
export function dispatchRecover(
  node: Rescue,
  errorResult: Err,
  handlers: Darkcore.HandlerMap,
): Result {
  return Darkcore.fold(
    Darkcore.op(RECOVER, [node, errorResult], decodeResult),
    (value) => value,
    handlers,
  );
}

/** Interpret recovery using the same handler map for nested effects and subtrees. */
export function realRecover(
  node: Rescue | Catch,
  errorResult: Err,
  handlers: Darkcore.HandlerMap,
): Result {
  const recovery = node.handler;
  const handlerResult =
    recovery instanceof RescueBlock
      ? recovery.call(errorResult.focus, errorResult, new Perform(handlers))
      : runSubtree(recovery, errorResult.focus, handlers);
  return handlerResult instanceof Err ? rescueFailed(errorResult, handlerResult) : handlerResult;
}

/**
 * Apply a recovery block to the error and focus, or call a recovery node with the
 * focus. A failing node handler retains the original error in its metadata.
 */
export function recover(handler: RescueHandler, errorResult: Err): Result {
  if (handler instanceof RescueBlock) {
    return handler.call(errorResult.focus, errorResult);
  }
  const handlerResult = handler.call(errorResult.focus);
  return handlerResult instanceof Err ? rescueFailed(errorResult, handlerResult) : handlerResult;
}

export function rescueFailed(originalResult: Err, handlerResult: Err): Err {
  const error = handlerResult.error.withContext({
    metadata: { rescuedError: originalResult.error.toObject() },
  });
  return new Err(handlerResult.focus, error);
}

export type { DryRun };

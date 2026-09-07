import * as Darkcore from '../darkcore.js';
import { ResultOps } from '../result.js';
import { Focus } from '../focus.js';
import type { Parallel } from '../parallel.js';
import type { Branch } from '../branch.js';
import type { Rescue } from '../rescue.js';
import type { BerylxNode } from '../node.js';
import { TASK, PARALLEL, BRANCH, RESCUE, run, runSubtree, type DryRun } from './index.js';
import { branchMatches } from './combinators.js';
import {
  decodeTaskPayload,
  decodeParallelPayload,
  decodeBranchPayload,
  decodeRescuePayload,
  type TaskPayload,
} from './payload.js';

/**
 * List task names without executing task bodies. Each step returns Ok(focus), so
 * no task failure short-circuits the plan. Branch predicates are still evaluated.
 */
export function dryRun(node: BerylxNode, focus: unknown): DryRun {
  const steps: string[] = [];
  const result = run(node, focus, dryHandlers(steps));
  return { result, steps };
}

/** Share one steps array across all handlers, including nested subtrees. */
function dryHandlers(steps: string[]): Darkcore.HandlerMap {
  return {
    [TASK]: (payload) => dryTask(decodeTaskPayload(payload), steps),
    [PARALLEL]: (payload) => {
      const [node, focus] = decodeParallelPayload(payload);
      return dryParallel(node, focus, steps);
    },
    [BRANCH]: (payload) => {
      const [node, focus] = decodeBranchPayload(payload);
      return dryBranch(node, focus, steps);
    },
    [RESCUE]: (payload) => {
      const [node, focus] = decodeRescuePayload(payload);
      return dryRescue(node, focus, steps);
    },
  };
}

function dryTask(payload: TaskPayload, steps: string[]) {
  const [task, focus] = payload;
  steps.push(task.name);
  return ResultOps.ok(focus);
}

/**
 * Visit parallel branches in declaration order. Conditional branches visit only
 * the matching arm; rescue visits only its body because dry runs produce Ok.
 */
function dryParallel(node: Parallel, focus: Focus, steps: string[]) {
  node.branches.forEach((branch) => runSubtree(branch, focus, dryHandlers(steps)));
  return ResultOps.ok(focus);
}

function dryBranch(node: Branch, focus: Focus, steps: string[]) {
  const arm = node.arms.find((candidate) => branchMatches(candidate.predicate, focus));
  if (arm) {
    runSubtree(arm.body, focus, dryHandlers(steps));
  }
  return ResultOps.ok(focus);
}

function dryRescue(node: Rescue, focus: Focus, steps: string[]) {
  runSubtree(node.body, focus, dryHandlers(steps));
  return ResultOps.ok(focus);
}

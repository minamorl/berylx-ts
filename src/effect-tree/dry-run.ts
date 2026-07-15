// ==================================================================
// Berylx EffectTree (dry-run aspect) — dry-run interpreter。
//
// Ruby 版 dry_run.rb の TS 移植。real interpreter (index.ts) と同じ Effect 木を
// 共有し、handler マップだけを差し替えることで「実行せず計画 (Task 名の列) を
// 列挙する」圏を選ぶ。
//
// 掟 (spec-system pins) との対応:
//   - substrate.aspect_via_handler: workflow 本体 (Effect 木) を書き換えず
//       handler 差し替えだけで dry-run aspect を後付けする。
//   - substrate.no_opaque_thunk  : Task の block / branch predicate 以外の副作用は
//       発火させない (計画列挙は副作用ゼロ)。
// ==================================================================

import * as Darkcore from '../darkcore.js';
import { ResultOps } from '../result.js';
import { Focus } from '../focus.js';
import type { Task } from '../task.js';
import type { Parallel } from '../parallel.js';
import type { Branch } from '../branch.js';
import type { Rescue } from '../rescue.js';
import type { BerylxNode } from '../node.js';
import { TASK, PARALLEL, BRANCH, RESCUE, run, runSubtree, type DryRun } from './index.js';
import { branchMatches } from './combinators.js';

/**
 * dry-run: Task を実行せず計画 (Task 名の列) を列挙する。常に Ok(focus) を返す
 * ため短絡せず全ステップを辿る。合成子も副作用ゼロで step のみ列挙。
 */
export function dryRun(node: BerylxNode, focus: unknown): DryRun {
  const steps: string[] = [];
  const result = run(node, focus, dryHandlers(steps));
  return { result, steps };
}

/**
 * steps を共有した dry handler マップ。合成子 dry handler は副木の実行に同じ
 * steps を共有する dryHandlers(steps) を使うので、再帰しても計画は 1 本の steps
 * に積み上がる (aspect は handler 差し替えだけで切り替わる)。
 */
function dryHandlers(steps: string[]): Darkcore.HandlerMap {
  return {
    [TASK]: (payload) => dryTask(payload as [Task, Focus], steps),
    [PARALLEL]: (payload) => {
      const [node, focus] = payload as [Parallel, Focus];
      return dryParallel(node, focus, steps);
    },
    [BRANCH]: (payload) => {
      const [node, focus] = payload as [Branch, Focus];
      return dryBranch(node, focus, steps);
    },
    [RESCUE]: (payload) => {
      const [node, focus] = payload as [Rescue, Focus];
      return dryRescue(node, focus, steps);
    },
  };
}

function dryTask(payload: [Task, Focus], steps: string[]) {
  const [task, focus] = payload;
  steps.push(task.name);
  return ResultOps.ok(focus); // Task の block は呼ばない (副作用ゼロ)。
}

/**
 * dry-run 用の合成子: 副作用ゼロで step のみ列挙する。
 *   parallel — 全 branch を列挙 (順序は branch 順で決定的にするため逐次)。
 *   branch   — predicate を評価し match した arm のみ列挙。
 *   rescue   — body のみ列挙 (dry では body は必ず Ok なので handler は発火しない)。
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

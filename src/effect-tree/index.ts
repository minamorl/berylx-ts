// ==================================================================
// Berylx EffectTree — berylx workflow を darkcore の単一 Effect 型
// (Freer monad, tagged effect の木) へ載せ替える adapter。
//
// Ruby 版 Berylx::EffectTree (effect_tree.rb + combinators.rb + dry_run.rb)
// の TS 移植。core (compile / build / run / handler マップ) をこのファイルに、
// 合成子 real interpreter を combinators.ts に、dry-run aspect を dry-run.ts に
// 分けて実装する (Ruby と同じファイル分割)。
//
// 掟 (spec-system pins) との対応:
//   - substrate.effect_tree      : workflow を darkcore Effect 木へ写す。
//   - substrate.task_as_effect   : Task を tagged effect ノード op(TASK,[task,focus]) で表す。
//   - substrate.parallel.mapped  : parallel を op(PARALLEL,[node,focus]) へ写す。
//       short_circuit / accumulate は handler ではなく payload の node.onErr で運ぶ。
//   - substrate.branch.mapped    : branch を op(BRANCH,[node,focus]) へ写す。
//   - substrate.rescue.mapped    : rescue を op(RESCUE,[node,focus]) へ写す。
//   - result.parallel_default    : short_circuit が既定、accumulate はタグ上書き。
//   - substrate.no_opaque_thunk  : payload は検査可能なデータ (berylx ノード + Focus)。
//   - substrate.aspect_via_handler: retry/dry_run/audit は本体を書き換えず handler 差し替えで後付け。
//   - result.envelope            : 成功 Ok(lay) / 失敗 Err(partial_lay, error)。
//   - result.sequence_short_circuit: 最初の Err で短絡 (darkcore bind の上に載せる)。
//
// darkcore の bind は構造の接ぎ木のみ (演算ゼロ)。短絡判定 (Err かどうか) は
// berylx の Result 圏の algebra なので、bind に埋めず継続の中で行う。
// ==================================================================

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

/** berylx 合成子を darkcore Effect 木にディスパッチするためのタグ。 */
export const TASK = 'berylx_task';
export const PARALLEL = 'berylx_parallel';
export const BRANCH = 'berylx_branch';
export const RESCUE = 'berylx_rescue';

/** dry_run の戻り値: 最終結果 (実行しないので常に Ok) と、列挙された計画。 */
export interface DryRun {
  result: Result;
  steps: string[];
}

/** darkcore Effect 木を組み立てる Kleisli 矢 (Focus → Effect)。 */
type Arrow = (focus: Focus) => Darkcore.Effect<unknown>;

/**
 * compile — berylx ノードを「Focus を受け取り darkcore Effect を返す」
 * Kleisli 矢に落とす。Sequence は bind で接ぎ木し、Task / Parallel / Branch /
 * Rescue はそれぞれ 1 つの tagged effect ノードに落とす。payload は
 * [node, focus] の検査可能データ (不透明サンクにしない)。
 */
function compile(node: BerylxNode): Arrow {
  if (node instanceof Sequence) {
    return compileSequence(node);
  }
  if (node instanceof Task || node instanceof AsyncTask) {
    return (focus: Focus) => Darkcore.op(TASK, [node, focus]);
  }
  if (node instanceof Parallel) {
    return (focus: Focus) => Darkcore.op(PARALLEL, [node, focus]);
  }
  if (node instanceof Branch) {
    return (focus: Focus) => Darkcore.op(BRANCH, [node, focus]);
  }
  if (node instanceof Rescue) {
    return (focus: Focus) => Darkcore.op(RESCUE, [node, focus]);
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

/**
 * Sequence を darkcore bind で接ぎ木する。bind は構造の接ぎ木のみで、
 * 短絡 (Err) 判定・Catch 境界での回復は継続内 = berylx 圏の algebra site で行う。
 */
function compileSequence(node: Sequence): Arrow {
  return (focus: Focus) =>
    node.steps.reduce<Darkcore.Effect<unknown>>(
      (effect, step) => effect.bind((prev) => compileStep(step, prev as Result)),
      Darkcore.pure(ResultOps.ok(focus)),
    );
}

/**
 * Sequence の 1 ステップを次の Effect に接ぐ。Catch は Sequence の短絡境界:
 * 成功時は素通りし、直前が Err のときだけ (かつ catches が真のとき) 回復させる。
 * 非 Catch は Err なら短絡 (prev を前送り)、Ok なら実行する。
 */
function compileStep(step: BerylxNode, prev: Result): Darkcore.Effect<unknown> {
  if (step instanceof Catch) {
    return compileCatch(step, prev);
  }
  if (prev instanceof Err) {
    return Darkcore.pure(prev);
  }
  return compile(step)((prev as Ok).focus);
}

function compileCatch(step: Catch, prev: Result): Darkcore.Effect<unknown> {
  if (!(prev instanceof Err) || !step.catches(prev)) {
    return Darkcore.pure(prev);
  }
  return Darkcore.pure(recover(step.handler, prev));
}

/**
 * berylx ノードと初期 focus から darkcore Effect 木を組み立てる。
 * 実行はしない (handler を渡すまで作用は起きない)。
 */
export function build(node: BerylxNode, focus: unknown): Darkcore.Effect<unknown> {
  return compile(node)(ResultOps.coerceFocus(focus));
}

/**
 * workflow 本体 (Effect 木) を darkcore トランポリンで走らせる。handlers を
 * 差し替えるだけで圏 (real / dry_run / audit ...) を選ぶ。戻り値は berylx の
 * 結果封筒 Ok(lay) / Err(partial_lay, error)。
 */
export function run(
  node: BerylxNode,
  focus: unknown,
  handlers: Darkcore.HandlerMap = realHandlers(),
): Result {
  return Darkcore.fold(build(node, focus), (x) => x as Result, handlers);
}

/**
 * 実実行の handler マップ: Task の block を実際に呼び、合成子ノードはそれぞれ
 * 副木として実行しつつ berylx 圏の algebra で結果封筒を合成する。
 * 合成子 handler は自分自身 (realHandlers) を副木実行に渡すため、木は同じ圏
 * (real) のまま再帰する。
 */
export function realHandlers(): Darkcore.HandlerMap {
  return {
    [TASK]: (payload) => realTask(payload as [Task, Focus]),
    [PARALLEL]: (payload) => realParallel(payload as [Parallel, Focus]),
    [BRANCH]: (payload) => realBranch(payload as [Branch, Focus]),
    [RESCUE]: (payload) => realRescue(payload as [Rescue, Focus]),
  };
}

function realTask(payload: [Task, Focus]): Result {
  const [task, focus] = payload;
  return task.call(focus);
}

function realParallel(payload: [Parallel, Focus]): Result {
  return runParallel(payload[0], payload[1], realHandlers());
}

function realBranch(payload: [Branch, Focus]): Result {
  return runBranch(payload[0], payload[1], realHandlers());
}

function realRescue(payload: [Rescue, Focus]): Result {
  return runRescue(payload[0], payload[1], realHandlers());
}

/**
 * 副木実行ヘルパ — berylx ノードを与えられた handler マップで走らせ、
 * berylx 結果封筒 (Ok/Err) を得る。合成子 handler が枝の実行に使う。
 */
export function runSubtree(node: BerylxNode, focus: Focus, handlers: Darkcore.HandlerMap): Result {
  return Darkcore.fold(build(node, focus), (x) => x as Result, handlers);
}

// combinators / dry-run から使う内部関数を集約したオブジェクト。
// (Ruby の module 再オープンに相当する分割を、循環 import を避けつつ実現する)
import {
  runParallel,
  runBranch,
  runRescue,
  recover,
  branchMatches,
} from './combinators.js';
import { dryRun } from './dry-run.js';
import {
  runAsync,
  runSubtreeAsync,
  asyncRealHandlers,
  runParallelAsync,
  runBranchAsync,
  runRescueAsync,
} from './async.js';

export const EffectTree = {
  TASK,
  PARALLEL,
  BRANCH,
  RESCUE,
  build,
  run,
  realHandlers,
  runSubtree,
  runParallel,
  runBranch,
  runRescue,
  recover,
  branchMatches,
  dryRun,
  // フェーズ 3-a: 非同期実行系 (foldAsync ベース)。
  runAsync,
  runSubtreeAsync,
  asyncRealHandlers,
  runParallelAsync,
  runBranchAsync,
  runRescueAsync,
};

export { runParallel, runBranch, runRescue, recover, branchMatches, dryRun };
export {
  runAsync,
  runSubtreeAsync,
  asyncRealHandlers,
  runParallelAsync,
  runBranchAsync,
  runRescueAsync,
} from './async.js';

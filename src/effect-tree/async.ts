// ==================================================================
// Berylx EffectTree (async interpreter) — workflow を darkcore の非同期
// トランポリン (foldAsync) で走らせる圏。
//
// フェーズ 3-a: 同期の real interpreter (index.ts / combinators.ts) と同じ
// Effect 木・同じ berylx 圏の algebra (短絡・merge・回復) を共有し、Task の実行
// だけを await 対応にする。AsyncTask は callAsync で、通常 Task は同期 call で
// 実行する (混在可)。Parallel は Promise.all ベースで、short_circuit /
// accumulate / reducer merge は同期版のヘルパをそのまま再利用する。
//
// 既存の同期経路 (run / realHandlers) は一切変更しない。async はあくまで
// handler マップ差し替えで後付けする aspect (spec: aspect_via_handler)。
// ==================================================================

import * as Darkcore from '../darkcore.js';
import { ResultOps, Ok, Err, type Result } from '../result.js';
import { Focus } from '../focus.js';
import { Task } from '../task.js';
import { AsyncTask } from '../async-task.js';
import { Parallel } from '../parallel.js';
import { Branch } from '../branch.js';
import { Rescue, RescueBlock, type RescueHandler } from '../rescue.js';
import type { BerylxNode } from '../node.js';
import { build, TASK, PARALLEL, BRANCH, RESCUE } from './index.js';
import {
  decodeTaskPayload,
  decodeParallelPayload,
  decodeBranchPayload,
  decodeRescuePayload,
  type TaskPayload,
} from './payload.js';
import {
  parallelHandleFailures,
  parallelMerge,
  branchMatches,
  rescueFailed,
} from './combinators.js';

/**
 * async 実実行の handler マップ: Task/AsyncTask を実行し、合成子は非同期副木として
 * 実行しつつ berylx 圏の algebra で結果封筒を合成する。合成子 handler は自分自身
 * (asyncRealHandlers) を副木実行に渡すため、木は同じ async 圏のまま再帰する。
 */
export function asyncRealHandlers(): Darkcore.AsyncHandlerMap {
  return {
    [TASK]: (payload) => asyncRealTask(decodeTaskPayload(payload)),
    [PARALLEL]: (payload) => {
      const [node, focus] = decodeParallelPayload(payload);
      return runParallelAsync(node, focus, asyncRealHandlers());
    },
    [BRANCH]: (payload) => {
      const [node, focus] = decodeBranchPayload(payload);
      return runBranchAsync(node, focus, asyncRealHandlers());
    },
    [RESCUE]: (payload) => {
      const [node, focus] = decodeRescuePayload(payload);
      return runRescueAsync(node, focus, asyncRealHandlers());
    },
  };
}

/**
 * runAsync — workflow 本体 (Effect 木) を darkcore の非同期トランポリンで走らせる。
 * 戻り値は berylx の結果封筒 Ok(lay) / Err(partial_lay, error) の Promise。
 */
export function runAsync(
  node: BerylxNode,
  focus: unknown,
  handlers: Darkcore.AsyncHandlerMap = asyncRealHandlers(),
): Promise<Result> {
  return Darkcore.foldAsync(build(node, ResultOps.coerceFocus(focus)), (x) => x, handlers);
}

/** 非同期副木実行ヘルパ (合成子 handler が枝の実行に使う)。 */
export function runSubtreeAsync(
  node: BerylxNode,
  focus: Focus,
  handlers: Darkcore.AsyncHandlerMap,
): Promise<Result> {
  return Darkcore.foldAsync(build(node, focus), (x) => x, handlers);
}

async function asyncRealTask(payload: TaskPayload): Promise<Result> {
  const [task, focus] = payload;
  if (task instanceof AsyncTask) {
    return task.callAsync(focus);
  }
  return task.call(focus);
}

/**
 * async Parallel — 全 branch を Promise.all で同時実行する。失敗合成 (short_circuit
 * /accumulate) と reducer merge は同期版の algebra をそのまま使う (merge は純粋計算)。
 */
export async function runParallelAsync(
  node: Parallel,
  focus: Focus,
  handlers: Darkcore.AsyncHandlerMap,
): Promise<Result> {
  const branchResults = await Promise.all(
    node.branches.map((branch) => runSubtreeAsync(branch, focus, handlers)),
  );
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

/** async Branch — predicate 評価は純粋なので同期、match した arm を非同期実行する。 */
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

/** async Rescue — body を非同期実行し、Err なら回復 handler (async 対応) で差し替える。 */
export async function runRescueAsync(
  node: Rescue,
  focus: Focus,
  handlers: Darkcore.AsyncHandlerMap,
): Promise<Result> {
  const result = await runSubtreeAsync(node.body, focus, handlers);
  if (result instanceof Ok) {
    return result;
  }
  return recoverAsync(node.handler, result);
}

/**
 * 非同期回復 — 同期 recover の Promise 版。RescueBlock (同期ブロック) はそのまま、
 * AsyncTask handler は callAsync、通常 Task handler は call で回復する。handler が
 * Err を返したら回復失敗として元エラーを metadata に畳む (同期版と同一)。
 */
async function recoverAsync(handler: RescueHandler, errorResult: Err): Promise<Result> {
  if (handler instanceof RescueBlock) {
    return handler.call(errorResult.focus, errorResult);
  }
  const handlerResult =
    handler instanceof AsyncTask
      ? await handler.callAsync(errorResult.focus)
      : handler.call(errorResult.focus);
  return handlerResult instanceof Err ? rescueFailed(errorResult, handlerResult) : handlerResult;
}

// ==================================================================
// Berylx EffectTree (combinator interpreters) — parallel / branch / rescue の
// real interpreter。
//
// Ruby 版 combinators.rb の TS 移植。core (index.ts) は compile / build / run /
// handler マップの骨格だけを持ち、各合成子の「berylx 圏の algebra」(短絡・
// merge・回復・trace 付与) はここに置く。darkcore の bind は構造の接ぎ木のみで、
// 圏の algebra は現れない。Err 判定・失敗合成・回復といった意味はすべて
// berylx 側のこの site で行う。
// ==================================================================

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

// ----------------------------------------------------------------
// Parallel — Parallel#call と同一セマンティクス。各 branch を副木として実行し、
// 失敗があれば onErr (payload のタグ) に従って合成、無ければ reducer で focus を
// merge する。short_circuit / accumulate は handler の分岐ではなく payload の
// node.onErr (タグ) で運ぶ。
//
// Ruby は Thread で並列だったが、TS は同期実行なので branch 順に逐次実行する。
// どの Err を返すか / merge 結果は Ruby と一致する。
// ----------------------------------------------------------------
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

/** short_circuit なら最初の Err、accumulate なら全失敗を parallelErrors に集約。 */
export function parallelHandleFailures(node: Parallel, focus: Focus, failures: Err[]): Result {
  if (node.onErr === 'short_circuit') {
    return failures[0];
  }
  return parallelError(focus, failures);
}

/** 全 branch の focus を reducer で畳む。reducer が投げたら parallel の Err に写す。 */
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
  // Ruby の reducer.arity == 3 を関数 length で判別 (strict は base も受ける)。
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

// ----------------------------------------------------------------
// Branch — Branch#call と同一セマンティクス。最初に match した arm の body を
// 副木として実行し、無ければ no_branch_matched で Err。predicate 評価は純粋
// 計算なので handler 内で回す。
// ----------------------------------------------------------------
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

// ----------------------------------------------------------------
// Rescue — Rescue#call と同一セマンティクス。body を副木として実行し、Ok なら
// そのまま、Err なら回復 handler (RescueBlock / task) で差し替える。
// ----------------------------------------------------------------
export function runRescue(node: Rescue, focus: Focus, handlers: Darkcore.HandlerMap): Result {
  const result = runSubtree(node.body, focus, handlers);
  if (result instanceof Ok) {
    return result;
  }
  return dispatchRecover(node, result as Err, handlers);
}

/** Rescue/Catch の回復も RECOVER effect として現在の map へ dispatch する。 */
export function dispatchRecover(
  node: Rescue,
  errorResult: Err,
  handlers: Darkcore.HandlerMap,
): Result {
  return Darkcore.fold(
    Darkcore.op(RECOVER, [node, errorResult]),
    (value) => value as Result,
    handlers,
  );
}

/** RECOVER の real interpreter。回復の副木にも同じ handler map を渡す。 */
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
 * 回復 handler の適用 — Rescue と Sequence 内の Catch 境界で共有する berylx 圏の
 * algebra。RescueBlock (ブロック handler) はエラーと focus を受け取り、それ以外の
 * node handler は focus を受け取って結果封筒を返す。handler 自身が Err を返したら
 * 回復失敗として元エラーを metadata に畳む。
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

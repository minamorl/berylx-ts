// ==================================================================
// Berylx EffectTree (async interpreter) — workflow を darkcore の非同期
// トランポリン (foldAsync) で走らせる圏。
//
// フェーズ 3-a: 同期の real interpreter (index.ts / combinators.ts) と同じ
// Effect 木・同じ berylx 圏の algebra (短絡・merge・回復) を共有し、Task の実行
// だけを await 対応にする。AsyncTask は callAsync で、通常 Task は同期 call で
// 実行する (混在可)。Parallel は Promise.allSettled で全 branch を待ち、
// short_circuit / accumulate / reducer merge は同期版の helper を再利用する。
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
 * async 実実行の handler マップ: Task/AsyncTask を実行し、合成子は非同期副木として
 * 実行しつつ berylx 圏の algebra で結果封筒を合成する。合成子 handler は自分自身
 * (asyncRealHandlers) を副木実行に渡すため、木は同じ async 圏のまま再帰する。
 */
export function asyncRealHandlers(
  effects: Darkcore.AsyncHandlerMap = {},
  subtree?: Darkcore.AsyncHandlerMap,
): Darkcore.AsyncHandlerMap {
  // index.ts との循環 import があるため、live binding は呼出時に読む。
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

/** async handler を aspect で包み、包んだ map 自身を副木と回復へ伝播させる。 */
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
 * async Parallel — 全 branch を同時開始し、Promise.allSettled で全てを待つ。
 * rejection は型を問わず branch 順の最初を待機後に再送出し、rejection が無い
 * ときだけ通常の失敗合成と reducer merge に同期版の algebra を再利用する。
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
  return dispatchRecoverAsync(node, result, handlers);
}

/** Rescue の回復を現在の async handler map へ RECOVER effect として発行する。 */
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
 * RECOVER の async real interpreter。RescueBlock は Perform とともに呼び、Task /
 * AsyncTask handler は同じ async handler map の副木として走らせる。handler が Err を
 * 返したら回復失敗として元エラーを metadata に畳む (同期版と同一)。
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

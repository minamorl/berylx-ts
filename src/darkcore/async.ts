// ==================================================================
// darkcore async — Effect 木の非同期トランポリン。
//
// fold / run (effect.ts) の Promise 版。handler が Promise を返してよい点だけが
// 違い、構造 (by_tag ディスパッチ・pure 終端・no_naive_recursion) は同期版と
// 同一。同期版と同じ型付き Effect を再利用して async 解釈を後付けする。
// ==================================================================

import type { Effect } from './effect.js';

/** tag ごとの非同期 handler マップ (値でも Promise でも返せる)。 */
export type AsyncHandlerMap = Record<string, (payload: unknown) => unknown | Promise<unknown>>;

/**
 * foldAsync — fold の非同期版。各 handler の結果を await してから継続へ渡す。
 * 実行は再帰でなく反復 (トランポリン) なので深い木でもスタックを食わない。
 */
export async function foldAsync<A, R>(
  prog: Effect<A>,
  onReturn: (x: A) => R | Promise<R>,
  handlers: AsyncHandlerMap,
): Promise<R> {
  let cur = prog;
  for (;;) {
    const step = cur.step();
    if (step.closed) {
      return await onReturn(step.value);
    }
    const h = handlers[step.tag];
    if (!h) {
      throw new Error(`no handler for effect: ${step.tag}`);
    }
    cur = step.resume(await h(step.payload));
  }
}

/** run の非同期版 (onReturn = 恒等)。 */
export async function runAsync<A>(prog: Effect<A>, handlers: AsyncHandlerMap): Promise<A> {
  return foldAsync(prog, (x) => x, handlers);
}

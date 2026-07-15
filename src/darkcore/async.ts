// ==================================================================
// darkcore async — Effect 木の非同期トランポリン。
//
// fold / run (effect.ts) の Promise 版。handler が Promise を返してよい点だけが
// 違い、構造 (by_tag ディスパッチ・pure 終端・no_naive_recursion) は同期版と
// 同一。effect.ts は一切変更せず、Effect 型を再利用して async 解釈を後付けする。
// ==================================================================

import { PURE } from './effect.js';
import type { Effect } from './effect.js';

/** tag ごとの非同期 handler マップ (値でも Promise でも返せる)。 */
export type AsyncHandlerMap = Record<string, (payload: unknown) => unknown | Promise<unknown>>;

/**
 * foldAsync — fold の非同期版。各 handler の結果を await してから継続へ渡す。
 * 実行は再帰でなく反復 (トランポリン) なので深い木でもスタックを食わない。
 */
export async function foldAsync<R>(
  prog: Effect<unknown>,
  onReturn: (x: unknown) => R | Promise<R>,
  handlers: AsyncHandlerMap,
): Promise<R> {
  let cur = prog;
  for (;;) {
    if (cur.tag === PURE && cur.k === null) {
      return await onReturn(cur.payload);
    }
    const h = handlers[cur.tag];
    if (!h) {
      throw new Error(`no handler for effect: ${cur.tag}`);
    }
    const next = cur.k!(await h(cur.payload));
    cur = next;
  }
}

/** run の非同期版 (onReturn = 恒等)。 */
export async function runAsync(prog: Effect<unknown>, handlers: AsyncHandlerMap): Promise<unknown> {
  return foldAsync(prog, (x) => x, handlers);
}

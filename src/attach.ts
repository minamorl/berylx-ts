// ==================================================================
// attachRoot — Root#subscribe ベースの host 連携ブリッジ。
//
// フェーズ 3-d: cray の attachCray 相当。React などフレームワークには依存せず、
// Root の subscribe コールバックで state 変化を host へ流す薄い層に留める。
// 返り値は購読解除関数 (Root#subscribe と同じ)。
//
// Root#subscribe は購読直後にまず { type:'snapshot' } を 1 度流し、以降 commit
// のたびに { type:'commit' } を流す。attachRoot はそれを select で射影し、
// listener と (任意の) onSnapshot / onCommit へ配る。
// ==================================================================

import type { Root, RootEvent } from './root.js';

export interface AttachRootOptions<S = unknown> {
  /** event.value (コミット済み state) を host が使う形へ射影する。既定は恒等。 */
  select?: (state: unknown) => S;
  /** 購読直後の初期 snapshot を受け取る (任意)。 */
  onSnapshot?: (state: S, event: RootEvent) => void;
  /** commit のたびに呼ばれる (任意)。 */
  onCommit?: (state: S, event: RootEvent) => void;
  /** 初期 snapshot を listener/onSnapshot へ流さない。既定 false。 */
  skipSnapshot?: boolean;
}

/**
 * Root を host へ結線する。listener は snapshot / commit の両方で射影 state を
 * 受け取る (skipSnapshot 時は commit のみ)。戻り値を呼ぶと購読解除する。
 */
export function attachRoot<S = unknown>(
  root: Root,
  listener: (state: S, event: RootEvent) => void,
  options: AttachRootOptions<S> = {},
): () => void {
  const select = options.select ?? ((state: unknown) => state as S);
  return root.subscribe((event) => {
    const state = select(event.value);
    if (event.type === 'snapshot') {
      if (options.skipSnapshot) {
        return;
      }
      options.onSnapshot?.(state, event);
    } else {
      options.onCommit?.(state, event);
    }
    listener(state, event);
  });
}

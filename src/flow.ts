// ==================================================================
// Flow — 実行のエントリ。
//
// Ruby 版 Berylx::Flow の TS 移植。focus を起点に、合成子でも単発 Task でも
// EffectTree (darkcore Effect 木) を必ず通して実行する。
// ==================================================================

import { ResultOps, type Result } from './result.js';
import { Focus } from './focus.js';
import type { BerylxNode } from './node.js';
import { EffectTree } from './effect-tree/index.js';

export class Flow<S = any> {
  readonly focus: Focus<S, []>;

  constructor(focus: unknown) {
    this.focus = ResultOps.coerceFocus<S>(focus);
  }

  /**
   * Ruby Flow[focus] に対応。
   *
   * Focus<T> を渡せば S = T が推論されるので、以後この flow へ流すノードは
   * 同じ状態型で検査される。生の値を渡した場合もその型が S になる。
   */
  static of<T>(focus: Focus<T, any>): Flow<T>;
  static of<T>(focus: T): Flow<T>;
  static of(focus: unknown): Flow<any> {
    return new Flow(focus);
  }

  /**
   * 実行の唯一のエントリ。合成子でも単発 Task でも EffectTree を必ず通す。
   * Task は葉として EffectTree の TASK handler が Task#call を呼ぶ。
   */
  call(node: BerylxNode<S>): Result<S> {
    return EffectTree.run(node, this.focus);
  }

  /** Ruby Flow#>> は call のエイリアス。 */
  then(other: BerylxNode<S>): Result<S> {
    return this.call(other);
  }
}

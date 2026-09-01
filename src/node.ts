// ==================================================================
// BerylxNode — 合成子ノードの共通インタフェース。
//
// Ruby では Task / Sequence / Parallel / Branch / Rescue / Catch がダック
// タイピングで共通の #call / #nodes / 演算子を持っていた。TS では明示的な
// インタフェースにする。Ruby の演算子は次のメソッドへ写す:
//   >> (sequence)  → then
//   &  (parallel)  → par
//   |  (Task: then / Branch: arm 結合) → pipe / or (各クラスで実装)
// ==================================================================

import type { Result } from './result.js';
import type { RescueHandlerBlock } from './rescue.js';

/** name を持つ葉ノード (Task / RescueBlock など)。graph/trace で使う。 */
export interface NamedNode {
  readonly name: string;
}

/**
 * berylx workflow を構成するノードの共通契約。
 *
 * 型引数 S は workflow の状態のルート型。境界ごとに Root は 1 つなので
 * (spec の core.root.singleton)、合成子は S について単相でよい。Task を
 * Focus<A> -> Focus<B> の遷移として型付けると then/par の合成で型の幅寄せが
 * 要り、set が型を広げるための再帰的な object 再構築を招く。ここは避ける。
 * 既定は any なので、型を付けない使い方はこれまでどおり通る。
 */
export interface BerylxNode<S = any> {
  /** focus を受け取り結果封筒 (Ok/Err) を返す。実行の起点。 */
  call(focus: unknown): Result<S>;
  /** グラフ化・トレース用にフラット化した葉ノード列を返す。 */
  nodes(): NamedNode[];
  /** 逐次合成 (Ruby >>)。 */
  then(other: BerylxNode<S>): BerylxNode<S>;
  /** 並列合成 (Ruby &)。 */
  par(other: BerylxNode<S>): BerylxNode<S>;
  /**
   * 失敗回復 (Ruby rescue_with)。
   *
   * 全合成子が実装しているのに interface に載っていなかったため、then()/par() の
   * 戻り値 (BerylxNode) から呼ぶと型検査に落ちていた。test 側が typecheck の対象
   * 外だったので誰も気づいていなかった。
   */
  rescueWith(
    handler: BerylxNode<S> | null,
    name?: string | null,
    block?: RescueHandlerBlock<S>,
  ): BerylxNode<S>;
}

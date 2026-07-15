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

/** name を持つ葉ノード (Task / RescueBlock など)。graph/trace で使う。 */
export interface NamedNode {
  readonly name: string;
}

/** berylx workflow を構成するノードの共通契約。 */
export interface BerylxNode {
  /** focus を受け取り結果封筒 (Ok/Err) を返す。実行の起点。 */
  call(focus: unknown): Result;
  /** グラフ化・トレース用にフラット化した葉ノード列を返す。 */
  nodes(): NamedNode[];
  /** 逐次合成 (Ruby >>)。 */
  then(other: BerylxNode): BerylxNode;
  /** 並列合成 (Ruby &)。 */
  par(other: BerylxNode): BerylxNode;
}

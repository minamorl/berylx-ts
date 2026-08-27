// ==================================================================
// State — lay を「タスク実行空間」へ持ち上げた層。
//
// Ruby 版 Berylx::State の TS 移植。Ruby の演算子は次へ写す:
//   State#| (実行)     → pipe
//   State#& (合成蓄積) → and
// pipe は与えられたノードを即実行し、and はノードを蓄積して新しい State を返す。
// ==================================================================

import { ResultOps, type Result } from './result.js';
import { Focus } from './focus.js';
import type { BerylxNode } from './node.js';
import { Root } from './root.js';
import { Flow } from './flow.js';

/** call を持つ berylx ノード。 */
type Nodeish<S = any> = BerylxNode<S>;

export class State<S = any> {
  readonly lay: Focus<S, []>;
  readonly node: Nodeish<S> | null;

  constructor(lay: unknown, node: Nodeish<S> | null = null) {
    this.lay = ResultOps.coerceFocus<S>(lay);
    this.node = node;
  }

  /** Ruby State[value] : Root 経由で lay を作る。 */
  static of<T>(value: T): State<T>;
  static of(): State<any>;
  static of(value: unknown = {}): State<any> {
    return new State(Root.of(value).toLay());
  }

  /** Ruby State#| : ノードを即実行する。 */
  pipe(other: Nodeish<S>): Result<S> {
    return this.call(this.coerceNode(other));
  }

  /** Ruby State#& : ノードを蓄積して新しい State を返す。 */
  and(other: Nodeish<S>): State<S> {
    const nextNode = this.coerceNode(other);
    return new State<S>(this.lay, this.node ? this.node.then(nextNode) : nextNode);
  }

  /** ノードを実行する。node 省略時は蓄積済みノードを走らせる。 */
  call(node: Nodeish<S> | null = null): Result<S> {
    const target = node ? this.coerceNode(node) : this.node;
    if (!target) {
      throw new Error('State has no task to run');
    }
    return Flow.of(this.lay).call(target);
  }

  toLay(): Focus<S, []> {
    return this.lay;
  }

  private coerceNode(taskish: Nodeish<S>): Nodeish<S> {
    if (taskish && typeof (taskish as { call?: unknown }).call === 'function') {
      return taskish;
    }
    throw new TypeError(`expected a Berylx task/workflow node, got ${String(taskish)}`);
  }
}

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
import { EffectTree } from './effect-tree/index.js';
import type { HandlerMap } from './darkcore.js';

/** call を持つ berylx ノード。 */
type Nodeish = BerylxNode;

export class State {
  readonly lay: Focus;
  readonly node: Nodeish | null;

  constructor(lay: unknown, node: Nodeish | null = null) {
    this.lay = ResultOps.coerceFocus(lay);
    this.node = node;
  }

  /** Ruby State[value] : Root 経由で lay を作る。 */
  static of(value: unknown = {}): State {
    return new State(Root.of(value).toLay());
  }

  /** Ruby State#| : ノードを即実行する。 */
  pipe(other: Nodeish): Result {
    return this.call(this.coerceNode(other));
  }

  /** Ruby State#& : ノードを蓄積して新しい State を返す。 */
  and(other: Nodeish): State {
    const nextNode = this.coerceNode(other);
    return new State(this.lay, this.node ? this.node.then(nextNode) : nextNode);
  }

  /** ノードを実行する。node 省略時は蓄積済みノードを走らせる。 */
  call(
    node: Nodeish | null = null,
    handlers: HandlerMap = EffectTree.realHandlers(),
  ): Result {
    const target = node ? this.coerceNode(node) : this.node;
    if (!target) {
      throw new Error('State has no task to run');
    }
    return Flow.of(this.lay).call(target, handlers);
  }

  toLay(): Focus {
    return this.lay;
  }

  private coerceNode(taskish: Nodeish): Nodeish {
    if (taskish && typeof (taskish as { call?: unknown }).call === 'function') {
      return taskish;
    }
    throw new TypeError(`expected a Berylx task/workflow node, got ${String(taskish)}`);
  }
}

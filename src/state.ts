import { ResultOps, type Result } from './result.js';
import { Focus } from './focus.js';
import type { BerylxNode } from './node.js';
import { Root } from './root.js';
import { Flow } from './flow.js';
import { EffectTree } from './effect-tree/index.js';
import type { HandlerMap } from './darkcore.js';

type Nodeish<S = any> = BerylxNode<S>;

export class State<S = any> {
  readonly lay: Focus<S, []>;
  readonly node: Nodeish<S> | null;

  constructor(lay: unknown, node: Nodeish<S> | null = null) {
    this.lay = ResultOps.coerceFocus<S>(lay);
    this.node = node;
  }

  static of<T>(value: T): State<T>;
  static of(): State<any>;
  static of(value: unknown = {}): State<any> {
    return new State(Root.of(value).toLay());
  }

  /** Execute a node immediately. */
  pipe(other: Nodeish<S>): Result<S> {
    return this.call(this.coerceNode(other));
  }

  /** Append a node to the pending sequence without executing it. */
  and(other: Nodeish<S>): State<S> {
    const nextNode = this.coerceNode(other);
    return new State<S>(this.lay, this.node ? this.node.then(nextNode) : nextNode);
  }

  /** Execute the supplied node, or the pending sequence when omitted. */
  call(
    node: Nodeish<S> | null = null,
    handlers: HandlerMap = EffectTree.realHandlers(),
  ): Result<S> {
    const target = node ? this.coerceNode(node) : this.node;
    if (!target) {
      throw new Error('State has no task to run');
    }
    return Flow.of(this.lay).call(target, handlers);
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

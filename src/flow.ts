import { ResultOps, type Result } from './result.js';
import { Focus } from './focus.js';
import type { BerylxNode } from './node.js';
import { EffectTree } from './effect-tree/index.js';
import type { HandlerMap } from './darkcore.js';

export class Flow<S = any> {
  readonly focus: Focus<S, []>;

  constructor(focus: unknown) {
    this.focus = ResultOps.coerceFocus<S>(focus);
  }

  /**
   * Infer the state type from a Focus or raw value. Nodes passed to this flow
   * are checked against that same state type.
   */
  static of<T>(focus: Focus<T, any>): Flow<T>;
  static of<T>(focus: T): Flow<T>;
  static of(focus: unknown): Flow<any> {
    return new Flow(focus);
  }

  /**
   * Execute both composed workflows and individual tasks through EffectTree.
   * Its TASK handler invokes Task.call for leaf nodes.
   */
  call(node: BerylxNode<S>, handlers: HandlerMap = EffectTree.realHandlers()): Result<S> {
    return EffectTree.run(node, this.focus, handlers);
  }

  then(other: BerylxNode<S>): Result<S> {
    return this.call(other);
  }
}

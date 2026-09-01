// ==================================================================
// Root — workflow のコミット済み状態を所有する唯一の境界。
//
// Ruby 版 Berylx::Root の TS 移植。Ruby State#new(@value).call(node) →
// commit_result のパイプラインを踏襲する。Ruby の演算子は次へ写す:
//   Root#|      → pipe (ノードを実行し Ok ならコミット)
//   Root#[]     → at  (Focus を子キーへ掘る)
// ==================================================================

import { ResultOps, Ok, Err, type Result } from './result.js';
import { Focus, type KeysAt } from './focus.js';
import { Merge } from './merge.js';
import type { BerylxNode } from './node.js';
import { State } from './state.js';
import { EffectTree } from './effect-tree/index.js';
import type { HandlerMap } from './darkcore.js';

/** subscribe に流れるイベント。 */
export type RootEvent =
  | { type: 'snapshot'; value: unknown }
  | { type: 'commit'; value: unknown };

type Subscriber = (event: RootEvent) => void;

export class Root<S = any> {
  private value: Focus<S, []>;
  readonly history: RootEvent[];
  private subscribers: Subscriber[];

  constructor(value: unknown = {}) {
    this.value = ResultOps.coerceFocus<S>(value);
    this.history = [];
    this.subscribers = [];
  }

  /** Ruby Root[value] / Root.new に対応。 */
  static of<T>(value: T): Root<T>;
  static of(): Root<any>;
  static of(value: unknown = {}): Root<any> {
    return new Root(value);
  }

  /** Ruby Root#| : ノードを実行し、Ok ならコミットする。 */
  pipe(other: BerylxNode<S>): Result<S> {
    return this.call(other);
  }

  call(node: BerylxNode<S>, handlers: HandlerMap = EffectTree.realHandlers()): Result<S> {
    const result = new State<S>(this.value).call(node, handlers);
    return this.commitResult(result);
  }

  /** 値をコミットする。Hash は現在の状態へ deep merge する。 */
  commit(value: unknown): this {
    const nextFocus = this.coerceCommit(value);
    this.value = nextFocus;
    const event: RootEvent = { type: 'commit', value: this.value.toObject() };
    this.history.push(event);
    this.publish(event);
    return this;
  }

  state(): S {
    return this.value.toObject();
  }

  toObject(): S {
    return this.state();
  }

  toLay(): Focus<S, []> {
    return this.value;
  }

  toState(): State<S> {
    return new State<S>(this.value);
  }

  /** Ruby Root#[] : Focus を子キーへ掘る。 */
  at<K extends KeysAt<S, []>>(key: K): Focus<S, [K]> {
    return this.value.at(key);
  }

  subscribe(block: Subscriber): () => void {
    if (typeof block !== 'function') {
      throw new Error('Root#subscribe requires a block');
    }
    this.subscribers.push(block);
    block({ type: 'snapshot', value: this.state() });
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== block);
    };
  }

  protected commitResult(result: Result<S>): Result<S> {
    if (result instanceof Ok) {
      this.commit(result.focus);
    }
    return result;
  }

  private coerceCommit(value: unknown): Focus<S, []> {
    if (value instanceof Root) {
      return value.toLay();
    }
    if (value instanceof Ok || value instanceof Err) {
      return ResultOps.coerceFocus(value.focus);
    }
    if (value instanceof Focus) {
      return value;
    }
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      const reducer = Merge.deep() as (left: Focus, right: Focus) => Focus;
      return reducer(this.value, Focus.of(value));
    }
    return ResultOps.coerceFocus(value);
  }

  private publish(event: RootEvent): void {
    this.subscribers.forEach((s) => s(event));
  }
}

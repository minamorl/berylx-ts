import { ResultOps, Ok, Err, type Result } from './result.js';
import { Focus, type KeysAt } from './focus.js';
import { Merge } from './merge.js';
import type { BerylxNode } from './node.js';
import { State } from './state.js';
import { EffectTree } from './effect-tree/index.js';
import type { HandlerMap } from './darkcore.js';

/** Events delivered to Root subscribers. */
export type RootEvent =
  | { type: 'snapshot'; value: unknown }
  | { type: 'commit'; value: unknown };

type Subscriber = (event: RootEvent) => void;

/** The single owner of committed state at a workflow boundary. */
export class Root<S = any> {
  private value: Focus<S, []>;
  readonly history: RootEvent[];
  private subscribers: Subscriber[];

  constructor(value: unknown = {}) {
    this.value = ResultOps.coerceFocus<S>(value);
    this.history = [];
    this.subscribers = [];
  }

  static of<T>(value: T): Root<T>;
  static of(): Root<any>;
  static of(value: unknown = {}): Root<any> {
    return new Root(value);
  }

  /** Execute a node and commit its state only when the result is Ok. */
  pipe(other: BerylxNode<S>): Result<S> {
    return this.call(other);
  }

  call(node: BerylxNode<S>, handlers: HandlerMap = EffectTree.realHandlers()): Result<S> {
    const result = new State<S>(this.value).call(node, handlers);
    return this.commitResult(result);
  }

  /** Commit state. Raw non-array objects are deeply merged into the current state. */
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

  /** Return a focus on a child key of the committed state. */
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

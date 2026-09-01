// ==================================================================
// Task — 名前つき状態遷移。berylx の葉ノード。
//
// Ruby 版 Berylx::Task の TS 移植。block は Focus を受け取り、Focus か
// 結果封筒 (Ok/Err) を返す。例外は捕捉して Err (failed_node/trace 付き)
// に変換する。演算子は then(>>) / par(&) / pipe(|=then) へ写す。
// ==================================================================

import { ResultOps, Err, type Result } from './result.js';
import { Focus } from './focus.js';
import type { BerylxNode, NamedNode } from './node.js';
import { Sequence } from './sequence.js';
import { Parallel } from './parallel.js';
import { Graph } from './graph.js';
import type { RescueHandlerBlock } from './rescue.js';
import { Perform } from './perform.js';
import { ControlSignal } from './control-signal.js';

/** Task の本体。1 引数の関数も代入でき、2 引数を宣言すると Perform を受け取る。 */
export type TaskBlock<S = any> = (
  focus: Focus<S, []>,
  performer: Perform,
) => Focus<S, any> | Result<S> | unknown;

export class Task<S = any> implements BerylxNode<S>, NamedNode {
  readonly name: string;
  private readonly block: TaskBlock<S>;

  constructor(name: string, block: TaskBlock<S>) {
    if (typeof block !== 'function') {
      throw new Error('Task requires a block');
    }
    this.name = String(name);
    this.block = block;
  }

  /** Ruby Task[name] { ... } / Task.build に対応。 */
  static of<S = any>(name: string, block: TaskBlock<S>): Task<S> {
    return new Task(name, block);
  }

  call(focus: unknown, performer?: Perform): Result<S> {
    const root = ResultOps.coerceFocus<S>(focus);
    try {
      const result = ResultOps.normalize(this.invoke(root, performer));
      return result instanceof Err ? this.withTaskContext(result) : result;
    } catch (e) {
      if (e instanceof ControlSignal) {
        throw e;
      }
      const err = e as Error;
      return ResultOps.err(root, (err && err.name) || 'Error', (err && err.message) || String(e), {
        cause: e,
        failedNode: this.name,
        trace: [this.name],
      });
    }
  }

  then(other: BerylxNode<S>): BerylxNode<S> {
    return new Sequence<S>([this, other]);
  }

  par(other: BerylxNode<S>): BerylxNode<S> {
    return new Parallel<S>([this, other]);
  }

  /** Ruby Task#| は self >> other。 */
  pipe(other: BerylxNode<S>): BerylxNode<S> {
    return this.then(other);
  }

  rescueWith(handler: BerylxNode<S> | null, name?: string | null, block?: RescueHandlerBlock): BerylxNode<S> {
    return Sequence.buildRescue(this, handler, name, block);
  }

  compile(): Graph {
    return Graph.from(this);
  }

  nodes(): NamedNode[] {
    return [this];
  }

  /** 2 個以上の仮引数を宣言した Task だけが作用を要求する。 */
  effectful(): boolean {
    return this.block.length >= 2;
  }

  private withTaskContext(result: Err<S>): Err<S> {
    const error = result.error.failedNode ? result.error : result.error.prependTrace(this.name);
    return new Err(result.focus, error);
  }

  private invoke(root: Focus, performer?: Perform): unknown {
    if (!this.effectful()) {
      return (this.block as (focus: Focus) => unknown)(root);
    }
    if (!performer) {
      throw new Error(
        `task ${this.name} performs effects; run it through a handler map (EffectTree.run / Flow.call)`,
      );
    }
    return this.block(root, performer);
  }
}

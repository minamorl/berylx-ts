// ==================================================================
// AsyncTask — 非同期な名前つき状態遷移 (Task#call の Promise 版)。
//
// フェーズ 3-a: cray の Cray が Promise<Result> 前提なので、その移行対象を
// 満たすため berylx-ts に非同期 Task を足す。block は Focus を受け取り Focus か
// 結果封筒 (Ok/Err) を Promise で (または同期で) 返す。例外は捕捉して Err
// (failedNode/trace 付き) に変換する。意味論は Task と 1:1 で、違いは block を
// await する点だけ。
//
// 実行は EffectTree の async インタプリタ (EffectTree.runAsync) が担う。同期
// 経路 (call) では動かせないので、call は明示的に例外を投げてガードする
// (既存の同期実行系は一切壊さない)。
// ==================================================================

import { ResultOps, Err, type Result } from './result.js';
import { Focus } from './focus.js';
import type { BerylxNode, NamedNode } from './node.js';
import { Sequence } from './sequence.js';
import { Parallel } from './parallel.js';
import { Graph } from './graph.js';
import type { RescueHandlerBlock } from './rescue.js';

/** AsyncTask の本体。Focus を受け取り Focus/Result を Promise か同期で返す。 */
export type AsyncTaskBlock<S = any> = (
  focus: Focus<S, []>,
) => Promise<Focus<S, any> | Result<S> | unknown> | Focus<S, any> | Result<S> | unknown;

export class AsyncTask<S = any> implements BerylxNode<S>, NamedNode {
  readonly name: string;
  private readonly block: AsyncTaskBlock<S>;

  constructor(name: string, block: AsyncTaskBlock<S>) {
    if (typeof block !== 'function') {
      throw new Error('AsyncTask requires a block');
    }
    this.name = String(name);
    this.block = block;
  }

  /** Ruby Task[name] { ... } の非同期版 smart constructor。 */
  static of<S = any>(name: string, block: AsyncTaskBlock<S>): AsyncTask<S> {
    return new AsyncTask<S>(name, block);
  }

  /** block を await し、Focus/Result へ正規化する。例外は Err に写す。 */
  async callAsync(focus: unknown): Promise<Result<S>> {
    const root = ResultOps.coerceFocus<S>(focus);
    try {
      const result = ResultOps.normalize(await this.block(root));
      return result instanceof Err ? this.withTaskContext(result) : result;
    } catch (e) {
      const err = e as Error;
      return ResultOps.err(root, (err && err.name) || 'Error', (err && err.message) || String(e), {
        cause: e,
        failedNode: this.name,
        trace: [this.name],
      });
    }
  }

  /** 同期実行はできない。async 実行系 (EffectTree.runAsync / callAsync) を使う。 */
  call(_focus: unknown): Result<S> {
    throw new Error(
      `AsyncTask "${this.name}" is asynchronous: run it with EffectTree.runAsync or callAsync, not the sync path`,
    );
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

  rescueWith(
    handler: BerylxNode<S> | null,
    name?: string | null,
    block?: RescueHandlerBlock<S>,
  ): BerylxNode<S> {
    return Sequence.buildRescue<S>(this, handler, name, block);
  }

  compile(): Graph {
    return Graph.from(this);
  }

  nodes(): NamedNode[] {
    return [this];
  }

  private withTaskContext(result: Err<S>): Err<S> {
    const error = result.error.failedNode ? result.error : result.error.prependTrace(this.name);
    return new Err(result.focus, error);
  }
}

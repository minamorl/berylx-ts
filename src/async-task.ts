// Async tasks run through EffectTree.runAsync. Ordinary exceptions become Err
// results with task context; ControlSignal escapes the interpreter.

import { ResultOps, Err, type Result } from './result.js';
import { Focus } from './focus.js';
import type { BerylxNode, NamedNode } from './node.js';
import { Sequence } from './sequence.js';
import { Parallel } from './parallel.js';
import { Graph } from './graph.js';
import type { RescueHandlerBlock } from './rescue.js';
import { Perform } from './perform.js';
import { ControlSignal } from './control-signal.js';

/** Declare a second parameter to receive Perform for the current handler map. */
export type AsyncTaskBlock<S = any> = (
  focus: Focus<S, []>,
  performer: Perform,
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

  static of<S = any>(name: string, block: AsyncTaskBlock<S>): AsyncTask<S> {
    return new AsyncTask<S>(name, block);
  }

  /** Await the callback and normalize its output; ordinary exceptions become Err. */
  async callAsync(focus: unknown, performer?: Perform): Promise<Result<S>> {
    const root = ResultOps.coerceFocus<S>(focus);
    try {
      const result = ResultOps.normalize(await this.invoke(root, performer));
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

  /** Always throws. Use EffectTree.runAsync or callAsync to execute async tasks. */
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

  /** Effects are enabled only when the callback declares at least two parameters. */
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
        `task ${this.name} performs effects; run it through a handler map (EffectTree.runAsync)`,
      );
    }
    return this.block(root, performer);
  }
}

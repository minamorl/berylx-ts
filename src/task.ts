import { ResultOps, Err, type Result } from './result.js';
import { Focus } from './focus.js';
import type { BerylxNode, NamedNode } from './node.js';
import { Sequence } from './sequence.js';
import { Parallel } from './parallel.js';
import { Graph } from './graph.js';
import type { RescueHandlerBlock } from './rescue.js';
import { Perform } from './perform.js';
import { ControlSignal } from './control-signal.js';

/** Accepts a single-argument callback; declare a second parameter to receive Perform. */
export type TaskBlock<S = any> = (
  focus: Focus<S, []>,
  performer: Perform,
) => Focus<S, any> | Result<S> | unknown;

/** A named state transition. Ordinary exceptions become Err; ControlSignal escapes. */
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
        `task ${this.name} performs effects; run it through a handler map (EffectTree.run / Flow.call)`,
      );
    }
    return this.block(root, performer);
  }
}

// All branches start from the same base snapshot. Synchronous execution runs
// them in branch order; EffectTree owns error handling and result merging.
//
// The default three-way merge, Merge.strict, obeys these laws for base b:
//   μ_b(b, x) = x                         (left identity)
//   μ_b(x, b) = x                         (right identity)
//   Δ(l,b) ∩ Δ(r,b) = ∅  ⇒  preserve both updates
//   incompatible updates at the same path ⇒ Err(merge_conflict)
// Merge.deep ignores the base and does not satisfy these laws. Select it with
// .reduce(Merge.deep()) only when right-side precedence is intentional.

import type { Result } from './result.js';
import type { BerylxNode, NamedNode } from './node.js';
import type { RescueHandlerBlock } from './rescue.js';
import { Merge, type Reducer } from './merge.js';
import { Sequence } from './sequence.js';
import { EffectTree } from './effect-tree/index.js';
import { Graph } from './graph.js';

export type ParallelOnErr = 'short_circuit' | 'accumulate';

export class Parallel<S = any> implements BerylxNode<S> {
  readonly branches: readonly BerylxNode<S>[];
  readonly reducer: Reducer<S>;
  readonly onErr: ParallelOnErr;
  readonly workerLimit: number | undefined;

  constructor(
    branches: BerylxNode<S>[],
    reducer: Reducer<S> = Merge.strict<S>(),
    onErr: ParallelOnErr = 'short_circuit',
    workerLimit?: number,
  ) {
    if (workerLimit !== undefined && (!Number.isInteger(workerLimit) || workerLimit < 1)) {
      throw new RangeError('workers must be a positive integer');
    }
    this.branches = Object.freeze(
      branches.flatMap((b) => (b instanceof Parallel && b.workerLimit === undefined ? [...b.branches] : [b])),
    );
    this.reducer = reducer;
    this.onErr = onErr;
    this.workerLimit = workerLimit;
  }

  par(other: BerylxNode<S>): Parallel<S> {
    return this.workerLimit === undefined
      ? new Parallel<S>([...this.branches, other], this.reducer, this.onErr)
      : new Parallel<S>([this, other], this.reducer, this.onErr);
  }

  then(other: BerylxNode<S>): BerylxNode<S> {
    return new Sequence<S>([this, other]);
  }

  reduce(reducer: Reducer<S>): Parallel<S> {
    return new Parallel<S>([...this.branches], reducer, this.onErr, this.workerLimit);
  }

  workers(count: number): Parallel<S> {
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError('workers must be a positive integer');
    }
    return new Parallel<S>([...this.branches], this.reducer, this.onErr, count);
  }

  shortCircuit(): Parallel<S> {
    return new Parallel<S>([...this.branches], this.reducer, 'short_circuit', this.workerLimit);
  }

  accumulate(): Parallel<S> {
    return new Parallel<S>([...this.branches], this.reducer, 'accumulate', this.workerLimit);
  }

  rescueWith(
    handler: BerylxNode<S> | null,
    name?: string | null,
    block?: RescueHandlerBlock<S>,
  ): BerylxNode<S> {
    return Sequence.buildRescue<S>(this, handler, name, block);
  }

  call(focus: unknown): Result<S> {
    return EffectTree.run(this, focus);
  }

  compile(): Graph {
    return Graph.from(this);
  }

  nodes(): NamedNode[] {
    return this.branches.flatMap((b) => b.nodes());
  }
}

// ==================================================================
// Parallel — 並列合成 (Ruby &)。
//
// Ruby 版 Berylx::Parallel の TS 移植。ネストした Parallel は平坦化する。
// reducer (既定 Merge.deep) と on_err (既定 short_circuit) を保持し、実行は
// EffectTree に一本化する。短絡 / accumulate / merge の結果封筒 algebra は
// EffectTree.runParallel に集約している。
//
// Ruby は Thread で真の並列だったが、TS は Task#call が同期関数なので
// 各 branch を逐次実行する (branch 順で決定的)。セマンティクス (どの Err を
// 返すか / merge 結果) は Ruby と一致する。
// ==================================================================

import type { Result } from './result.js';
import type { BerylxNode, NamedNode } from './node.js';
import type { RescueHandlerBlock } from './rescue.js';
import { Merge, type Reducer } from './merge.js';
import { Sequence } from './sequence.js';
import { EffectTree } from './effect-tree/index.js';
import { Graph } from './graph.js';

export type ParallelOnErr = 'short_circuit' | 'accumulate';

export class Parallel implements BerylxNode {
  readonly branches: readonly BerylxNode[];
  readonly reducer: Reducer;
  readonly onErr: ParallelOnErr;

  constructor(
    branches: BerylxNode[],
    reducer: Reducer = Merge.deep(),
    onErr: ParallelOnErr = 'short_circuit',
  ) {
    this.branches = Object.freeze(
      branches.flatMap((b) => (b instanceof Parallel ? [...b.branches] : [b])),
    );
    this.reducer = reducer;
    this.onErr = onErr;
  }

  par(other: BerylxNode): BerylxNode {
    return new Parallel([...this.branches, other], this.reducer, this.onErr);
  }

  then(other: BerylxNode): BerylxNode {
    return new Sequence([this, other]);
  }

  reduce(reducer: Reducer): Parallel {
    return new Parallel([...this.branches], reducer, this.onErr);
  }

  shortCircuit(): Parallel {
    return new Parallel([...this.branches], this.reducer, 'short_circuit');
  }

  accumulate(): Parallel {
    return new Parallel([...this.branches], this.reducer, 'accumulate');
  }

  rescueWith(handler: BerylxNode | null, name?: string | null, block?: RescueHandlerBlock): BerylxNode {
    return Sequence.buildRescue(this, handler, name, block);
  }

  call(focus: unknown): Result {
    return EffectTree.run(this, focus);
  }

  compile(): Graph {
    return Graph.from(this);
  }

  nodes(): NamedNode[] {
    return this.branches.flatMap((b) => b.nodes());
  }
}

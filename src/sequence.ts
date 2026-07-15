// ==================================================================
// Sequence — 逐次合成 (Ruby >>)。
//
// Ruby 版 Berylx::Sequence の TS 移植。ネストした Sequence は平坦化する。
// 実行は EffectTree (darkcore Effect 木) に一本化し、短絡・Catch 境界の
// 回復といった結果封筒の algebra は EffectTree 側に集約する。
// ==================================================================

import type { Result } from './result.js';
import type { BerylxNode, NamedNode } from './node.js';
import { Parallel } from './parallel.js';
import { Rescue, RescueBlock, type RescueHandlerBlock } from './rescue.js';
import { EffectTree } from './effect-tree/index.js';
import { Graph } from './graph.js';

export class Sequence implements BerylxNode {
  readonly steps: readonly BerylxNode[];

  constructor(steps: BerylxNode[]) {
    this.steps = Object.freeze(
      steps.flatMap((s) => (s instanceof Sequence ? [...s.steps] : [s])),
    );
  }

  then(other: BerylxNode): BerylxNode {
    return new Sequence([...this.steps, other]);
  }

  par(other: BerylxNode): BerylxNode {
    return new Parallel([this, other]);
  }

  rescueWith(handler: BerylxNode | null, name?: string | null, block?: RescueHandlerBlock): BerylxNode {
    return Sequence.buildRescue(this, handler, name, block);
  }

  /** Ruby Sequence.build_rescue: block があれば RescueBlock を、無ければ handler を使う。 */
  static buildRescue(
    body: BerylxNode,
    handler: BerylxNode | null,
    name?: string | null,
    block?: RescueHandlerBlock,
  ): Rescue {
    const rescueHandler = block ? new RescueBlock(name ?? 'rescue', block) : handler;
    if (!rescueHandler) {
      throw new Error('rescueWith requires a task or block');
    }
    return new Rescue(body, rescueHandler);
  }

  call(focus: unknown): Result {
    return EffectTree.run(this, focus);
  }

  compile(): Graph {
    return Graph.from(this);
  }

  nodes(): NamedNode[] {
    return this.steps.flatMap((s) => s.nodes());
  }
}

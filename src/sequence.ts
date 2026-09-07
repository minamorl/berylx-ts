// Nested sequences are flattened. EffectTree owns short-circuiting and
// recovery at Catch boundaries.

import type { Result } from './result.js';
import type { BerylxNode, NamedNode } from './node.js';
import { Parallel } from './parallel.js';
import { Rescue, RescueBlock, type RescueHandlerBlock } from './rescue.js';
import { EffectTree } from './effect-tree/index.js';
import { Graph } from './graph.js';

export class Sequence<S = any> implements BerylxNode<S> {
  readonly steps: readonly BerylxNode<S>[];

  constructor(steps: BerylxNode<S>[]) {
    this.steps = Object.freeze(
      steps.flatMap((s) => (s instanceof Sequence ? [...s.steps] : [s])),
    );
  }

  then(other: BerylxNode<S>): BerylxNode<S> {
    return new Sequence<S>([...this.steps, other]);
  }

  par(other: BerylxNode<S>): BerylxNode<S> {
    return new Parallel<S>([this, other]);
  }

  rescueWith(
    handler: BerylxNode<S> | null,
    name?: string | null,
    block?: RescueHandlerBlock<S>,
  ): BerylxNode<S> {
    return Sequence.buildRescue<S>(this, handler, name, block);
  }

  /** Prefer a supplied recovery callback over the handler node. */
  static buildRescue<S = any>(
    body: BerylxNode<S>,
    handler: BerylxNode<S> | null,
    name?: string | null,
    block?: RescueHandlerBlock<S>,
  ): Rescue<S> {
    const rescueHandler = block ? new RescueBlock<S>(name ?? 'rescue', block) : handler;
    if (!rescueHandler) {
      throw new Error('rescueWith requires a task or block');
    }
    return new Rescue<S>(body, rescueHandler);
  }

  call(focus: unknown): Result<S> {
    return EffectTree.run(this, focus);
  }

  compile(): Graph {
    return Graph.from(this);
  }

  nodes(): NamedNode[] {
    return this.steps.flatMap((s) => s.nodes());
  }
}

// EffectTree owns branch selection and the no_branch_matched result.

import type { Result } from './result.js';
import type { BerylxNode, NamedNode } from './node.js';
import type { RescueHandlerBlock } from './rescue.js';
import { Focus } from './focus.js';
import { Sequence } from './sequence.js';
import { Parallel } from './parallel.js';
import { EffectTree } from './effect-tree/index.js';

/** A branch predicate; elseBranch marks an unconditional fallback. */
export interface Predicate<S = any> {
  readonly name: string;
  readonly block: ((focus: Focus<S, []>) => unknown) | null;
  readonly elseBranch: boolean;
}

/** A predicate paired with the workflow to run when it matches. */
export interface BranchArm<S = any> {
  readonly predicate: Predicate<S>;
  readonly body: BerylxNode<S>;
}

export class When<S = any> {
  private readonly predicate: Predicate<S>;

  constructor(name: string, block: ((focus: Focus<S, []>) => unknown) | null, elseBranch: boolean) {
    if (!block && !elseBranch) {
      throw new Error('When requires a predicate block');
    }
    this.predicate = { name: String(name), block, elseBranch };
  }

  static of<S = any>(name: string, block: (focus: Focus<S, []>) => unknown): When<S> {
    return new When<S>(name, block, false);
  }

  /** Pair this predicate with a body to create a single-arm branch. */
  then(other: BerylxNode<S>): Branch<S> {
    return new Branch<S>([{ predicate: this.predicate, body: other }]);
  }
}

/** An unconditional fallback arm, used as Else.then(body). */
export const Else = new When('else', null, true);

export class Branch<S = any> implements BerylxNode<S> {
  readonly arms: readonly BranchArm<S>[];

  constructor(arms: BranchArm<S>[]) {
    this.arms = Object.freeze([...arms]);
  }

  /** Append the other branch's arms in order. */
  or(other: Branch<S>): Branch<S> {
    return new Branch<S>([...this.arms, ...other.arms]);
  }

  then(other: BerylxNode<S>): BerylxNode<S> {
    return new Sequence<S>([this, other]);
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

  call(focus: unknown): Result<S> {
    return EffectTree.run(this, focus);
  }

  nodes(): NamedNode[] {
    return this.arms.flatMap((arm) => arm.body.nodes());
  }
}

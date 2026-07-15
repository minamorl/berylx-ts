// ==================================================================
// Branch — 条件分岐 (Ruby When / Else / Branch)。
//
// Ruby 版 Berylx::Branch の TS 移植。When[name] { predicate } >> body で
// arm を作り、branch | branch で arm を連ねる。実行は EffectTree に一本化し、
// arm 選択と no_branch_matched の algebra は EffectTree.runBranch に集約する。
// ==================================================================

import type { Result } from './result.js';
import type { BerylxNode, NamedNode } from './node.js';
import type { RescueHandlerBlock } from './rescue.js';
import { Focus } from './focus.js';
import { Sequence } from './sequence.js';
import { Parallel } from './parallel.js';
import { EffectTree } from './effect-tree/index.js';

/** 述語 (Ruby Predicate)。else_branch なら常に真。 */
export interface Predicate {
  readonly name: string;
  readonly block: ((focus: Focus) => unknown) | null;
  readonly elseBranch: boolean;
}

/** 分岐の 1 本 (Ruby BranchArm)。 */
export interface BranchArm {
  readonly predicate: Predicate;
  readonly body: BerylxNode;
}

export class When {
  private readonly predicate: Predicate;

  constructor(name: string, block: ((focus: Focus) => unknown) | null, elseBranch: boolean) {
    if (!block && !elseBranch) {
      throw new Error('When requires a predicate block');
    }
    this.predicate = { name: String(name), block, elseBranch };
  }

  /** Ruby When[name] { block } に対応。 */
  static of(name: string, block: (focus: Focus) => unknown): When {
    return new When(name, block, false);
  }

  /** Ruby When#>> : arm を 1 本持つ Branch を作る。 */
  then(other: BerylxNode): Branch {
    return new Branch([{ predicate: this.predicate, body: other }]);
  }
}

/** Ruby Else 定数相当。常に真の arm を作る。 */
export const Else = new When('else', null, true);

export class Branch implements BerylxNode {
  readonly arms: readonly BranchArm[];

  constructor(arms: BranchArm[]) {
    this.arms = Object.freeze([...arms]);
  }

  /** Ruby Branch#| : arm を連結する。 */
  or(other: Branch): Branch {
    return new Branch([...this.arms, ...other.arms]);
  }

  then(other: BerylxNode): BerylxNode {
    return new Sequence([this, other]);
  }

  par(other: BerylxNode): BerylxNode {
    return new Parallel([this, other]);
  }

  rescueWith(handler: BerylxNode | null, name?: string | null, block?: RescueHandlerBlock): BerylxNode {
    return Sequence.buildRescue(this, handler, name, block);
  }

  call(focus: unknown): Result {
    return EffectTree.run(this, focus);
  }

  nodes(): NamedNode[] {
    return this.arms.flatMap((arm) => arm.body.nodes());
  }
}

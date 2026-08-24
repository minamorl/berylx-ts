// ==================================================================
// Flow — 実行のエントリ。
//
// Ruby 版 Berylx::Flow の TS 移植。focus を起点に、合成子でも単発 Task でも
// EffectTree (darkcore Effect 木) を必ず通して実行する。
// ==================================================================

import { ResultOps, type Result } from './result.js';
import { Focus } from './focus.js';
import type { BerylxNode } from './node.js';
import { EffectTree } from './effect-tree/index.js';
import type { HandlerMap } from './darkcore.js';

export class Flow {
  readonly focus: Focus;

  constructor(focus: unknown) {
    this.focus = ResultOps.coerceFocus(focus);
  }

  /** Ruby Flow[focus] に対応。 */
  static of(focus: unknown): Flow {
    return new Flow(focus);
  }

  /**
   * 実行の唯一のエントリ。合成子でも単発 Task でも EffectTree を必ず通す。
   * Task は葉として EffectTree の TASK handler が Task#call を呼ぶ。
   */
  call(node: BerylxNode, handlers: HandlerMap = EffectTree.realHandlers()): Result {
    return EffectTree.run(node, this.focus, handlers);
  }

  /** Ruby Flow#>> は call のエイリアス。 */
  then(other: BerylxNode): Result {
    return this.call(other);
  }
}

// ==================================================================
// Rescue / Catch / RescueBlock — 失敗回復の合成子。
//
// Ruby 版 Berylx::RescueBlock / Berylx::Catch / Berylx::Rescue の TS 移植。
//   RescueBlock : (error, focus) を受け取り回復した結果封筒を返すブロック handler。
//   Catch       : Sequence 内の短絡境界。既定では fatal エラーを回復しない。
//   Rescue      : body の Err を回復 handler で差し替える合成子。
// 実行はいずれも EffectTree に委譲する。
// ==================================================================

import { ResultOps, Ok, Err, type Result } from './result.js';
import { Focus } from './focus.js';
import type { BerylxError } from './error.js';
import type { BerylxNode, NamedNode } from './node.js';
import { Sequence } from './sequence.js';
import { Parallel } from './parallel.js';
import { EffectTree } from './effect-tree/index.js';
import { Perform } from './perform.js';
import { ControlSignal } from './control-signal.js';

/** 回復ブロック handler。本体の第三引数には現在の handler map の Perform が渡る。 */
export type RescueHandlerBlock = (
  error: unknown,
  focus: Focus,
  performer: Perform,
) => Focus | Result | unknown;

/** ブロックで回復する handler (Ruby RescueBlock)。 */
export class RescueBlock implements NamedNode {
  readonly name: string;
  private readonly block: RescueHandlerBlock;

  constructor(name: string, block: RescueHandlerBlock) {
    this.name = String(name);
    this.block = block;
  }

  /** error_result から回復を試みる。error は cause 優先 (無ければ構造化エラー)。 */
  call(focus: Focus, errorResult: Err, performer?: Perform): Result {
    try {
      const errArg = errorResult.error.cause ?? errorResult.error;
      const output = this.effectful()
        ? this.block(errArg, focus, performer as Perform)
        : (this.block as (error: unknown, focus: Focus) => unknown)(errArg, focus);
      const result = ResultOps.normalize(output);
      return result instanceof Err ? this.withRescueContext(result) : result;
    } catch (e) {
      if (e instanceof ControlSignal) {
        throw e;
      }
      const err = e as Error;
      return ResultOps.err(focus, (err && err.name) || 'Error', (err && err.message) || String(e), {
        cause: e,
        failedNode: this.name,
        trace: [this.name],
      });
    }
  }

  nodes(): NamedNode[] {
    return [this];
  }

  /** 3 個以上の仮引数を宣言した recovery block だけが作用を要求する。 */
  effectful(): boolean {
    return this.block.length >= 3;
  }

  private withRescueContext(result: Err): Err {
    const error = result.error.failedNode ? result.error : result.error.prependTrace(this.name);
    return new Err(result.focus, error);
  }
}

/** 回復 handler は RescueBlock か call を持つノード (Task 等)。 */
export type RescueHandler = RescueBlock | BerylxNode;

/** Catch のオプション (Ruby options)。 */
export interface CatchOptions {
  fatal?: boolean;
}

/** Sequence 内の短絡境界 (Ruby Catch)。 */
export class Catch implements BerylxNode {
  readonly name: string;
  readonly handler: RescueHandler;
  private readonly catchesTerminal: boolean;

  constructor(
    name: string = 'catch',
    handler: RescueHandler | null = null,
    options: CatchOptions = {},
    block?: RescueHandlerBlock,
  ) {
    this.name = String(name);
    this.handler = block ? new RescueBlock(this.name, block) : (handler as RescueHandler);
    this.catchesTerminal = options.fatal ?? false;
    if (!this.handler) {
      throw new Error('Catch requires a task or block');
    }
  }

  /** Ruby Catch[name, **options] { block } に対応。 */
  static of(
    name: string = 'catch',
    handler: RescueHandler | null = null,
    options: CatchOptions = {},
    block?: RescueHandlerBlock,
  ): Catch {
    return new Catch(name, handler, options, block);
  }

  /** この Catch が当該エラーを回復対象にするか。 */
  catches(errorResult: Err): boolean {
    return !this.terminal(errorResult.error) || this.catchesTerminal;
  }

  call(focus: unknown): Result {
    return EffectTree.run(this, focus);
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

  nodes(): NamedNode[] {
    const h = this.handler as { nodes?: () => NamedNode[] };
    return typeof h.nodes === 'function' ? h.nodes() : [this as unknown as NamedNode];
  }

  private terminal(error: BerylxError): boolean {
    return error.fatal();
  }
}

/** body の Err を回復 handler で差し替える合成子 (Ruby Rescue)。 */
export class Rescue implements BerylxNode {
  readonly body: BerylxNode;
  readonly handler: RescueHandler;

  constructor(body: BerylxNode, handler: RescueHandler) {
    this.body = body;
    this.handler = handler;
  }

  call(focus: unknown): Result {
    return EffectTree.run(this, focus);
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

  nodes(): NamedNode[] {
    const bodyNodes = this.body.nodes();
    const h = this.handler as { nodes?: () => NamedNode[] };
    const handlerNodes = typeof h.nodes === 'function' ? h.nodes() : [];
    return [...bodyNodes, ...handlerNodes];
  }
}

export { Ok, Err };

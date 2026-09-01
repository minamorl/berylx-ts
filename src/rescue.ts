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
export type RescueHandlerBlock<S = any> = (
  error: unknown,
  focus: Focus<S, []>,
  performer: Perform,
) => Focus<S, any> | Result<S> | unknown;

/** ブロックで回復する handler (Ruby RescueBlock)。 */
export class RescueBlock<S = any> implements NamedNode {
  readonly name: string;
  private readonly block: RescueHandlerBlock<S>;

  constructor(name: string, block: RescueHandlerBlock<S>) {
    this.name = String(name);
    this.block = block;
  }

  /** error_result から回復を試みる。error は cause 優先 (無ければ構造化エラー)。 */
  call(focus: Focus<S, []>, errorResult: Err<S>, performer?: Perform): Result<S> {
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

  private withRescueContext(result: Err<S>): Err<S> {
    const error = result.error.failedNode ? result.error : result.error.prependTrace(this.name);
    return new Err(result.focus, error);
  }
}

/** 回復 handler は RescueBlock か call を持つノード (Task 等)。 */
export type RescueHandler<S = any> = RescueBlock<S> | BerylxNode<S>;

/** Catch のオプション (Ruby options)。 */
export interface CatchOptions {
  fatal?: boolean;
}

/** Sequence 内の短絡境界 (Ruby Catch)。 */
export class Catch<S = any> implements BerylxNode<S> {
  readonly name: string;
  readonly handler: RescueHandler<S>;
  private readonly catchesTerminal: boolean;

  constructor(
    name: string = 'catch',
    handler: RescueHandler<S> | null = null,
    options: CatchOptions = {},
    block?: RescueHandlerBlock<S>,
  ) {
    this.name = String(name);
    this.handler = block ? new RescueBlock<S>(this.name, block) : (handler as RescueHandler<S>);
    this.catchesTerminal = options.fatal ?? false;
    if (!this.handler) {
      throw new Error('Catch requires a task or block');
    }
  }

  /** Ruby Catch[name, **options] { block } に対応。 */
  static of<S = any>(
    name: string = 'catch',
    handler: RescueHandler<S> | null = null,
    options: CatchOptions = {},
    block?: RescueHandlerBlock<S>,
  ): Catch<S> {
    return new Catch<S>(name, handler, options, block);
  }

  /** この Catch が当該エラーを回復対象にするか。 */
  catches(errorResult: Err<S>): boolean {
    return !this.terminal(errorResult.error) || this.catchesTerminal;
  }

  call(focus: unknown): Result<S> {
    return EffectTree.run(this, focus);
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

  nodes(): NamedNode[] {
    const h = this.handler as { nodes?: () => NamedNode[] };
    return typeof h.nodes === 'function' ? h.nodes() : [this as unknown as NamedNode];
  }

  private terminal(error: BerylxError): boolean {
    return error.fatal();
  }
}

/** body の Err を回復 handler で差し替える合成子 (Ruby Rescue)。 */
export class Rescue<S = any> implements BerylxNode<S> {
  readonly body: BerylxNode<S>;
  readonly handler: RescueHandler<S>;

  constructor(body: BerylxNode<S>, handler: RescueHandler<S>) {
    this.body = body;
    this.handler = handler;
  }

  call(focus: unknown): Result<S> {
    return EffectTree.run(this, focus);
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

  nodes(): NamedNode[] {
    const bodyNodes = this.body.nodes();
    const h = this.handler as { nodes?: () => NamedNode[] };
    const handlerNodes = typeof h.nodes === 'function' ? h.nodes() : [];
    return [...bodyNodes, ...handlerNodes];
  }
}

export { Ok, Err };

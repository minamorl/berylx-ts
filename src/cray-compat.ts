// ==================================================================
// cray Result 互換シム — cray の Success/Failure ⇄ berylx Ok/Err 相互変換。
//
// フェーズ 3-b: 消費側を段階置換できるよう、cray の結果封筒 (Success/Failure) と
// berylx の結果封筒 (Ok/Err) を橋渡しするアダプタを提供する。cray の任意型 E は
// MIGRATION.md の方針に従って BerylxError へ畳む:
//   - E が既に BerylxError            → そのまま採用。
//   - E が Error                      → code=name / message=message / cause=E、
//                                       metadata.crayError に原値を退避。
//   - E が string                     → code=E に写す (message も E)。
//   - それ以外 (任意オブジェクト等)   → code='cray_failure'、metadata.crayError へ畳む。
//
// cray 本体は berylx-ts に無いので、シムは自前の CraySuccess/CrayFailure を
// 提供しつつ、外来の cray 風オブジェクト (isSuccess/isFailure・{success}・
// {tag} など) も構造的に受理する。
// ==================================================================

import { Ok, Err, ResultOps, type Result } from './result.js';
import { Focus } from './focus.js';
import { BerylxError } from './error.js';

/** cray の Success 相当 (成功値 value を運ぶ)。 */
export class CraySuccess<T = unknown> {
  readonly value: T;

  constructor(value: T) {
    this.value = value;
  }

  isSuccess(): this is CraySuccess<T> {
    return true;
  }

  isFailure(): boolean {
    return false;
  }
}

/** cray の Failure 相当 (任意型のエラー error を運ぶ)。 */
export class CrayFailure<E = unknown> {
  readonly error: E;

  constructor(error: E) {
    this.error = error;
  }

  isSuccess(): boolean {
    return false;
  }

  isFailure(): this is CrayFailure<E> {
    return true;
  }
}

export type CrayResult<T = unknown, E = unknown> = CraySuccess<T> | CrayFailure<E>;

/** Ruby module 相当の smart constructor。 */
export const Cray = {
  success: <T>(value: T): CraySuccess<T> => new CraySuccess(value),
  failure: <E>(error: E): CrayFailure<E> => new CrayFailure(error),
};

/** 任意の cray 風オブジェクトが成功かを構造的に判定する。 */
function craySucceeded(result: unknown): boolean {
  if (result instanceof CraySuccess) {
    return true;
  }
  if (result instanceof CrayFailure) {
    return false;
  }
  const r = result as Record<string, unknown> | null;
  if (r == null) {
    return false;
  }
  if (typeof r.isSuccess === 'function') {
    return Boolean((r.isSuccess as () => unknown)());
  }
  if (typeof r.isFailure === 'function') {
    return !(r.isFailure as () => unknown)();
  }
  if ('success' in r) {
    return Boolean(r.success);
  }
  if ('ok' in r) {
    return Boolean(r.ok);
  }
  if ('tag' in r) {
    return r.tag === 'success' || r.tag === 'ok' || r.tag === 'right';
  }
  // value を持ち error を持たないなら成功とみなす。
  return 'value' in r && !('error' in r);
}

/** cray の任意型エラー E を BerylxError に畳んで Err を作る。 */
function foldCrayError(error: unknown, focus?: unknown): Err {
  const f = ResultOps.coerceFocus(focus ?? {});
  if (error instanceof BerylxError) {
    return new Err(f, error);
  }
  if (error instanceof Error) {
    return ResultOps.err(f, error.name || 'Error', error.message, {
      cause: error,
      metadata: { crayError: error },
    }) as Err;
  }
  if (typeof error === 'string') {
    return ResultOps.err(f, error, error, { metadata: { crayError: error } }) as Err;
  }
  return ResultOps.err(f, 'cray_failure', 'cray failure', { metadata: { crayError: error } }) as Err;
}

/**
 * cray Success/Failure → berylx Ok/Err。成功は value を Focus に強制変換して Ok に、
 * 失敗は error を BerylxError へ畳んで Err にする。focus は失敗時の部分状態の
 * フォールバック (成功時は value 由来の Focus を優先する)。
 */
export function fromCrayResult(result: unknown, focus?: unknown): Result {
  if (craySucceeded(result)) {
    const value = (result as { value?: unknown }).value;
    if (value instanceof Focus) {
      return new Ok(value);
    }
    return ResultOps.ok(value !== undefined ? value : focus);
  }
  const error = (result as { error?: unknown }).error;
  return foldCrayError(error, focus);
}

/**
 * berylx Ok/Err → cray Success/Failure。Ok は焦点の生値を Success に、Err は
 * 構造化 BerylxError を Failure に載せる (消費側は code/message/metadata を読める)。
 */
export function toCrayResult(result: Result): CrayResult {
  if (result instanceof Ok) {
    return new CraySuccess(result.focus.toObject());
  }
  return new CrayFailure(result.error);
}

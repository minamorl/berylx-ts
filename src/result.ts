// ==================================================================
// Result — berylx の結果封筒 Ok(focus) / Err(focus, error)。
//
// Ruby 版 Berylx::Ok / Berylx::Err / Berylx::Result の TS 移植。
// Ruby の演算子は TS では以下のメソッドへ写す:
//   Ok#| / Err#|  (継続への bind / 短絡) → .pipe(node)
//
// Focus とは相互参照するが、参照は実行時 (メソッド呼び出し時) のみなので
// ESM の循環 import で解決できる。
// ==================================================================

import { BerylxError, type BerylxErrorContext } from './error.js';
import { Focus } from './focus.js';

/** call 可能な berylx ノード (Task / 合成子)。focus を受け取り結果封筒を返す。 */
export interface Callable {
  call(focus: unknown): Result;
}

/**
 * 結果封筒。S は workflow の状態のルート型で、Ok/Err のどちらでも focus は
 * 同じ S を指す。失敗しても部分状態を捨てないので、Err 側も焦点を型付きで運ぶ。
 */
export type Result<S = any> = Ok<S> | Err<S>;

/** 成功封筒。焦点 (focus) を運ぶ。 */
export class Ok<S = any> {
  readonly focus: Focus<S, []>;

  constructor(focus: Focus<S, []>) {
    this.focus = focus;
  }

  /** Ruby Ok#| : 次のノードへ bind (focus を渡して実行)。 */
  pipe(node: Callable): Result<S> {
    return ResultOps.bind(this, (current) => node.call(current));
  }

  isOk(): this is Ok<S> {
    return true;
  }

  isErr(): this is Err<S> {
    return false;
  }
}

/** 失敗封筒。部分状態 (focus) と構造化エラー (error) を運ぶ。 */
export class Err<S = any> {
  readonly focus: Focus<S, []>;
  readonly error: BerylxError;

  constructor(focus: Focus<S, []>, error: BerylxError) {
    this.focus = focus;
    this.error = error;
  }

  /** 下層例外 (あれば) を投げる。 */
  unwrap(): never {
    throw this.error.unwrap();
  }

  toException(): unknown {
    return this.error.toException();
  }

  get code(): string {
    return this.error.code;
  }

  get message(): string {
    return this.error.message;
  }

  get cause(): unknown {
    return this.error.cause;
  }

  get failedNode(): string | null {
    return this.error.failedNode;
  }

  get trace(): readonly string[] {
    return this.error.trace;
  }

  get parallelErrors(): readonly BerylxError[] {
    return this.error.parallelErrors;
  }

  /** Ruby Err#| : 短絡。以降のノードは実行せず自分を返す。 */
  pipe(_node: Callable): Result {
    return this;
  }

  isOk(): this is Ok {
    return false;
  }

  isErr(): this is Err {
    return true;
  }
}

/** Result 圏の演算 (Ruby module Berylx::Result 相当)。 */
export const ResultOps = {
  ok<S = any>(value: unknown): Ok<S> {
    return new Ok(ResultOps.coerceFocus(value));
  },

  err<S = any>(
    value: unknown,
    codeOrError: string | BerylxError,
    message?: string,
    context: BerylxErrorContext = {},
  ): Err<S> {
    const error =
      codeOrError instanceof BerylxError
        ? codeOrError.withContext(context)
        : BerylxError.create(codeOrError, message ?? String(codeOrError), context);
    return new Err(ResultOps.coerceFocus(value), error);
  },

  /** 値が既に Ok/Err ならそのまま、そうでなければ Ok に包む。 */
  normalize<S = any>(value: unknown): Result<S> {
    if (value instanceof Ok || value instanceof Err) {
      return value;
    }
    return ResultOps.ok(value);
  },

  /** 値を Focus に強制変換する (既に Focus ならそのまま)。 */
  coerceFocus<S = any>(value: unknown): Focus<S, []> {
    if (value instanceof Focus) {
      return value as Focus<S, []>;
    }
    return Focus.of(value) as Focus<S, []>;
  },

  map<S = any>(result: Result<S>, block: (focus: Focus<S, []>) => unknown): Result<S> {
    if (result instanceof Ok) {
      return ResultOps.normalize(block(result.focus));
    }
    return result;
  },

  bind<S = any>(result: Result<S>, block: (focus: Focus<S, []>) => unknown): Result<S> {
    if (result instanceof Ok) {
      return ResultOps.normalize(block(result.focus));
    }
    return result;
  },
};

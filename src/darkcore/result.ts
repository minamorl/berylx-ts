// ==================================================================
// Result — 失敗に理由 (エラー値) を持たせる Either 系。Ok で継続 / Err で短絡。
//
// darkcore-ruby result.rb の TS 移植。
//
// 【名前空間の分離】(spec: beryl.namespace = separate_namespace)
//   darkcore の Ok/Err は berylx の result.ts の Ok/Err とは【別物】。
//   本 module は darkcore/ 配下に閉じ、外部へは `Darkcore.Ok` /
//   `Darkcore.Err` (= `export * as Darkcore`) としてのみ露出する。berylx の
//   トップレベル Ok/Err とは衝突しない。union 型は誤用を避けるため
//   `DarkcoreResult` と名付ける。
// ==================================================================

import { deriveFmap, deriveAp } from './monad.js';

export type DarkcoreResult<A, E> = Ok<A> | Err<E>;

/** 成功値を運び、継続する枝。 */
export class Ok<A> {
  readonly value: A;

  constructor(value: A) {
    this.value = value;
  }

  static pure<A, E>(x: A): DarkcoreResult<A, E> {
    return new Ok(x);
  }

  bind<B, E>(f: (a: A) => DarkcoreResult<B, E>): DarkcoreResult<B, E> {
    return f(this.value);
  }

  fmap<B, E>(f: (a: A) => B): DarkcoreResult<B, E> {
    return deriveFmap<A, B, DarkcoreResult<B, E>>((g) => this.bind(g), (b) => new Ok(b), f);
  }

  map<B, E>(f: (a: A) => B): DarkcoreResult<B, E> {
    return this.fmap(f);
  }

  ap<B, E>(other: DarkcoreResult<unknown, E>): DarkcoreResult<B, E> {
    return deriveAp<unknown, B, DarkcoreResult<B, E>>(
      (g) => this.bind((fn) => g(fn as (a: unknown) => B)),
      (h) => (other as { fmap(fn: (a: unknown) => B): DarkcoreResult<B, E> }).fmap(h),
    );
  }

  seq<B, E>(next: DarkcoreResult<B, E>): DarkcoreResult<B, E> {
    return this.bind(() => next);
  }

  isOk(): this is Ok<A> {
    return true;
  }

  isErr(): boolean {
    return false;
  }
}

/** エラーを伝播し、以降の bind を素通り (短絡) する枝。 */
export class Err<E> {
  readonly error: E;

  constructor(error: E) {
    this.error = error;
  }

  static pure<A, E>(x: A): DarkcoreResult<A, E> {
    return new Ok(x);
  }

  bind<B>(_f: (a: never) => DarkcoreResult<B, E>): DarkcoreResult<B, E> {
    return this;
  }

  fmap<B>(_f: (a: never) => B): DarkcoreResult<B, E> {
    return this;
  }

  map<B>(_f: (a: never) => B): DarkcoreResult<B, E> {
    return this;
  }

  ap<B>(_other: DarkcoreResult<unknown, E>): DarkcoreResult<B, E> {
    return this;
  }

  seq<B>(_next: DarkcoreResult<B, E>): DarkcoreResult<B, E> {
    return this;
  }

  isOk(): boolean {
    return false;
  }

  isErr(): this is Err<E> {
    return true;
  }
}

/** Ruby module Result 相当の smart constructor 群。 */
export const Result = {
  pure: <A, E>(x: A): DarkcoreResult<A, E> => new Ok(x),
  ok: <A, E>(x: A): DarkcoreResult<A, E> => new Ok(x),
  err: <A, E>(e: E): DarkcoreResult<A, E> => new Err(e),

  /** 例外を Result 化する典型ユーティリティ (例外は message を Err へ)。 */
  try_: <A>(block: () => A): DarkcoreResult<A, string> => {
    try {
      return new Ok(block());
    } catch (e) {
      return new Err(e instanceof Error ? e.message : String(e));
    }
  },
};

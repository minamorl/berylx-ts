// ==================================================================
// Validation — Result と違い「短絡せずエラーを集める」Applicative。
//
// darkcore-ruby validation.rb の TS 移植。fmap は Monad から導出するが、ap は
// 【あえて上書き】する。エラー累積の ap は bind から導出できない (bind は必ず
// 短絡する) ため。errors は Semigroup 結合 (配列連結) で貯める。bind は短絡。
// ==================================================================

import { deriveFmap } from './monad.js';

export type Validation<A, E> = Success<A> | Failure<E>;

/** 成功値を運ぶ枝。ap は相手が Failure ならそのエラーを採用する。 */
export class Success<A> {
  readonly value: A;

  constructor(value: A) {
    this.value = value;
  }

  static pure<A, E>(x: A): Validation<A, E> {
    return new Success(x);
  }

  bind<B, E>(f: (a: A) => Validation<B, E>): Validation<B, E> {
    return f(this.value);
  }

  fmap<B, E>(f: (a: A) => B): Validation<B, E> {
    return deriveFmap<A, B, Validation<B, E>>((g) => this.bind(g), (b) => new Success(b), f);
  }

  map<B, E>(f: (a: A) => B): Validation<B, E> {
    return this.fmap(f);
  }

  /**
   * self は「関数を包んだ Success」。other が Success なら関数適用、Failure なら
   * 相手のエラーを採用する (エラーは短絡せず相手から引き継ぐ)。
   */
  ap<B, E>(other: Validation<unknown, E>): Validation<B, E> {
    if (other instanceof Success) {
      return other.fmap((x) => (this.value as (a: unknown) => B)(x));
    }
    return other as Failure<E>;
  }

  seq<B, E>(next: Validation<B, E>): Validation<B, E> {
    return this.bind(() => next);
  }

  isSuccess(): this is Success<A> {
    return true;
  }

  isFailure(): boolean {
    return false;
  }
}

/** エラーを貯める枝。bind/fmap は短絡し、ap は Semigroup でエラーを累積する。 */
export class Failure<E> {
  readonly errors: readonly E[];

  constructor(errors: readonly E[]) {
    this.errors = errors;
  }

  static pure<A, E>(x: A): Validation<A, E> {
    return new Success(x);
  }

  bind<B>(_f: (a: never) => Validation<B, E>): Validation<B, E> {
    return this;
  }

  fmap<B>(_f: (a: never) => B): Validation<B, E> {
    return this;
  }

  map<B>(_f: (a: never) => B): Validation<B, E> {
    return this;
  }

  /** Success なら自分のエラーを保つ、Failure なら両者のエラーを連結 (累積)。 */
  ap<B>(other: Validation<unknown, E>): Validation<B, E> {
    if (other instanceof Failure) {
      return new Failure<E>([...this.errors, ...other.errors]);
    }
    return this;
  }

  seq<B>(_next: Validation<B, E>): Validation<B, E> {
    return this;
  }

  isSuccess(): boolean {
    return false;
  }

  isFailure(): this is Failure<E> {
    return true;
  }
}

/** Ruby module Validation 相当。failure(*es) は引数を flatten して貯める。 */
export const Validation = {
  pure: <A, E>(x: A): Validation<A, E> => new Success(x),
  success: <A, E>(x: A): Validation<A, E> => new Success(x),
  failure: <A, E>(...es: (E | E[])[]): Validation<A, E> =>
    new Failure<E>(es.flat() as E[]),
};

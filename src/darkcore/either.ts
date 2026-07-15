// ==================================================================
// Either — Left で短絡 / Right で継続 (Result と同型の教科書版)。
//
// darkcore-ruby either.rb の TS 移植。Left は bind/fmap/ap を素通り (短絡)、
// Right は継続する。pure = Right。fmap/ap は Monad の導出を使う。
// ==================================================================

import { deriveFmap, deriveAp } from './monad.js';

export type Either<L, R> = Left<L> | Right<R>;

/** 失敗値を運び、以降を短絡する枝。 */
export class Left<L> {
  readonly value: L;

  constructor(value: L) {
    this.value = value;
  }

  static pure<L, R>(x: R): Either<L, R> {
    return new Right(x);
  }

  bind<R2>(_f: (r: never) => Either<L, R2>): Either<L, R2> {
    return this;
  }

  fmap<R2>(_f: (r: never) => R2): Either<L, R2> {
    return this;
  }

  map<R2>(_f: (r: never) => R2): Either<L, R2> {
    return this;
  }

  ap<R2>(_other: Either<L, unknown>): Either<L, R2> {
    return this;
  }

  seq<R2>(_next: Either<L, R2>): Either<L, R2> {
    return this;
  }

  isLeft(): this is Left<L> {
    return true;
  }

  isRight(): boolean {
    return false;
  }
}

/** 成功値を運び、継続する枝。 */
export class Right<R> {
  readonly value: R;

  constructor(value: R) {
    this.value = value;
  }

  static pure<L, R>(x: R): Either<L, R> {
    return new Right(x);
  }

  bind<L, R2>(f: (r: R) => Either<L, R2>): Either<L, R2> {
    return f(this.value);
  }

  fmap<L, R2>(f: (r: R) => R2): Either<L, R2> {
    return deriveFmap<R, R2, Either<L, R2>>((g) => this.bind(g), (b) => new Right(b), f);
  }

  map<L, R2>(f: (r: R) => R2): Either<L, R2> {
    return this.fmap(f);
  }

  ap<L, R2>(other: Either<L, unknown>): Either<L, R2> {
    return deriveAp<unknown, R2, Either<L, R2>>(
      (g) => this.bind((fn) => g(fn as (a: unknown) => R2)),
      (h) => (other as { fmap(fn: (a: unknown) => R2): Either<L, R2> }).fmap(h),
    );
  }

  seq<L, R2>(next: Either<L, R2>): Either<L, R2> {
    return this.bind(() => next);
  }

  isLeft(): boolean {
    return false;
  }

  isRight(): this is Right<R> {
    return true;
  }
}

/** Ruby module Either 相当の smart constructor 群。 */
export const Either = {
  pure: <L, R>(x: R): Either<L, R> => new Right(x),
  left: <L, R>(x: L): Either<L, R> => new Left(x),
  right: <L, R>(x: R): Either<L, R> => new Right(x),
};

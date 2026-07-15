// ==================================================================
// Maybe — 失敗を「無」で表す (Nothing で短絡)。
//
// darkcore-ruby maybe.rb の TS 移植。Just は継続、Nothing は bind/fmap/ap を
// 素通り (短絡) する。fmap/map/ap は Monad の導出 (pure+bind) を使う。
// ==================================================================

import { deriveFmap, deriveAp } from './monad.js';

export type Maybe<A> = Just<A> | Nothing;

/** 値を保持し継続する枝。 */
export class Just<A> {
  readonly value: A;

  constructor(value: A) {
    this.value = value;
  }

  static pure<A>(x: A): Just<A> {
    return new Just(x);
  }

  bind<B>(f: (a: A) => Maybe<B>): Maybe<B> {
    return f(this.value);
  }

  fmap<B>(f: (a: A) => B): Maybe<B> {
    return deriveFmap<A, B, Maybe<B>>((g) => this.bind(g), (b) => new Just(b), f);
  }

  map<B>(f: (a: A) => B): Maybe<B> {
    return this.fmap(f);
  }

  ap<B>(other: Maybe<unknown>): Maybe<B> {
    return deriveAp<unknown, B, Maybe<B>>(
      (g) => this.bind((fn) => g(fn as (a: unknown) => B)),
      (h) => other.fmap(h),
    );
  }

  seq<B>(next: Maybe<B>): Maybe<B> {
    return this.bind(() => next);
  }

  isJust(): this is Just<A> {
    return true;
  }

  isNothing(): boolean {
    return false;
  }
}

/** 中身が無いので次へ進まない = 短絡する枝。 */
export class Nothing {
  static pure<A>(x: A): Just<A> {
    return new Just(x);
  }

  bind<B>(_f: (a: never) => Maybe<B>): Maybe<B> {
    return this;
  }

  fmap<B>(_f: (a: never) => B): Maybe<B> {
    return this;
  }

  map<B>(_f: (a: never) => B): Maybe<B> {
    return this;
  }

  ap<B>(_other: Maybe<unknown>): Maybe<B> {
    return this;
  }

  seq<B>(_next: Maybe<B>): Maybe<B> {
    return this;
  }

  isJust(): boolean {
    return false;
  }

  isNothing(): this is Nothing {
    return true;
  }
}

/** Ruby module Maybe 相当の smart constructor 群。 */
export const Maybe = {
  pure: <A>(x: A): Maybe<A> => new Just(x),
  just: <A>(x: A): Maybe<A> => new Just(x),
  nothing: (): Maybe<never> => new Nothing(),
  fromNil: <A>(x: A | null | undefined): Maybe<A> => (x == null ? new Nothing() : new Just(x)),
};

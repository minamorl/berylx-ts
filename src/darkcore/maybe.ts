import { deriveFmap, deriveAp } from './monad.js';

export type Maybe<A> = Just<A> | Nothing;

/** A present value that continues through bind, fmap, and ap. */
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

/** An absent value that short-circuits subsequent operations. */
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

export const Maybe = {
  pure: <A>(x: A): Maybe<A> => new Just(x),
  just: <A>(x: A): Maybe<A> => new Just(x),
  nothing: (): Maybe<never> => new Nothing(),
  fromNil: <A>(x: A | null | undefined): Maybe<A> => (x == null ? new Nothing() : new Just(x)),
};

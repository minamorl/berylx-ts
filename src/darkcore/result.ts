// These Ok/Err types are exposed through Darkcore and are separate from the
// top-level berylx workflow results. DarkcoreResult names their union explicitly.

import { deriveFmap, deriveAp } from './monad.js';

export type DarkcoreResult<A, E> = Ok<A> | Err<E>;

/** A success value that continues through bind, fmap, and ap. */
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

/** An error that propagates without evaluating subsequent operations. */
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

export const Result = {
  pure: <A, E>(x: A): DarkcoreResult<A, E> => new Ok(x),
  ok: <A, E>(x: A): DarkcoreResult<A, E> => new Ok(x),
  err: <A, E>(e: E): DarkcoreResult<A, E> => new Err(e),

  /** Capture thrown values as Err, using the error message or string representation. */
  try_: <A>(block: () => A): DarkcoreResult<A, string> => {
    try {
      return new Ok(block());
    } catch (e) {
      return new Err(e instanceof Error ? e.message : String(e));
    }
  },
};

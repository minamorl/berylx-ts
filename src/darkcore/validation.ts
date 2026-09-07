// Validation derives fmap from bind, but implements ap separately to accumulate
// errors by array concatenation. bind still short-circuits on failure.

import { deriveFmap } from './monad.js';

export type Validation<A, E> = Success<A> | Failure<E>;

/** A success value; ap propagates errors from a Failure argument. */
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

  /** Apply the wrapped function to a Success, or propagate a Failure unchanged. */
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

/** bind/fmap short-circuit; ap accumulates errors by concatenation. */
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

  /** Keep these errors for a Success, or concatenate both sets for a Failure. */
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

/** Validation constructors; failure flattens its arguments by one array level. */
export const Validation = {
  pure: <A, E>(x: A): Validation<A, E> => new Success(x),
  success: <A, E>(x: A): Validation<A, E> => new Success(x),
  failure: <A, E>(...es: (E | E[])[]): Validation<A, E> =>
    new Failure<E>(es.flat() as E[]),
};

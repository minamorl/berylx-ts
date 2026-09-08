import { deriveFmap, deriveAp } from './monad.js';

export type StateFn<S, A> = (s: S) => [A, S];

export class State<S, A> {
  readonly runFn: StateFn<S, A>;

  constructor(runFn: StateFn<S, A>) {
    this.runFn = runFn;
  }

  static pure<S, A>(x: A): State<S, A> {
    return new State<S, A>((s) => [x, s]);
  }

  static of<S, A>(x: A): State<S, A> {
    return State.pure<S, A>(x);
  }

  run(s: S): [A, S] {
    return this.runFn(s);
  }

  bind<B>(f: (a: A) => State<S, B>): State<S, B> {
    return new State<S, B>((s) => {
      const [a, s2] = this.runFn(s);
      return f(a).run(s2);
    });
  }

  fmap<B>(f: (a: A) => B): State<S, B> {
    return deriveFmap<A, B, State<S, B>>((g) => this.bind(g), (b) => State.pure<S, B>(b), f);
  }

  map<B>(f: (a: A) => B): State<S, B> {
    return this.fmap(f);
  }

  ap<B>(other: State<S, unknown>): State<S, B> {
    return deriveAp<unknown, B, State<S, B>>(
      (g) => this.bind((fn) => g(fn as (a: unknown) => B)),
      (h) => other.fmap(h),
    );
  }

  seq<B>(next: State<S, B>): State<S, B> {
    return this.bind(() => next);
  }

  /** Read the current state as the result value. */
  static get<S>(): State<S, S> {
    return new State<S, S>((s) => [s, s]);
  }

  /** Replace the state and return null. */
  static put<S>(s2: S): State<S, null> {
    return new State<S, null>((_s) => [null, s2]);
  }

  /** Transform the state and return null. */
  static modify<S>(f: (s: S) => S): State<S, null> {
    return new State<S, null>((s) => [null, f(s)]);
  }
}

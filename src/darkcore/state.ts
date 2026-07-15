// ==================================================================
// State — s -> [a, s] を包む。run(s) で回す。
//
// darkcore-ruby state.rb の TS 移植。書くのは pure と bind だけで、fmap/map/ap
// は Monad の導出を使う。static get/put/modify を持つ。
// ==================================================================

import { deriveFmap, deriveAp } from './monad.js';

/** 状態遷移関数 s -> [a, s]。 */
export type StateFn<S, A> = (s: S) => [A, S];

export class State<S, A> {
  readonly runFn: StateFn<S, A>;

  constructor(runFn: StateFn<S, A>) {
    this.runFn = runFn;
  }

  static pure<S, A>(x: A): State<S, A> {
    return new State<S, A>((s) => [x, s]);
  }

  /** pure の別名 (of 慣習)。 */
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

  /** 現在の状態を値として取り出す。 */
  static get<S>(): State<S, S> {
    return new State<S, S>((s) => [s, s]);
  }

  /** 状態を s2 に置き換える (値は null)。 */
  static put<S>(s2: S): State<S, null> {
    return new State<S, null>((_s) => [null, s2]);
  }

  /** 状態をブロックで変換する (値は null)。 */
  static modify<S>(f: (s: S) => S): State<S, null> {
    return new State<S, null>((s) => [null, f(s)]);
  }
}

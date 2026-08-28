// Parallel の merge algebra が満たすべき法則の回帰テスト。
//
// 全 branch は同じ base snapshot b から走るので、畳み込みは two-way の
// binary merge ではなく base を持つ three-way join μ_b(left, right) である。
// 既定 reducer (Merge.strict) はここの法則をすべて満たさなければならない。
//
// 由来: 既定が Merge.deep (base を見ない right-biased two-way merge) だった
// 頃は、既存キーへの disjoint update と右単位律が落ちていた。旧テストが
// 「base に無い新しいキーを足す」形しか見ていなかったため素通りしていた。
import { describe, it, expect } from 'vitest';
import { Ok, Err, Flow, Lay, Task, AsyncTask, Merge, Parallel, EffectTree } from '../src/index.js';

const toObj = (result: unknown) => (result as Ok | Err).focus.toObject();

const setA = Task.of('setA', (f) => f.at('a').set(1));
const setB = Task.of('setB', (f) => f.at('b').set(1));
const noop = Task.of('noop', (f) => f);

describe('parallel merge algebra (three-way join over base)', () => {
  it('既定 reducer は Merge.strict (base を受ける arity 3)', () => {
    expect(new Parallel([setA, setB]).reducer.length).toBe(3);
  });

  it('左単位律 μ_b(b, x) = x', () => {
    const result = Flow.of(Lay.of({ a: 0, b: 0 })).call(noop.par(setA));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ a: 1, b: 0 });
  });

  it('右単位律 μ_b(x, b) = x', () => {
    const result = Flow.of(Lay.of({ a: 0, b: 0 })).call(setA.par(noop));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ a: 1, b: 0 });
  });

  it('既存キーへの disjoint update を両方とも保存する', () => {
    const result = Flow.of(Lay.of({ a: 0, b: 0 })).call(setA.par(setB));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ a: 1, b: 1 });
  });

  it('ネストした既存キーへの disjoint update を両方とも保存する', () => {
    const left = Task.of('left', (f) => f.at('user').at('name').set('mina'));
    const right = Task.of('right', (f) => f.at('user').at('age').set(17));
    const result = Flow.of(Lay.of({ user: { name: null, age: null } })).call(left.par(right));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ user: { name: 'mina', age: 17 } });
  });

  it('3 branch 以上でも全ての disjoint update を保存する', () => {
    const setC = Task.of('setC', (f) => f.at('c').set(1));
    const result = Flow.of(Lay.of({ a: 0, b: 0, c: 0 })).call(setA.par(setB).par(setC));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ a: 1, b: 1, c: 1 });
  });

  it('同一 path の非互換 update は merge_conflict の Err になる', () => {
    const paid = Task.of('paid', (f) => f.at('status').set('paid'));
    const trial = Task.of('trial', (f) => f.at('status').set('trial'));
    const result = Flow.of(Lay.of({ status: null })).call(paid.par(trial));
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('merge_conflict');
    expect(toObj(result)).toEqual({ status: null });
  });

  it('同一 path でも値が一致するなら衝突しない', () => {
    const l = Task.of('l', (f) => f.at('status').set('paid'));
    const r = Task.of('r', (f) => f.at('status').set('paid'));
    const result = Flow.of(Lay.of({ status: null })).call(l.par(r));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ status: 'paid' });
  });

  it('Merge.deep は two-way right-biased なので明示選択でのみ right が勝つ', () => {
    const result = Flow.of(Lay.of({ a: 0, b: 0 })).call(setA.par(setB).reduce(Merge.deep()));
    expect(result).toBeInstanceOf(Ok);
    // 法則は満たさない。right wins を明示的に欲しい場合の reducer として残す。
    expect(toObj(result)).toEqual({ a: 0, b: 1 });
  });

  it('非同期 parallel も同じ merge algebra を通る', async () => {
    const a = AsyncTask.of('setA', async (f) => f.at('a').set(1));
    const b = AsyncTask.of('setB', async (f) => f.at('b').set(1));
    const result = await EffectTree.runAsync(a.par(b), { a: 0, b: 0 });
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ a: 1, b: 1 });
  });
});

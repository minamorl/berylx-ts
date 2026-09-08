// These laws guard against losing independent changes to existing keys.
// Earlier tests covered only newly added keys and missed that regression.
import { describe, it, expect } from 'vitest';
import { Ok, Err, Flow, Lay, Task, AsyncTask, Merge, Parallel, EffectTree } from '../src/index.js';

const toObj = (result: unknown) => (result as Ok | Err).focus.toObject();

const setA = Task.of('setA', (f) => f.at('a').set(1));
const setB = Task.of('setB', (f) => f.at('b').set(1));
const noop = Task.of('noop', (f) => f);

describe('parallel merge algebra (three-way join over base)', () => {
  it('defaults to Merge.strict with a third argument for the base', () => {
    expect(new Parallel([setA, setB]).reducer.length).toBe(3);
  });

  it('satisfies left identity: μ_b(b, x) = x', () => {
    const result = Flow.of(Lay.of({ a: 0, b: 0 })).call(noop.par(setA));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ a: 1, b: 0 });
  });

  it('satisfies right identity: μ_b(x, b) = x', () => {
    const result = Flow.of(Lay.of({ a: 0, b: 0 })).call(setA.par(noop));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ a: 1, b: 0 });
  });

  it('preserves both disjoint updates to existing keys', () => {
    const result = Flow.of(Lay.of({ a: 0, b: 0 })).call(setA.par(setB));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ a: 1, b: 1 });
  });

  it('preserves disjoint updates to existing nested keys', () => {
    const left = Task.of('left', (f) => f.at('user').at('name').set('mina'));
    const right = Task.of('right', (f) => f.at('user').at('age').set(17));
    const result = Flow.of(Lay.of({ user: { name: null, age: null } })).call(left.par(right));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ user: { name: 'mina', age: 17 } });
  });

  it('preserves disjoint updates across three or more branches', () => {
    const setC = Task.of('setC', (f) => f.at('c').set(1));
    const result = Flow.of(Lay.of({ a: 0, b: 0, c: 0 })).call(setA.par(setB).par(setC));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ a: 1, b: 1, c: 1 });
  });

  it('returns a merge_conflict Err for incompatible updates to the same path', () => {
    const paid = Task.of('paid', (f) => f.at('status').set('paid'));
    const trial = Task.of('trial', (f) => f.at('status').set('trial'));
    const result = Flow.of(Lay.of({ status: null })).call(paid.par(trial));
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('merge_conflict');
    expect(toObj(result)).toEqual({ status: null });
  });

  it('accepts matching updates to the same path', () => {
    const l = Task.of('l', (f) => f.at('status').set('paid'));
    const r = Task.of('r', (f) => f.at('status').set('paid'));
    const result = Flow.of(Lay.of({ status: null })).call(l.par(r));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ status: 'paid' });
  });

  it('uses right-biased two-way merging only when Merge.deep is selected', () => {
    const result = Flow.of(Lay.of({ a: 0, b: 0 })).call(setA.par(setB).reduce(Merge.deep()));
    expect(result).toBeInstanceOf(Ok);
    // This reducer intentionally allows the right branch to overwrite the left.
    expect(toObj(result)).toEqual({ a: 0, b: 1 });
  });

  it('uses the same merge algebra for asynchronous parallel execution', async () => {
    const a = AsyncTask.of('setA', async (f) => f.at('a').set(1));
    const b = AsyncTask.of('setB', async (f) => f.at('b').set(1));
    const result = await EffectTree.runAsync(a.par(b), { a: 0, b: 0 });
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ a: 1, b: 1 });
  });
});

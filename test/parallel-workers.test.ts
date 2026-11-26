import { describe, expect, it } from 'vitest';
import { AsyncTask, ControlSignal, EffectTree, Err, Merge, Parallel, ResultOps, Task, Workflow } from '../src/index.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('parallel workers', () => {
  it('preserves unlimited branch construction failure behavior', async () => {
    const seen: string[] = [];
    const invalid = Workflow.of('unsupported', () => Task.of('inside', (focus) => focus));
    const later = Task.of('later', (focus) => { seen.push('later'); return focus; });
    await expect(EffectTree.runAsync(new Parallel([invalid, later]), {})).rejects.toThrow();
    expect(seen).toEqual([]);
  });
  it.each([1, 2, 8])('limits concurrent branches to min(%i, branch count)', async (limit) => {
    let active = 0;
    let peak = 0;
    const branches = [0, 1, 2, 3].map((i) => AsyncTask.of(String(i), async (focus) => {
      active++;
      peak = Math.max(peak, active);
      await delay(10 + (3 - i) * 3);
      active--;
      return focus.at(String(i)).set(i);
    }));
    const limited = await EffectTree.runAsync(new Parallel(branches).workers(limit), {});
    expect(peak).toBe(Math.min(limit, branches.length));
    const unlimited = await EffectTree.runAsync(new Parallel(branches), {});
    expect(limited.focus.toObject()).toEqual(unlimited.focus.toObject());
  });

  it('enforces the peak before starting the next queued branch', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 5 }, (_, i) => AsyncTask.of(String(i), async (focus) => {
      active++;
      peak = Math.max(peak, active);
      await delay(10);
      active--;
      return focus.at(String(i)).set(i);
    }));
    await EffectTree.runAsync(new Parallel(tasks).workers(2), {});
    expect(peak).toBe(2);
  });

  it('starts queued branches from the original snapshot', async () => {
    const seen: number[] = [];
    const tasks = [1, 2, 3].map((i) => AsyncTask.of(String(i), async (focus) => {
      seen.push(focus.at('value').get());
      return focus.at('value').set(i);
    }));
    await EffectTree.runAsync(new Parallel(tasks).workers(1), { value: 0 });
    expect(seen).toEqual([0, 0, 0]);
  });

  it('merges in declaration order despite reversed completion order', async () => {
    const tasks = [30, 15, 1].map((ms, i) => AsyncTask.of(String(i), async (focus) => {
      await delay(ms);
      return focus.at('value').set(i);
    }));
    const node = new Parallel(tasks).reduce(Merge.deep());
    const limited = await EffectTree.runAsync(node.workers(2), {});
    const unlimited = await EffectTree.runAsync(node, {});
    expect(limited.focus.toObject()).toEqual({ value: 2 });
    expect(limited.focus.toObject()).toEqual(unlimited.focus.toObject());
  });

  it('runs all branches and returns errors in declaration order in both modes', async () => {
    const seen: number[] = [];
    const tasks = [30, 5, 1].map((ms, i) => AsyncTask.of(String(i), async (focus) => {
      await delay(ms);
      seen.push(i);
      return ResultOps.err(focus, `error${i}`);
    }));
    const node = new Parallel(tasks).workers(2);
    const first = await EffectTree.runAsync(node, {});
    expect(seen).toHaveLength(3);
    expect((first as Err).code).toBe('error0');
    seen.length = 0;
    const all = await EffectTree.runAsync(node.accumulate(), {});
    expect(seen).toHaveLength(3);
    expect((all as Err).parallelErrors.map((error) => error.code)).toEqual(['error0', 'error1', 'error2']);
  });

  it('keeps limited nodes nested and applies limits independently at each level', async () => {
    let active = 0;
    let peak = 0;
    const group = (prefix: string) => new Parallel(Array.from({ length: 4 }, (_, i) =>
      AsyncTask.of(`${prefix}${i}`, async (focus) => {
        active++;
        peak = Math.max(peak, active);
        await delay(15);
        active--;
        return focus.at(`${prefix}${i}`).set(true);
      }),
    )).workers(3);
    const first = group('a');
    const outer = first.par(group('b')).par(group('c')).workers(2);
    expect(outer.branches).toHaveLength(3);
    expect(outer.branches[0]).toBe(first);
    const result = await EffectTree.runAsync(outer, {});
    expect(peak).toBe(6);
    expect(Object.keys(result.focus.toObject())).toHaveLength(12);
  });

  it('flattens unlimited parallel nodes during composition', () => {
    const a = Task.of('a', (focus) => focus);
    const b = Task.of('b', (focus) => focus);
    const c = Task.of('c', (focus) => focus);
    expect(a.par(b).par(c).branches).toEqual([a, b, c]);
    expect(new Parallel([a.par(b), c]).branches).toEqual([a, b, c]);
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid worker count %s', (count) => {
    expect(() => new Parallel([]).workers(count)).toThrow(RangeError);
    expect(() => new Parallel([], Merge.strict(), 'short_circuit', count)).toThrow(RangeError);
  });

  it('waits for queued branches and rethrows the first declared ControlSignal', async () => {
    const first = new ControlSignal('first');
    const second = new ControlSignal('second');
    const seen: string[] = [];
    const branches = [first, second, null].map((signal, index) => AsyncTask.of(String(index), async (focus) => {
      await delay(index === 0 ? 30 : 5);
      seen.push(String(index));
      if (signal) throw signal;
      return focus;
    }));
    await expect(EffectTree.runAsync(new Parallel(branches).workers(2), {})).rejects.toBe(first);
    expect(seen).toEqual(['1', '2', '0']);
  });

  it('rejects omitted or undefined worker counts from JavaScript', () => {
    expect(() => new Parallel([]).workers(undefined as unknown as number)).toThrow(RangeError);
  });

  it.each([1, 2])('matches unlimited synchronous nested merge with workers(%i)', (limit) => {
    const a = Task.of('a', (focus) => focus.at('value').set(1));
    const b = Task.of('b', (focus) => focus.at('value').set(2));
    const c = Task.of('c', (focus) => focus.at('other').set(3));
    const inner = new Parallel([a, b]).reduce(Merge.deep());
    const baseline = new Parallel([inner, c]).call({});
    const limited = new Parallel([inner.workers(limit), c]).call({});
    expect(baseline).toBeInstanceOf(Err);
    expect((baseline as Err).code).toBe('merge_conflict');
    expect((limited as Err).code).toBe((baseline as Err).code);
    expect(limited.focus.toObject()).toEqual(baseline.focus.toObject());
  });

  it.each([1, 2])('matches unlimited asynchronous nested results with workers(%i)', async (limit) => {
    const a = AsyncTask.of('a', async (focus) => focus.at('value').set(1));
    const b = AsyncTask.of('b', async (focus) => focus.at('value').set(2));
    const c = AsyncTask.of('c', async (focus) => focus.at('other').set(3));
    const inner = new Parallel([a, b]).reduce(Merge.deep());
    const baseline = await EffectTree.runAsync(new Parallel([inner, c]), {});
    const limited = await EffectTree.runAsync(new Parallel([inner.workers(limit), c]), {});
    expect((baseline as Err).code).toBe('merge_conflict');
    expect((limited as Err).code).toBe((baseline as Err).code);
    const failures = ['a', 'b', 'c'].map((name) => AsyncTask.of(name, async (focus) => ResultOps.err(focus, name)));
    const nested = new Parallel(failures.slice(0, 2));
    const expected = await EffectTree.runAsync(new Parallel([nested, failures[2]]).accumulate(), {}) as Err;
    const actual = await EffectTree.runAsync(new Parallel([nested.workers(limit), failures[2]]).accumulate(), {}) as Err;
    expect(actual.parallelErrors.map((error) => error.code)).toEqual(['a', 'b', 'c']);
    expect(actual.parallelErrors.map((error) => error.code)).toEqual(expected.parallelErrors.map((error) => error.code));
  });

  it('preserves synchronous reducer and error mode when appending to a limited node', () => {
    const tasks = [1, 2, 3].map((i) => Task.of(String(i), (focus) => focus.at('value').set(i)));
    const node = new Parallel(tasks.slice(0, 2)).reduce(Merge.deep());
    expect(node.workers(1).par(tasks[2]).call({}).focus.toObject())
      .toEqual(node.par(tasks[2]).call({}).focus.toObject());
    const errors = [1, 2, 3].map((i) => Task.of(String(i), (focus) => ResultOps.err(focus, `error${i}`)));
    const failing = new Parallel(errors.slice(0, 2)).accumulate();
    const actual = failing.workers(1).par(errors[2]).call({}) as Err;
    const expected = failing.par(errors[2]).call({}) as Err;
    expect(actual.parallelErrors.map((error) => error.code))
      .toEqual(expected.parallelErrors.map((error) => error.code));
  });

  it('retains the limit through configuration and leaves synchronous order unchanged', () => {
    const seen: number[] = [];
    const tasks = [0, 1, 2].map((i) => Task.of(String(i), (focus) => {
      seen.push(i);
      return focus.at(String(i)).set(i);
    }));
    const node = new Parallel(tasks).workers(1).accumulate().reduce(Merge.strict()).shortCircuit();
    expect(node.workerLimit).toBe(1);
    expect(node.call({}).focus.toObject()).toEqual({ 0: 0, 1: 1, 2: 2 });
    expect(seen).toEqual([0, 1, 2]);
  });
});

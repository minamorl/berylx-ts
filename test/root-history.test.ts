import { describe, it, expect } from 'vitest';
import { Root, Task, berylx, type RootEvent, type RootOptions } from '../src/index.js';

interface Counter {
  count: number;
}

const b = berylx<Counter>();
const inc = b.task('inc', (focus) => focus.at('count').update((n) => n + 1));

function commitTimes(root: Root<Counter>, times: number): void {
  for (let i = 0; i < times; i += 1) {
    root.pipe(inc);
  }
}

const construct: Array<[string, (options?: RootOptions) => Root<Counter>]> = [
  ['Root.of', (options) => Root.of<Counter>({ count: 0 }, options)],
  ['berylx<S>().root', (options) => b.root({ count: 0 }, options)],
  ['new Root', (options) => new Root<Counter>({ count: 0 }, options)],
];

describe.each(construct)('Root history limit via %s', (_name, make) => {
  it('keeps every commit when no limit is given', () => {
    const root = make();
    commitTimes(root, 5);
    expect(root.history).toHaveLength(5);
    expect(root.history.map((e) => e.value)).toEqual([1, 2, 3, 4, 5].map((count) => ({ count })));
  });

  it('keeps no history when the limit is 0', () => {
    const root = make({ historyLimit: 0 });
    const history = root.history;
    commitTimes(root, 5);
    expect(root.history).toHaveLength(0);
    expect(root.history).toBe(history);
    expect(root.state()).toEqual({ count: 5 });
  });

  it('keeps the most recent N commits, oldest first, in the same array', () => {
    const root = make({ historyLimit: 3 });
    const history = root.history;
    commitTimes(root, 2);
    expect(root.history.map((e) => e.value)).toEqual([{ count: 1 }, { count: 2 }]);
    commitTimes(root, 5);
    expect(root.history).toBe(history);
    expect(root.history).toHaveLength(3);
    expect(root.history.every((e) => e.type === 'commit')).toBe(true);
    expect(root.history.map((e) => e.value)).toEqual([{ count: 5 }, { count: 6 }, { count: 7 }]);
    expect(root.history[root.history.length - 1].value).toEqual(root.state());
  });
});

describe('Root history limit leaves commit and subscribe unchanged', () => {
  function trace(options?: RootOptions) {
    const root = Root.of<Counter>({ count: 0 }, options);
    const events: RootEvent[] = [];
    const unsubscribe = root.subscribe((event) => events.push(event));
    root.commit({ count: 10 });
    const ok = root.pipe(inc);
    const err = root.pipe(
      Task.of<Counter>('fail', () => {
        throw new Error('boom');
      }),
    );
    unsubscribe();
    root.commit({ count: 99 });
    return { events, state: root.state(), ok: ok.isOk(), err: err.isOk() };
  }

  it('delivers the same events and state for no limit, 0, and N', () => {
    const unlimited = trace();
    expect(unlimited.events).toEqual([
      { type: 'snapshot', value: { count: 0 } },
      { type: 'commit', value: { count: 10 } },
      { type: 'commit', value: { count: 11 } },
    ]);
    expect(unlimited.state).toEqual({ count: 99 });
    expect([unlimited.ok, unlimited.err]).toEqual([true, false]);
    expect(trace({ historyLimit: 0 })).toEqual(unlimited);
    expect(trace({ historyLimit: 1 })).toEqual(unlimited);
  });

  it('rejects a negative or non-integer limit', () => {
    for (const historyLimit of [-1, 1.5, Number.NaN, Infinity]) {
      expect(() => Root.of({ count: 0 }, { historyLimit })).toThrow(RangeError);
    }
  });
});

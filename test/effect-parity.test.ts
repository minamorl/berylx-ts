import { describe, expect, it } from 'vitest';
import * as Berylx from '../src/index.js';

type Handler = (payload: unknown) => unknown;
type AsyncHandler = (payload: unknown) => unknown | Promise<unknown>;
type HandlerMap = Record<string, Handler>;
type AsyncHandlerMap = Record<string, AsyncHandler>;

interface Performer {
  perform(tag: string, payload?: unknown): unknown;
}

interface AsyncPerformer {
  perform(tag: string, payload?: unknown): unknown | Promise<unknown>;
}

type Wrapper = (tag: string, payload: unknown, inner: Handler) => unknown;
type AsyncWrapper = (tag: string, payload: unknown, inner: AsyncHandler) => unknown | Promise<unknown>;

interface EffectTreeParity {
  readonly TASK: string;
  readonly PARALLEL: string;
  readonly BRANCH: string;
  readonly RESCUE: string;
  readonly RECOVER: string;
  run(node: Berylx.BerylxNode, focus: unknown, handlers?: HandlerMap): Berylx.Result;
  runAsync(
    node: Berylx.BerylxNode,
    focus: unknown,
    handlers?: AsyncHandlerMap,
  ): Promise<Berylx.Result>;
  realHandlers(effects?: HandlerMap): HandlerMap;
  asyncRealHandlers(effects?: AsyncHandlerMap): AsyncHandlerMap;
  around(effects: HandlerMap, wrapper: Wrapper): HandlerMap;
  aroundAsync(effects: AsyncHandlerMap, wrapper: AsyncWrapper): AsyncHandlerMap;
}

type PerformConstructor = new (handlers: HandlerMap) => Performer;
type ControlSignalConstructor = new (...args: unknown[]) => Error;

const EffectTree = Berylx.EffectTree as unknown as EffectTreeParity;

function exportedPerform(): PerformConstructor {
  const candidate = (Berylx as unknown as { Perform?: unknown }).Perform;
  expect(candidate, 'Perform must be exported').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('Perform is not exported');
  }
  return candidate as PerformConstructor;
}

function exportedControlSignal(): ControlSignalConstructor {
  const candidate = (Berylx as unknown as { ControlSignal?: unknown }).ControlSignal;
  expect(candidate, 'ControlSignal must be exported').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('ControlSignal is not exported');
  }
  return candidate as ControlSignalConstructor;
}

function effectfulTask(
  name: string,
  block: (focus: Berylx.Focus, performer: Performer) => unknown,
): Berylx.Task {
  return Berylx.Task.of(name, block as unknown as Berylx.TaskBlock);
}

function effectfulAsyncTask(
  name: string,
  block: (focus: Berylx.Focus, performer: AsyncPerformer) => unknown | Promise<unknown>,
): Berylx.AsyncTask {
  return Berylx.AsyncTask.of(name, block as unknown as Berylx.AsyncTaskBlock);
}

function ordinaryFailure(name = 'fail'): Berylx.Task {
  return Berylx.Task.of(name, (focus) => focus.reject('failed', 'failed'));
}

function asyncOrdinaryFailure(name = 'fail'): Berylx.AsyncTask {
  return Berylx.AsyncTask.of(name, async (focus) => focus.reject('failed', 'failed'));
}

describe('Perform and custom handler maps', () => {
  it('exports Perform and dispatches by tag while rejecting missing and pure tags', () => {
    const Perform = exportedPerform();
    const performer = new Perform({ double: (payload) => (payload as number) * 2 });

    expect(performer.perform('double', 21)).toBe(42);
    expect(() => performer.perform('missing')).toThrow(/no handler/i);
    expect(() => performer.perform('pure')).toThrow(/reserved|予約/i);
  });

  it('passes the currently supplied sync custom map into two-argument Tasks and combinator subtrees', () => {
    const seen: unknown[] = [];
    const left = effectfulTask('left', (focus, perform) =>
      focus.at('left').set(perform.perform('lookup', { id: 1 })),
    );
    const right = effectfulTask('right', (focus, perform) =>
      focus.at('right').set(perform.perform('lookup', { id: 2 })),
    );
    const workflow = Berylx.When.of('chosen', () => true).then(left.par(right));
    const handlers = EffectTree.realHandlers({
      lookup: (payload) => {
        seen.push(payload);
        return (payload as { id: number }).id * 10;
      },
    });

    const result = EffectTree.run(workflow, {}, handlers);

    expect(result).toBeInstanceOf(Berylx.Ok);
    expect((result as Berylx.Ok).focus.toObject()).toEqual({ left: 10, right: 20 });
    expect(seen).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('passes the currently supplied async custom map into sync and async Tasks in a subtree', async () => {
    const seen: unknown[] = [];
    const sync = effectfulTask('sync', (focus, perform) =>
      focus.at('sync').set(perform.perform('lookup', 3)),
    );
    const async = effectfulAsyncTask('async', async (focus, perform) =>
      focus.at('async').set(await perform.perform('lookup', 4)),
    );
    const handlers = EffectTree.asyncRealHandlers({
      lookup: (payload) => {
        seen.push(payload);
        return (payload as number) * 10;
      },
    });

    const result = await EffectTree.runAsync(sync.par(async), {}, handlers);

    expect(result).toBeInstanceOf(Berylx.Ok);
    expect((result as Berylx.Ok).focus.toObject()).toEqual({ sync: 30, async: 40 });
    expect(seen).toEqual([3, 4]);
  });

  it('does not allow application effects to replace reserved sync or async handlers', () => {
    expect(() => EffectTree.realHandlers({ [EffectTree.TASK]: () => null })).toThrow(
      /collide|reserved/i,
    );
    expect(() => EffectTree.asyncRealHandlers({ [EffectTree.RECOVER]: () => null })).toThrow(
      /collide|reserved/i,
    );
  });
});

describe('ControlSignal pass-through and Parallel joining', () => {
  it('exports an extendable marker and lets Task pass its instances through', () => {
    const ControlSignal = exportedControlSignal();
    class Stop extends ControlSignal {}
    const signal = new Stop();
    const task = Berylx.Task.of('stop', () => {
      throw signal;
    });

    let raised: unknown;
    try {
      task.call({});
    } catch (error) {
      raised = error;
    }
    expect(raised).toBe(signal);
    expect(new Stop()).toBeInstanceOf(ControlSignal);
  });

  it('still converts an ordinary Task throw into Err', () => {
    const result = Berylx.Task.of('boom', () => {
      throw new Error('ordinary');
    }).call({});

    expect(result).toBeInstanceOf(Berylx.Err);
    expect((result as Berylx.Err).message).toBe('ordinary');
  });

  it('lets AsyncTask pass a ControlSignal rejection through but converts an ordinary rejection', async () => {
    const ControlSignal = exportedControlSignal();
    class Stop extends ControlSignal {}
    const signal = new Stop();
    const stopped = Berylx.AsyncTask.of('stop', async () => {
      throw signal;
    });
    const ordinary = Berylx.AsyncTask.of('boom', async () => {
      throw new Error('ordinary async');
    });

    await expect(stopped.callAsync({})).rejects.toBe(signal);
    const result = await ordinary.callAsync({});
    expect(result).toBeInstanceOf(Berylx.Err);
    expect((result as Berylx.Err).message).toBe('ordinary async');
  });

  it('runs every sync Parallel branch before rethrowing the first ControlSignal in branch order', () => {
    const ControlSignal = exportedControlSignal();
    class Stop extends ControlSignal {}
    const first = new Stop();
    const second = new Stop();
    const events: string[] = [];
    const branches = [
      Berylx.Task.of('first', () => {
        events.push('first');
        throw first;
      }),
      Berylx.Task.of('second', () => {
        events.push('second');
        throw second;
      }),
      Berylx.Task.of('third', (focus) => {
        events.push('third');
        return focus;
      }),
    ];

    let raised: unknown;
    try {
      EffectTree.run(new Berylx.Parallel(branches), {});
    } catch (error) {
      raised = error;
    }
    expect(raised).toBe(first);
    expect(events).toEqual(['first', 'second', 'third']);
  });

  it('awaits every async Parallel branch and rethrows the first ControlSignal by branch order', async () => {
    const ControlSignal = exportedControlSignal();
    class Stop extends ControlSignal {}
    const first = new Stop();
    const second = new Stop();
    const events: string[] = [];
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const leftGate = deferred();
    const rightGate = deferred();
    const finalGate = deferred();

    const left = Berylx.AsyncTask.of('left', async () => {
      events.push('left:start');
      await leftGate.promise;
      events.push('left:end');
      throw first;
    });
    const right = Berylx.AsyncTask.of('right', async () => {
      events.push('right:start');
      await rightGate.promise;
      events.push('right:end');
      throw second;
    });
    const final = Berylx.AsyncTask.of('final', async (focus) => {
      events.push('final:start');
      await finalGate.promise;
      events.push('final:end');
      return focus;
    });

    let settled = false;
    const observed = EffectTree.runAsync(new Berylx.Parallel([left, right, final]), {}).then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await Promise.resolve();
    expect(events).toEqual(['left:start', 'right:start', 'final:start']);

    rightGate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    finalGate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    leftGate.resolve();
    expect(await observed).toBe(first);
    expect(events).toEqual([
      'left:start',
      'right:start',
      'final:start',
      'right:end',
      'final:end',
      'left:end',
    ]);
  });
});

describe('RECOVER dispatch and around aspects', () => {
  it('routes sync Catch and Rescue recovery through the supplied RECOVER handler', () => {
    const recoverPayloads: unknown[] = [];
    const handlers = EffectTree.realHandlers();
    const inner = handlers[EffectTree.RECOVER];
    expect(inner).toBeTypeOf('function');
    handlers[EffectTree.RECOVER] = (payload) => {
      recoverPayloads.push(payload);
      return inner(payload);
    };

    const caught = ordinaryFailure('catch_body').then(
      Berylx.Catch.of('catch', null, {}, (_error, focus) => focus.at('caught').set(true)),
    );
    const rescued = ordinaryFailure('rescue_body').rescueWith(
      Berylx.Task.of('recover', (focus) => focus.at('rescued').set(true)),
    );

    expect(EffectTree.run(caught, {}, handlers)).toBeInstanceOf(Berylx.Ok);
    expect(EffectTree.run(rescued, {}, handlers)).toBeInstanceOf(Berylx.Ok);
    expect(recoverPayloads).toHaveLength(2);
    expect((recoverPayloads[0] as unknown[])[0]).toBeInstanceOf(Berylx.Catch);
    expect((recoverPayloads[1] as unknown[])[0]).toBeInstanceOf(Berylx.Rescue);
  });

  it('routes async Catch and Rescue recovery through the supplied RECOVER handler', async () => {
    const recoverPayloads: unknown[] = [];
    const handlers = EffectTree.asyncRealHandlers();
    const inner = handlers[EffectTree.RECOVER];
    expect(inner).toBeTypeOf('function');
    handlers[EffectTree.RECOVER] = async (payload) => {
      recoverPayloads.push(payload);
      return await inner(payload);
    };

    const caught = asyncOrdinaryFailure('catch_body').then(
      Berylx.Catch.of('catch', Berylx.AsyncTask.of('catch_recover', async (focus) => focus)),
    );
    const rescued = asyncOrdinaryFailure('rescue_body').rescueWith(
      Berylx.AsyncTask.of('rescue_recover', async (focus) => focus.at('rescued').set(true)),
    );

    expect(await EffectTree.runAsync(caught, {}, handlers)).toBeInstanceOf(Berylx.Ok);
    expect(await EffectTree.runAsync(rescued, {}, handlers)).toBeInstanceOf(Berylx.Ok);
    expect(recoverPayloads).toHaveLength(2);
    expect((recoverPayloads[0] as unknown[])[0]).toBeInstanceOf(Berylx.Catch);
    expect((recoverPayloads[1] as unknown[])[0]).toBeInstanceOf(Berylx.Rescue);
  });

  it('sync around observes TASK, custom effects, combinators, and RECOVER throughout subtrees', () => {
    const observed: string[] = [];
    const custom = effectfulTask('custom', (focus, perform) =>
      focus.at('value').set(perform.perform('lookup', 2)),
    );
    const recovery = effectfulTask('recover', (focus, perform) =>
      focus.at('recovered').set(perform.perform('lookup', 3)),
    );
    const workflow = custom.par(ordinaryFailure().rescueWith(recovery));
    const handlers = EffectTree.around(
      { lookup: (payload) => (payload as number) * 10 },
      (tag, payload, inner) => {
        observed.push(tag);
        return inner(payload);
      },
    );

    const result = EffectTree.run(workflow, {}, handlers);

    expect(result).toBeInstanceOf(Berylx.Ok);
    expect((result as Berylx.Ok).focus.toObject()).toEqual({ value: 20, recovered: 30 });
    expect(observed).toEqual(
      expect.arrayContaining([
        EffectTree.PARALLEL,
        EffectTree.RESCUE,
        EffectTree.RECOVER,
        EffectTree.TASK,
        'lookup',
      ]),
    );
    expect(observed.filter((tag) => tag === 'lookup')).toHaveLength(2);
  });

  it('async around awaits inner handlers and observes the wrapped map throughout subtrees and recovery', async () => {
    const observed: string[] = [];
    const custom = effectfulAsyncTask('custom', async (focus, perform) =>
      focus.at('value').set(await perform.perform('lookup', 4)),
    );
    const recovery = effectfulAsyncTask('recover', async (focus, perform) =>
      focus.at('recovered').set(await perform.perform('lookup', 5)),
    );
    const workflow = custom.par(asyncOrdinaryFailure().rescueWith(recovery));
    const handlers = EffectTree.aroundAsync(
      { lookup: async (payload) => (payload as number) * 10 },
      async (tag, payload, inner) => {
        observed.push(tag);
        return await inner(payload);
      },
    );

    const result = await EffectTree.runAsync(workflow, {}, handlers);

    expect(result).toBeInstanceOf(Berylx.Ok);
    expect((result as Berylx.Ok).focus.toObject()).toEqual({ value: 40, recovered: 50 });
    expect(observed).toEqual(
      expect.arrayContaining([
        EffectTree.PARALLEL,
        EffectTree.RESCUE,
        EffectTree.RECOVER,
        EffectTree.TASK,
        'lookup',
      ]),
    );
    expect(observed.filter((tag) => tag === 'lookup')).toHaveLength(2);
  });
});

describe('Darkcore Effect record immutability', () => {
  it('prevents shallow field reassignment while leaving payload contents mutable', () => {
    const payload = { count: 1 };
    const effect = Berylx.Darkcore.op('custom', payload);
    const originalContinuation = effect.k;

    expect(Reflect.set(effect, 'tag', 'changed')).toBe(false);
    expect(Reflect.set(effect, 'payload', { count: 99 })).toBe(false);
    expect(Reflect.set(effect, 'k', null)).toBe(false);
    expect(effect.tag).toBe('custom');
    expect(effect.payload).toBe(payload);
    expect(effect.k).toBe(originalContinuation);

    payload.count = 2;
    expect((effect.payload as { count: number }).count).toBe(2);
  });
});

describe('review regressions: consumer handlers, reducer signals, and callback arity', () => {
  const lookupTask = () =>
    Berylx.Task.of('lookup', (focus, perform) =>
      focus.at('value').set(perform.perform('lookup', 21)),
    );

  const lookupHandlers = () =>
    Berylx.EffectTree.realHandlers({
      lookup: (payload) => (payload as number) * 2,
    });

  it('Flow.call accepts and propagates a consumer-supplied handler map', () => {
    const result = Berylx.Flow.of({}).call(lookupTask(), lookupHandlers());

    expect(result).toBeInstanceOf(Berylx.Ok);
    expect((result as Berylx.Ok).focus.toObject()).toEqual({ value: 42 });
  });

  it('State.call accepts and propagates a consumer-supplied handler map', () => {
    const result = Berylx.State.of({}).call(lookupTask(), lookupHandlers());

    expect(result).toBeInstanceOf(Berylx.Ok);
    expect((result as Berylx.Ok).focus.toObject()).toEqual({ value: 42 });
  });

  it('Root.call accepts and propagates a consumer-supplied handler map before committing', () => {
    const root = Berylx.Root.of({});
    const result = root.call(lookupTask(), lookupHandlers());

    expect(result).toBeInstanceOf(Berylx.Ok);
    expect(root.state()).toEqual({ value: 42 });
  });

  it('passes a sync reducer ControlSignal through only after every branch has completed', () => {
    class Stop extends Berylx.ControlSignal {}
    const signal = new Stop();
    const events: string[] = [];
    const left = Berylx.Task.of('left', (focus) => {
      events.push('left');
      return focus.at('left').set(true);
    });
    const right = Berylx.Task.of('right', (focus) => {
      events.push('right');
      return focus.at('right').set(true);
    });
    const workflow = left.par(right).reduce(() => {
      events.push('reducer');
      throw signal;
    });

    let raised: unknown;
    try {
      Berylx.EffectTree.run(workflow, {});
    } catch (error) {
      raised = error;
    }

    expect(raised).toBe(signal);
    expect(events).toEqual(['left', 'right', 'reducer']);
  });

  it('passes an async reducer ControlSignal through only after every branch has completed', async () => {
    class Stop extends Berylx.ControlSignal {}
    const signal = new Stop();
    const events: string[] = [];
    const left = Berylx.AsyncTask.of('left', async (focus) => {
      await Promise.resolve();
      events.push('left');
      return focus.at('left').set(true);
    });
    const right = Berylx.AsyncTask.of('right', async (focus) => {
      await Promise.resolve();
      events.push('right');
      return focus.at('right').set(true);
    });
    const workflow = left.par(right).reduce(() => {
      events.push('reducer');
      throw signal;
    });

    let raised: unknown;
    try {
      await Berylx.EffectTree.runAsync(workflow, {});
    } catch (error) {
      raised = error;
    }

    expect(raised).toBe(signal);
    expect(events).toEqual(['left', 'right', 'reducer']);
  });

  it('continues converting ordinary sync and async reducer throws into Err', async () => {
    const reducer = () => {
      throw new Error('ordinary reducer');
    };
    const sync = Berylx.Task.of('left', (focus) => focus)
      .par(Berylx.Task.of('right', (focus) => focus))
      .reduce(reducer);
    const async = Berylx.AsyncTask.of('left', async (focus) => focus)
      .par(Berylx.AsyncTask.of('right', async (focus) => focus))
      .reduce(reducer);

    const syncResult = Berylx.EffectTree.run(sync, {});
    const asyncResult = await Berylx.EffectTree.runAsync(async, {});

    expect(syncResult).toBeInstanceOf(Berylx.Err);
    expect((syncResult as Berylx.Err).message).toBe('ordinary reducer');
    expect(asyncResult).toBeInstanceOf(Berylx.Err);
    expect((asyncResult as Berylx.Err).message).toBe('ordinary reducer');
  });

  it('invokes a non-effectful Task callback with exactly one actual argument', () => {
    let actualArguments = -1;
    const task = Berylx.Task.of('one_argument', function (focus) {
      actualArguments = arguments.length;
      return focus;
    });

    expect(task.call({})).toBeInstanceOf(Berylx.Ok);
    expect(actualArguments).toBe(1);
  });

  it('invokes a non-effectful AsyncTask callback with exactly one actual argument', async () => {
    let actualArguments = -1;
    const task = Berylx.AsyncTask.of('one_argument', async function (focus) {
      actualArguments = arguments.length;
      return focus;
    });

    expect(await task.callAsync({})).toBeInstanceOf(Berylx.Ok);
    expect(actualArguments).toBe(1);
  });

  it('invokes a non-effectful RescueHandlerBlock with exactly error and focus', () => {
    let actualArguments = -1;
    const workflow = ordinaryFailure().rescueWith(
      null,
      'recover',
      function (_error, focus) {
        actualArguments = arguments.length;
        return focus.at('recovered').set(true);
      },
    );

    const result = Berylx.EffectTree.run(workflow, {});

    expect(result).toBeInstanceOf(Berylx.Ok);
    expect(actualArguments).toBe(2);
  });

  it('gives a three-argument recovery block the current Perform and passes its ControlSignal through', () => {
    class Stop extends Berylx.ControlSignal {}
    const signal = new Stop();
    const performed: unknown[] = [];
    let actualArguments = -1;
    const recovery: Berylx.RescueHandlerBlock = function (_error, _focus, perform) {
      actualArguments = arguments.length;
      perform.perform('audit', { recovered: true });
      throw signal;
    };
    const workflow = ordinaryFailure().rescueWith(null, 'recover', recovery);
    const handlers = Berylx.EffectTree.realHandlers({
      audit: (payload) => {
        performed.push(payload);
        return null;
      },
    });

    let raised: unknown;
    try {
      Berylx.EffectTree.run(workflow, {}, handlers);
    } catch (error) {
      raised = error;
    }

    expect(raised).toBe(signal);
    expect(actualArguments).toBe(3);
    expect(performed).toEqual([{ recovered: true }]);
  });
});

describe('join_all branch ordering regressions', () => {
  it('sync Parallel runs every branch and rethrows the first thrown value by branch order', () => {
    class Stop extends Berylx.ControlSignal {}
    const signal = new Stop();
    const ordinary = new Error('ordinary branch');
    const events: string[] = [];
    const signalBranch = Berylx.Task.of('signal', () => {
      events.push('signal');
      throw signal;
    });
    const ordinaryBranch = Berylx.When.of('ordinary', () => {
      events.push('ordinary');
      throw ordinary;
    }).then(Berylx.Task.of('unreachable', (focus) => focus));
    const finalBranch = Berylx.Task.of('final', (focus) => {
      events.push('final');
      return focus;
    });

    let raised: unknown;
    try {
      Berylx.EffectTree.run(
        new Berylx.Parallel([signalBranch, ordinaryBranch, finalBranch]),
        {},
      );
    } catch (error) {
      raised = error;
    }

    expect(events).toEqual(['signal', 'ordinary', 'final']);
    expect(raised).toBe(signal);
  });

  it('async Parallel settles every branch and rethrows the first thrown value by branch order', async () => {
    class Stop extends Berylx.ControlSignal {}
    const signal = new Stop();
    const ordinary = new Error('ordinary branch');
    const events: string[] = [];
    const ordinaryBranch = Berylx.When.of('ordinary', () => {
      events.push('ordinary');
      throw ordinary;
    }).then(Berylx.Task.of('unreachable', (focus) => focus));
    const signalBranch = Berylx.AsyncTask.of('signal', async () => {
      await Promise.resolve();
      events.push('signal');
      throw signal;
    });
    const finalBranch = Berylx.AsyncTask.of('final', async (focus) => {
      await Promise.resolve();
      events.push('final');
      return focus;
    });

    let raised: unknown;
    try {
      await Berylx.EffectTree.runAsync(
        new Berylx.Parallel([ordinaryBranch, signalBranch, finalBranch]),
        {},
      );
    } catch (error) {
      raised = error;
    }

    expect(events).toEqual(['ordinary', 'signal', 'final']);
    expect(raised).toBe(ordinary);
  });
});

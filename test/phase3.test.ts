import { describe, it, expect } from 'vitest';
import {
  Ok,
  Err,
  Focus,
  Root,
  Task,
  AsyncTask,
  Parallel,
  When,
  Else,
  EffectTree,
  Graph,
  BerylxError,
  attachRoot,
  Cray,
  CraySuccess,
  CrayFailure,
  fromCrayResult,
  toCrayResult,
} from '../src/index.js';

describe('phase 3-a: AsyncTask + async EffectTree', () => {
  const asyncStrip = () =>
    AsyncTask.of('strip', async (lay) => {
      await Promise.resolve();
      return lay.at('name').update((s) => (s as string).trim());
    });
  const asyncGreet = () =>
    AsyncTask.of('greet', async (lay) =>
      lay.at('greeting').set(`hello ${lay.at('name').get()}`),
    );

  it('runs an async sequence to a committed Ok', async () => {
    const workflow = asyncStrip().then(asyncGreet());
    const result = await EffectTree.runAsync(workflow, { name: '  mina  ' });
    expect(result).toBeInstanceOf(Ok);
    expect((result as Ok).focus.toObject()).toEqual({ name: 'mina', greeting: 'hello mina' });
  });

  it('mixes sync Task and AsyncTask in one sequence', async () => {
    const workflow = Task.of('set_a', (lay) => lay.at('a').set(1)).then(
      AsyncTask.of('set_b', async (lay) => lay.at('b').set(2)),
    );
    const result = await EffectTree.runAsync(workflow, {});
    expect((result as Ok).focus.toObject()).toEqual({ a: 1, b: 2 });
  });

  it('captures async exceptions into Err with failedNode/trace', async () => {
    const workflow = AsyncTask.of('boom', async () => {
      throw new Error('kaboom');
    });
    const result = await EffectTree.runAsync(workflow, {});
    expect(result).toBeInstanceOf(Err);
    const err = result as Err;
    expect(err.message).toBe('kaboom');
    expect(err.failedNode).toBe('boom');
    expect([...err.trace]).toEqual(['boom']);
  });

  it('async parallel merges branches (Promise.all based)', async () => {
    const a = AsyncTask.of('set_a', async (lay) => lay.at('a').set(1));
    const b = AsyncTask.of('set_b', async (lay) => lay.at('b').set(2));
    const result = await EffectTree.runAsync(a.par(b), {});
    expect(result).toBeInstanceOf(Ok);
    expect((result as Ok).focus.toObject()).toEqual({ a: 1, b: 2 });
  });

  it('async parallel short_circuit returns the first failure', async () => {
    const good = AsyncTask.of('good', async (lay) => lay.at('ok').set(true));
    const bad = AsyncTask.of('bad', async (lay) => lay.reject('nope', 'bad branch'));
    const result = await EffectTree.runAsync(good.par(bad), {});
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('nope');
  });

  it('async parallel accumulate collects all branch errors', async () => {
    const bad1 = AsyncTask.of('bad1', async (lay) => lay.reject('e1', 'first'));
    const bad2 = AsyncTask.of('bad2', async (lay) => lay.reject('e2', 'second'));
    const node = new Parallel([bad1, bad2]).accumulate();
    const result = await EffectTree.runAsync(node, {});
    expect(result).toBeInstanceOf(Err);
    const err = result as Err;
    expect(err.code).toBe('parallel_failed');
    expect(err.parallelErrors.map((e) => e.code)).toEqual(['e1', 'e2']);
  });

  it('async rescue recovers a failed body', async () => {
    const body = AsyncTask.of('charge', async (lay) =>
      lay.at('charged').set(true).reject('payment_failed', 'declined'),
    );
    const handler = Task.of('record', (lay) => lay.at('failure').set('declined'));
    const result = await EffectTree.runAsync(body.rescueWith(handler), {});
    expect(result).toBeInstanceOf(Ok);
    expect((result as Ok).focus.toObject()).toEqual({ charged: true, failure: 'declined' });
  });

  it('AsyncTask#call (sync path) throws to protect the sync interpreter', () => {
    expect(() => AsyncTask.of('x', async () => 1).call(Focus.of({}))).toThrowError(/asynchronous/);
  });
});

describe('phase 3-b: cray Result compat shim', () => {
  it('fromCrayResult: Success -> Ok', () => {
    const result = fromCrayResult(Cray.success({ user: 'mina' }));
    expect(result).toBeInstanceOf(Ok);
    expect((result as Ok).focus.toObject()).toEqual({ user: 'mina' });
  });

  it('fromCrayResult: Failure(string) folds error into code', () => {
    const result = fromCrayResult(Cray.failure('card_declined'));
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('card_declined');
    expect((result as Err).error.metadata.crayError).toBe('card_declined');
  });

  it('fromCrayResult: Failure(Error) preserves cause and message', () => {
    const boom = new TypeError('bad');
    const result = fromCrayResult(Cray.failure(boom));
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('TypeError');
    expect((result as Err).message).toBe('bad');
    expect((result as Err).error.cause).toBe(boom);
  });

  it('fromCrayResult: Failure(arbitrary) folds into cray_failure metadata', () => {
    const result = fromCrayResult(Cray.failure({ reason: 42 }));
    expect((result as Err).code).toBe('cray_failure');
    expect((result as Err).error.metadata.crayError).toEqual({ reason: 42 });
  });

  it('fromCrayResult accepts foreign cray-shaped objects', () => {
    expect(fromCrayResult({ success: true, value: { n: 1 } })).toBeInstanceOf(Ok);
    expect(fromCrayResult({ success: false, error: 'x' })).toBeInstanceOf(Err);
  });

  it('toCrayResult: Ok -> Success / Err -> Failure', () => {
    const success = toCrayResult(new Ok(Focus.of({ a: 1 })));
    expect(success).toBeInstanceOf(CraySuccess);
    expect((success as CraySuccess).value).toEqual({ a: 1 });

    const err = new Err(Focus.of({}), BerylxError.create('boom', 'boom happened'));
    const failure = toCrayResult(err);
    expect(failure).toBeInstanceOf(CrayFailure);
    expect((failure as CrayFailure<BerylxError>).error.code).toBe('boom');
  });

  it('roundtrips Ok through cray and back', () => {
    const original = new Ok(Focus.of({ x: 9 }));
    const back = fromCrayResult(toCrayResult(original));
    expect(back).toBeInstanceOf(Ok);
    expect((back as Ok).focus.toObject()).toEqual({ x: 9 });
  });
});

describe('phase 3-c: Graph#toMermaid', () => {
  it('renders a sequence as a mermaid flowchart', () => {
    const strip = Task.of('strip', (lay) => lay);
    const greet = Task.of('greet', (lay) => lay);
    const mermaid = strip.then(greet).compile().toMermaid();
    expect(mermaid.split('\n')[0]).toBe('flowchart TD');
    expect(mermaid).toContain('n0["strip"]');
    expect(mermaid).toContain('n1["greet"]');
    expect(mermaid).toContain('n0 --> n1');
  });

  it('renders parallel split/join and labelled branches', () => {
    const par = Task.of('a', (l) => l).par(Task.of('b', (l) => l));
    const pm = par.compile().toMermaid();
    expect(pm).toContain('["split"]');
    expect(pm).toContain('["join"]');

    const branch = When.of('pos', (l) => (l.at('n').get() as number) > 0)
      .then(Task.of('mark', (l) => l))
      .or(Else.then(Task.of('other', (l) => l)));
    const bm = Graph.from(branch).toMermaid();
    expect(bm).toContain('|pos|');
    expect(bm).toContain('|else|');
  });

  it('mermaid and dot describe the same node count', () => {
    const wf = Task.of('a', (l) => l).then(Task.of('b', (l) => l)).then(Task.of('c', (l) => l));
    const g = wf.compile();
    const mermaidNodes = g.toMermaid().split('\n').filter((l) => /n\d+\["/.test(l)).length;
    expect(mermaidNodes).toBe(3);
    expect(g.nodes()).toEqual(['a', 'b', 'c']);
  });
});

describe('phase 3-d: attachRoot', () => {
  it('emits the initial snapshot then every commit', () => {
    const root = Root.of({ count: 0 });
    const seen: unknown[] = [];
    const unsubscribe = attachRoot(root, (state) => seen.push(state));

    root.pipe(Task.of('inc', (lay) => lay.at('count').set(1)));
    root.pipe(Task.of('inc2', (lay) => lay.at('count').set(2)));

    expect(seen).toEqual([{ count: 0 }, { count: 1 }, { count: 2 }]);
    unsubscribe();
    root.pipe(Task.of('inc3', (lay) => lay.at('count').set(3)));
    expect(seen).toHaveLength(3); // No events are delivered after unsubscribing.
  });

  it('supports select projection and skipSnapshot / onCommit', () => {
    const root = Root.of({ user: { name: 'mina' }, other: 1 });
    const commits: unknown[] = [];
    attachRoot<string>(
      root,
      () => {},
      {
        select: (s) => (s as { user: { name: string } }).user.name,
        skipSnapshot: true,
        onCommit: (name) => commits.push(name),
      },
    );
    root.pipe(Task.of('rename', (lay) => lay.at('user').at('name').set('yui')));
    expect(commits).toEqual(['yui']);
  });
});

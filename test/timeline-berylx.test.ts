import { describe, expect, it } from 'vitest';
import {
  AsyncTask,
  BerylxTimeline,
  Else,
  Err,
  Ok,
  Root,
  Task,
  Timeline,
  When,
  timelinePredicates,
  waitForHumanLogin,
  type Clock,
  type TimelineEvent,
} from '../src/index.js';

class ManualClock implements Clock {
  constructor(public current: Date) {}
  now(): Date { return this.current; }
}

async function within<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timeline evaluation timed out')), milliseconds);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function taskEvents(events: readonly TimelineEvent[]): Array<[string, string | undefined]> {
  return events
    .filter((event) => event.type.startsWith('berylx-task-'))
    .map((event) => [event.type, event.details?.node as string | undefined]);
}

describe('Timeline Berylx connection', () => {
  it('uses Root as the Timeline token, commits Ok, and observes nested handlers', async () => {
    const root = Root.of<Record<string, unknown>>({ ready: true });
    const clock = new ManualClock(new Date('2026-09-26T00:00:00Z'));
    const connection = BerylxTimeline.forRoot(root, clock);
    expect(connection.timeline).toBe(Timeline.forExecution(root, clock));

    const seed = Task.of('seed', (lay) => lay.at('seeded').set(true));
    const parallel = Task.of('parallel-left', (lay) => lay.at('left').set(1))
      .par(Task.of('parallel-right', (lay) => lay.at('right').set(2)));
    const branch = When.of<Record<string, unknown>>('ready', (lay) => lay.at('ready').get())
      .then(Task.of('branch-yes', (lay) => lay.at('branched').set('yes')))
      .or(Else.then(Task.of('branch-no', (lay) => lay.at('branched').set('no'))));
    const rescued = Task.of<Record<string, unknown>>('recoverable-failure', (lay) =>
      lay.at('attempted').set(true).reject('expected_failure', 'recover me'),
    ).rescueWith(Task.of('recovery', (lay) => lay.at('recovered').set(true)));
    const workflow = seed.then(parallel).then(branch).then(rescued);
    const work = connection.workflow('nested workflow', workflow);

    const plan = connection.issue();
    expect(root.state()).toEqual({ ready: true });
    expect(plan.observation.state(work)).toBe('pending');
    expect(plan.observation.events).toEqual([]);

    await plan.start();

    expect(plan.result(work)).toBeInstanceOf(Ok);
    expect(root.state()).toEqual({
      ready: true,
      seeded: true,
      left: 1,
      right: 2,
      branched: 'yes',
      attempted: true,
      recovered: true,
    });
    const events = taskEvents(plan.observation.events);
    for (const name of [
      'seed',
      'parallel-left',
      'parallel-right',
      'branch-yes',
      'recoverable-failure',
      'recovery',
    ]) {
      expect(events).toContainEqual([
        name === 'recoverable-failure' ? 'berylx-task-failed' : 'berylx-task-completed',
        name,
      ]);
    }
    expect(events.some(([, name]) => name === 'branch-no')).toBe(false);
  });

  it('retains Err partial state without committing it to Root', async () => {
    const root = Root.of<Record<string, unknown>>({ committed: true });
    const connection = BerylxTimeline.forRoot(
      root,
      new ManualClock(new Date('2026-09-26T00:00:00Z')),
    );
    const workflow = Task.of<Record<string, unknown>>('stage', (lay) =>
      lay.at('staged').set(true),
    ).then(Task.of('reject', (lay) =>
      lay.at('attempted').set(true).reject('rejected', 'not committed')));
    const work = connection.workflow('failing workflow', workflow);
    const plan = connection.issue();

    await expect(plan.start()).rejects.toMatchObject({ code: 'TASK_FAILED' });

    const result = plan.result(work);
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).focus.toObject()).toEqual({
      committed: true,
      staged: true,
      attempted: true,
    });
    expect(root.state()).toEqual({ committed: true });
    expect(plan.observation.state(work)).toBe('failed');
  });

  it('preserves ordinary Ok replacement for an unchanged scalar Root', async () => {
    const root = Root.of(0);
    const connection = BerylxTimeline.forRoot(
      root,
      new ManualClock(new Date('2026-09-26T00:00:00Z')),
    );
    const work = connection.workflow('scalar replacement', Task.of<number>('replace', () => 1));
    const plan = connection.issue();

    await plan.start();

    expect(root.state()).toBe(1);
    expect((plan.result(work) as Ok<number>).focus.toObject()).toBe(1);
  });

  it('preserves ordinary Ok replacement for an unchanged array Root', async () => {
    const root = Root.of([1]);
    const connection = BerylxTimeline.forRoot(
      root,
      new ManualClock(new Date('2026-09-26T00:00:00Z')),
    );
    const work = connection.workflow(
      'array replacement',
      Task.of<number[]>('append', () => [1, 2]),
    );
    const plan = connection.issue();

    await plan.start();

    expect(root.state()).toEqual([1, 2]);
    expect((plan.result(work) as Ok<number[]>).focus.toObject()).toEqual([1, 2]);
  });

  it('allows an object-to-scalar Ok replacement when Root is unchanged', async () => {
    const root = Root.of<unknown>({ value: 1 });
    const connection = BerylxTimeline.forRoot(
      root,
      new ManualClock(new Date('2026-09-26T00:00:00Z')),
    );
    const work = connection.workflow(
      'shape replacement',
      Task.of<unknown>('replace shape', () => 7),
    );
    const plan = connection.issue();

    await plan.start();

    expect(root.state()).toBe(7);
    expect((plan.result(work) as Ok<unknown>).focus.toObject()).toBe(7);
  });

  it('preserves ordinary object replacement and deletion when Root is unchanged', async () => {
    const root = Root.of<Record<string, unknown>>({ a: 1 });
    const connection = BerylxTimeline.forRoot(
      root,
      new ManualClock(new Date('2026-09-26T00:00:00Z')),
    );
    const work = connection.workflow(
      'object replacement',
      Task.of<Record<string, unknown>>('replace object', () => ({ b: 2 })),
    );
    const plan = connection.issue();

    await plan.start();

    expect(root.state()).toEqual({ b: 2 });
    expect((plan.result(work) as Ok).focus.toObject()).toEqual({ b: 2 });
  });

  it('waits from an AsyncTask effect and resumes on human completion', async () => {
    const root = Root.of<Record<string, unknown>>({ authenticated: false });
    const connection = BerylxTimeline.forRoot(
      root,
      new ManualClock(new Date('2026-09-26T00:00:00Z')),
    );
    const login = connection.humanLogin('complete login screen');
    const workflow = AsyncTask.of<Record<string, unknown>>(
      'authenticate',
      async (lay, performer) => {
        await waitForHumanLogin(performer, login);
        return lay.at('authenticated').set(true);
      },
    ).then(Task.of('after-login', (lay) => lay.at('continued').set(true)));
    const work = connection.workflow('login workflow', workflow);
    const laterWorkflow = AsyncTask.of<Record<string, unknown>>(
      'reuse-authentication',
      async (lay, performer) => {
        await waitForHumanLogin(performer, login);
        return lay.at('reusedAuthentication').set(true);
      },
    );
    const laterWork = connection.workflow(
      'later workflow',
      laterWorkflow,
      timelinePredicates.completed(work),
    );
    const unrelated = connection.workflow(
      'unrelated root workflow',
      Task.of('background', (lay) => lay.at('background').set(true)),
    );
    const plan = connection.issue();

    expect(plan.observation.state(login)).toBe('pending');
    const starting = plan.start();
    let eventLoopTicked = false;
    await new Promise<void>((resolve) => setTimeout(() => {
      eventLoopTicked = true;
      resolve();
    }, 0));

    expect(eventLoopTicked).toBe(true);
    expect(plan.observation.state(login)).toBe('waiting');
    expect(plan.observation.state(work)).toBe('running');
    expect(plan.observation.state(unrelated)).toBe('completed');
    expect(root.state()).toEqual({ authenticated: false, background: true });

    await plan.emit({ type: 'human-completed', task: login });
    await starting;

    expect(plan.observation.state(login)).toBe('completed');
    expect(plan.observation.state(work)).toBe('completed');
    expect(plan.observation.state(laterWork)).toBe('completed');
    expect((plan.result(work) as Ok).focus.toObject()).toEqual({
      authenticated: true,
      background: true,
      continued: true,
    });
    expect(root.state()).toEqual({
      authenticated: true,
      background: true,
      reusedAuthentication: true,
      continued: true,
    });
    expect(plan.observation.events).toContainEqual(expect.objectContaining({
      type: 'human-completed',
      task: login,
    }));
    expect(taskEvents(plan.observation.events)).toContainEqual([
      'berylx-task-completed',
      'after-login',
    ]);
    expect(taskEvents(plan.observation.events)).toContainEqual([
      'berylx-task-completed',
      'reuse-authentication',
    ]);
  });

  it('surfaces a strict conflict when concurrent workflows change the same path', async () => {
    const root = Root.of<Record<string, unknown>>({ value: 'base' });
    const connection = BerylxTimeline.forRoot(
      root,
      new ManualClock(new Date('2026-09-26T00:00:00Z')),
    );
    const login = connection.humanLogin('conflict login');
    const paused = connection.workflow(
      'paused writer',
      AsyncTask.of('write after login', async (lay, performer) => {
        await waitForHumanLogin(performer, login);
        return lay.at('value').set('paused');
      }),
    );
    const other = connection.workflow(
      'other writer',
      Task.of('write immediately', (lay) => lay.at('value').set('other')),
    );
    const plan = connection.issue();
    const starting = plan.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plan.observation.state(login)).toBe('waiting');
    expect(plan.observation.state(other)).toBe('completed');
    expect(root.state()).toEqual({ value: 'other' });

    await plan.emit({ type: 'human-completed', task: login });
    await expect(starting).rejects.toMatchObject({ code: 'TASK_FAILED' });

    const result = plan.result(paused);
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('merge_conflict');
    expect(root.state()).toEqual({ value: 'other' });
  });

  it('surfaces concurrent incompatible scalar updates instead of overwriting', async () => {
    const root = Root.of(0);
    const connection = BerylxTimeline.forRoot(
      root,
      new ManualClock(new Date('2026-09-26T00:00:00Z')),
    );
    const login = connection.humanLogin('scalar conflict login');
    const paused = connection.workflow(
      'paused scalar writer',
      AsyncTask.of<number>('write scalar after login', async (_lay, performer) => {
        await waitForHumanLogin(performer, login);
        return 1;
      }),
    );
    const other = connection.workflow(
      'immediate scalar writer',
      Task.of<number>('write scalar immediately', () => 2),
    );
    const plan = connection.issue();
    const starting = plan.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plan.observation.state(other)).toBe('completed');
    expect(root.state()).toBe(2);

    await plan.emit({ type: 'human-completed', task: login });
    await expect(starting).rejects.toMatchObject({ code: 'TASK_FAILED' });

    const result = plan.result(paused);
    expect(result).toBeInstanceOf(Err);
    expect((result as Err<number>).code).toBe('merge_conflict');
    expect(root.state()).toBe(2);
  });

  it('merges a concurrent disjoint update with an object deletion', async () => {
    const root = Root.of<Record<string, unknown>>({ a: 1, stable: true });
    const connection = BerylxTimeline.forRoot(
      root,
      new ManualClock(new Date('2026-09-26T00:00:00Z')),
    );
    const login = connection.humanLogin('deletion login');
    const paused = connection.workflow(
      'deleting writer',
      AsyncTask.of<Record<string, unknown>>('delete a', async (_lay, performer) => {
        await waitForHumanLogin(performer, login);
        return { stable: true };
      }),
    );
    const other = connection.workflow(
      'disjoint writer',
      Task.of<Record<string, unknown>>('add b', (lay) => lay.at('b').set(2)),
    );
    const plan = connection.issue();
    const starting = plan.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plan.observation.state(other)).toBe('completed');
    expect(root.state()).toEqual({ a: 1, stable: true, b: 2 });

    await plan.emit({ type: 'human-completed', task: login });
    await starting;

    expect(root.state()).toEqual({ stable: true, b: 2 });
    expect((plan.result(paused) as Ok).focus.toObject()).toEqual({ stable: true, b: 2 });
  });

  it('surfaces a conflict when deletion races a same-path update', async () => {
    const root = Root.of<Record<string, unknown>>({ a: 1 });
    const connection = BerylxTimeline.forRoot(
      root,
      new ManualClock(new Date('2026-09-26T00:00:00Z')),
    );
    const login = connection.humanLogin('deletion conflict login');
    const paused = connection.workflow(
      'deleting writer',
      AsyncTask.of<Record<string, unknown>>('delete a', async (_lay, performer) => {
        await waitForHumanLogin(performer, login);
        return {};
      }),
    );
    const other = connection.workflow(
      'updating writer',
      Task.of<Record<string, unknown>>('update a', (lay) => lay.at('a').set(2)),
    );
    const plan = connection.issue();
    const starting = plan.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plan.observation.state(other)).toBe('completed');
    expect(root.state()).toEqual({ a: 2 });

    await plan.emit({ type: 'human-completed', task: login });
    await expect(starting).rejects.toMatchObject({ code: 'TASK_FAILED' });

    const result = plan.result(paused);
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('merge_conflict');
    expect(root.state()).toEqual({ a: 2 });
  });

  it('advance flushes due beat and cron work while a login workflow is active', async () => {
    const clock = new ManualClock(new Date('2026-09-26T00:00:00Z'));
    const root = Root.of<Record<string, unknown>>({ done: false });
    const connection = BerylxTimeline.forRoot(root, clock);
    const login = connection.humanLogin('timed login');
    const work = connection.workflow(
      'waiting workflow',
      AsyncTask.of('wait for login', async (lay, performer) => {
        await waitForHumanLogin(performer, login);
        return lay.at('done').set(true);
      }),
    );
    connection.timeline.beat({
      type: 'due-beat',
      beat: 1,
      bpm: 1,
      from: new Date('2026-09-26T00:00:00Z'),
    });
    connection.timeline.calendar({
      type: 'due-cron',
      at: new Date('2026-09-26T00:00:00Z'),
      cron: { minute: 1, hour: 0, dayOfMonth: 26, month: 9, dayOfWeek: 6 },
    });
    const due: string[] = [];
    connection.timeline.recurring('beat work', 'due-beat', () => { due.push('beat'); });
    connection.timeline.recurring('cron work', 'due-cron', () => { due.push('cron'); });
    const plan = connection.issue();
    const starting = plan.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plan.observation.state(login)).toBe('waiting');

    clock.current = new Date('2026-09-26T00:01:00Z');
    await within(plan.advance(), 500);

    expect(due.sort()).toEqual(['beat', 'cron']);
    expect(plan.observation.state(work)).toBe('running');
    expect(root.state()).toEqual({ done: false });
    await plan.emit({ type: 'human-completed', task: login });
    await starting;
    expect(root.state()).toEqual({ done: true });
  });

  it('surfaces independent failure promptly and prevents commits from cancelled runners', async () => {
    const root = Root.of<Record<string, unknown>>({ stable: true });
    const connection = BerylxTimeline.forRoot(
      root,
      new ManualClock(new Date('2026-09-26T00:00:00Z')),
    );
    const login = connection.humanLogin('never completed');
    const loginWork = connection.workflow(
      'login waiter',
      AsyncTask.of('wait indefinitely', async (lay, performer) => {
        await waitForHumanLogin(performer, login);
        return lay.at('afterLogin').set(true);
      }),
    );
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
    let enteredSlow!: () => void;
    const slowEntered = new Promise<void>((resolve) => { enteredSlow = resolve; });
    const slowWork = connection.workflow(
      'slow writer',
      AsyncTask.of('slow commit', async (lay) => {
        enteredSlow();
        await slowGate;
        return lay.at('lateCommit').set(true);
      }),
    );
    connection.timeline.ai('fatal independent task', () => {
      throw new Error('fatal independent failure');
    });
    const plan = connection.issue();
    const starting = plan.start();
    await slowEntered;

    await expect(within(starting, 500)).rejects.toMatchObject({ code: 'TASK_FAILED' });
    expect(plan.observation.state(loginWork)).toBe('failed');
    expect(plan.observation.state(slowWork)).toBe('failed');
    expect(root.state()).toEqual({ stable: true });

    releaseSlow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.state()).toEqual({ stable: true });
    await expect(plan.emit({ type: 'human-completed', task: login }))
      .rejects.toMatchObject({ code: 'TASK_FAILED' });
  });
});

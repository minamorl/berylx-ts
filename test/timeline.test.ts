import { strict as assert } from 'node:assert';
import { test } from 'vitest';
import { KeyframeTrack, Timeline, TimelineError, predicates,
  type Clock, type ExecutablePlan } from '../src/timeline';

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

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await Promise.resolve();
    }
  }
  throw lastError;
}

test('one root per execution and issuing does not start work', async () => {
  const clock = new ManualClock(new Date('2026-01-01T00:00:00Z'));
  const token = {};
  const root = Timeline.forExecution(token, clock);
  assert.equal(Timeline.forExecution(token, clock), root);
  assert.notEqual(Timeline.forExecution({}, clock), root);
  let runs = 0;
  const task = root.ai('first', () => { runs++; });
  const plan = root.issue();
  assert.equal(runs, 0);
  assert.equal(plan.observation.state(task), 'pending');
  await plan.start();
  assert.equal(runs, 1);
  assert.equal(plan.observation.state(task), 'completed');
});

test('predicates observe events and task state', async () => {
  const clock = new ManualClock(new Date('2026-01-01T00:00:00Z'));
  const timeline = Timeline.forExecution({}, clock);
  const first = timeline.ai('first', () => {});
  let secondRan = false;
  const second = timeline.ai('second', () => { secondRan = true; },
    predicates.all(predicates.completed(first), predicates.event('go')));
  const plan = timeline.issue();
  await plan.start();
  assert.equal(secondRan, false);
  await plan.emit({ type: 'go' });
  assert.equal(secondRan, true);
  assert.equal(plan.observation.state(second), 'completed');
});

test('human login blocks dependent AI but not unrelated ready work', async () => {
  const clock = new ManualClock(new Date('2026-01-01T00:00:00Z'));
  const timeline = Timeline.forExecution({}, clock);
  const login = timeline.humanLogin('handle login screen');
  let runs = 0;
  const ai = timeline.ai('continue', () => { runs++; }, predicates.completed(login));
  let unrelatedRuns = 0;
  const unrelated = timeline.ai('unrelated', () => { unrelatedRuns++; });
  const plan = timeline.issue();
  await plan.start();
  assert.equal(plan.observation.state(login), 'waiting');
  assert.equal(plan.observation.state(ai), 'pending');
  assert.equal(plan.observation.state(unrelated), 'completed');
  assert.equal(runs, 0);
  assert.equal(unrelatedRuns, 1);
  await plan.emit({ type: 'human-completed', task: login });
  assert.equal(plan.observation.state(login), 'completed');
  assert.equal(plan.observation.state(ai), 'completed');
  assert.equal(runs, 1);
});

test('user work waits for a person and errors have a structured envelope', async () => {
  const clock = new ManualClock(new Date('2026-01-01T00:00:00Z'));
  const timeline = Timeline.forExecution({}, clock);
  const user = timeline.user('review');
  const plan = timeline.issue();
  await plan.start();
  assert.equal(plan.observation.state(user), 'waiting');
  await plan.emit({ type: 'human-completed', task: user });
  assert.equal(plan.observation.state(user), 'completed');
  await assert.rejects(plan.emit({ type: 'human-completed', task: user }), (error: unknown) => {
    assert.ok(error instanceof TimelineError);
    assert.deepEqual(Object.keys(error.toJSON()), ['code', 'message', 'details', 'trace_id']);
    assert.match(error.trace_id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    return true;
  });
});

test('human completion can release dependent work while unrelated AI is still running', async () => {
  const clock = new ManualClock(new Date('2026-01-01T00:00:00Z'));
  const timeline = Timeline.forExecution({}, clock);
  const human = timeline.user('approve');
  let dependentRuns = 0;
  const dependent = timeline.ai('after approval', () => { dependentRuns++; },
    predicates.all(predicates.completed(human), predicates.event('human-completed')));
  let signalEntered!: () => void;
  const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
  let releaseRunner!: () => void;
  const runnerGate = new Promise<void>((resolve) => { releaseRunner = resolve; });
  timeline.ai('slow work', async () => {
    signalEntered();
    await runnerGate;
  });
  const plan = timeline.issue();
  const starting = plan.start();
  await entered;
  const delivery = plan.emit({ type: 'human-completed', task: human });
  assert.equal(plan.observation.state(human), 'completed');
  await delivery;
  await eventually(() => assert.equal(plan.observation.state(dependent), 'completed'));
  assert.equal(dependentRuns, 1);
  releaseRunner();
  await starting;
  assert.equal(dependentRuns, 1);
  assert.equal(plan.observation.state(dependent), 'completed');
});

test('event published by a runner wakes the concurrent scheduler', async () => {
  const clock = new ManualClock(new Date('2026-01-01T00:00:00Z'));
  const timeline = Timeline.forExecution({}, clock);
  const human = timeline.user('approve');
  let dependentRuns = 0;
  const dependent = timeline.ai('after approval', () => { dependentRuns++; },
    predicates.completed(human));
  let signalEntered!: () => void;
  const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
  let releaseRunner!: () => void;
  const runnerGate = new Promise<void>((resolve) => { releaseRunner = resolve; });
  let plan!: ExecutablePlan;
  let delivery!: Promise<void>;
  timeline.ai('slow work', async () => {
    delivery = plan.emit({ type: 'human-completed', task: human });
    signalEntered();
    await runnerGate;
  });
  plan = timeline.issue();
  const starting = plan.start();
  await entered;
  await eventually(() => assert.equal(dependentRuns, 1));
  releaseRunner();
  await Promise.all([starting, delivery]);
  assert.equal(dependentRuns, 1);
  assert.equal(plan.observation.state(dependent), 'completed');
});

test('an AI runner can await emit without a cycle and queued work runs afterward', async () => {
  const clock = new ManualClock(new Date('2026-01-01T00:00:00Z'));
  const timeline = Timeline.forExecution({}, clock);
  const human = timeline.user('approve');
  let dependentRuns = 0;
  const dependent = timeline.ai('after approval', () => { dependentRuns++; },
    predicates.completed(human));
  let plan!: ExecutablePlan;
  timeline.ai('publisher', async () => {
    await plan.emit({ type: 'human-completed', task: human });
    assert.equal(plan.observation.state(human), 'completed');
  });
  plan = timeline.issue();
  await within(plan.start(), 1_000);
  assert.equal(dependentRuns, 1);
  assert.equal(plan.observation.state(dependent), 'completed');
});

test('beat subdivisions and recurring UTC calendar origins trigger at due times', async () => {
  const clock = new ManualClock(new Date('2026-01-01T00:00:00Z'));
  const timeline = Timeline.forExecution({}, clock);
  timeline.beat({ type: 'quarter-beat', beat: 0.25, bpm: 120,
    from: new Date('2026-01-01T00:00:00Z') });
  timeline.calendar({ type: 'minute', at: new Date('2026-01-01T00:01:00Z'),
    every: 'minute' });
  const plan = timeline.issue();
  await plan.start();
  assert.equal(plan.observation.events.length, 0);
  clock.current = new Date('2026-01-01T00:00:00.125Z');
  await plan.advance();
  assert.equal(plan.observation.events[0]?.origin?.kind, 'beat');
  clock.current = new Date('2026-01-01T00:02:00Z');
  await plan.advance();
  assert.deepEqual(plan.observation.events.map((event) => event.type),
    ['quarter-beat', 'minute', 'minute']);
  assert.equal(plan.observation.events[2]?.at.toISOString(), '2026-01-01T00:02:00.000Z');
});

test('recurring work runs exactly once per BPM subdivision occurrence', async () => {
  const clock = new ManualClock(new Date('2026-01-01T00:00:00Z'));
  const timeline = Timeline.forExecution({}, clock);
  timeline.beat({
    type: 'pulse',
    beat: 0.25,
    every: 0.25,
    bpm: 120,
    from: new Date('2026-01-01T00:00:00Z'),
  });
  const beats: number[] = [];
  timeline.recurring('each pulse', 'pulse', (_observation, occurrence) => {
    if (occurrence.origin?.kind === 'beat') beats.push(occurrence.origin.beat);
  });
  let oneShotRuns = 0;
  timeline.ai('one shot', () => { oneShotRuns++; }, predicates.event('pulse'));
  const plan = timeline.issue();
  await plan.start();

  clock.current = new Date('2026-01-01T00:00:00.375Z');
  await plan.advance();
  assert.deepEqual(beats, [0.25, 0.5, 0.75]);
  assert.equal(oneShotRuns, 1);

  await plan.advance();
  assert.deepEqual(beats, [0.25, 0.5, 0.75]);
  clock.current = new Date('2026-01-01T00:00:00.500Z');
  await plan.advance();
  assert.deepEqual(beats, [0.25, 0.5, 0.75, 1]);
  assert.equal(oneShotRuns, 1);
});

test('UTC cron selections drive recurring work at selected calendar minutes', async () => {
  const clock = new ManualClock(new Date('2026-09-26T00:00:30Z'));
  const timeline = Timeline.forExecution({}, clock);
  timeline.calendar({
    type: 'cron-tick',
    at: new Date('2026-09-26T00:00:30Z'),
    cron: {
      minute: [1, 3],
      hour: 0,
      dayOfMonth: 26,
      month: 9,
      dayOfWeek: 6,
    },
  });
  const occurrences: string[] = [];
  timeline.recurring('cron work', 'cron-tick', (_observation, occurrence) => {
    occurrences.push(occurrence.at.toISOString());
  });
  const plan = timeline.issue();
  await plan.start();
  assert.deepEqual(occurrences, []);

  clock.current = new Date('2026-09-26T00:03:00Z');
  await plan.advance();
  assert.deepEqual(occurrences, [
    '2026-09-26T00:01:00.000Z',
    '2026-09-26T00:03:00.000Z',
  ]);
  await plan.advance();
  assert.equal(occurrences.length, 2);
  const cron = plan.observation.events[0]?.origin;
  assert.equal(cron?.kind, 'calendar');
  if (cron?.kind === 'calendar') {
    assert.deepEqual(cron.cron?.dayOfWeek, [6]);
  }
});

test('keyframes interpolate arbitrary requested times and generate animation samples', () => {
  const track = new KeyframeTrack()
    .place(new Date('2026-01-01T00:00:00Z'), 0)
    .place(new Date('2026-01-01T00:00:10Z'), 20);
  assert.equal(track.sample(new Date('2026-01-01T00:00:02.500Z')), 5);
  assert.deepEqual(track.generate([
    new Date('2025-12-31T23:59:59Z'),
    new Date('2026-01-01T00:00:05Z'),
    new Date('2026-01-01T00:00:11Z'),
  ]), [0, 10, 20]);
});

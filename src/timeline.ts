/** A Clock supplies time; a Timeline owns the plan, observations, and execution. */
export interface Clock {
  now(): Date;
}

const ulidAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newTraceId(): string {
  let time = Date.now();
  let prefix = '';
  for (let i = 0; i < 10; i++) {
    prefix = ulidAlphabet[time % 32]! + prefix;
    time = Math.floor(time / 32);
  }
  let suffix = '';
  for (let i = 0; i < 16; i++) {
    suffix += ulidAlphabet[Math.floor(Math.random() * 32)]!;
  }
  return prefix + suffix;
}

export class TimelineError extends Error {
  readonly trace_id = newTraceId();
  constructor(readonly code: string, message: string,
              readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'TimelineError';
  }

  toJSON(): { code: string; message: string; details: Record<string, unknown>; trace_id: string } {
    return { code: this.code, message: this.message,
      details: this.details, trace_id: this.trace_id };
  }
}

export type TaskState = 'pending' | 'running' | 'waiting' | 'completed' | 'failed';
export type TaskKind = 'ai' | 'user' | 'human-login';

export interface TaskRef {
  readonly kind: TaskKind;
  readonly label: string;
}

export interface TimelineEvent {
  readonly type: string;
  readonly at: Date;
  readonly task?: TaskRef;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly origin?:
    | { readonly kind: 'beat'; readonly beat: number; readonly bpm: number }
    | { readonly kind: 'calendar'; readonly cron?: ResolvedCronSelection };
}

export interface Observation {
  readonly events: readonly TimelineEvent[];
  state(task: TaskRef): TaskState;
  hasEvent(type: string): boolean;
}

export type Predicate = (observation: Observation) => boolean;
export const predicates = {
  event: (type: string): Predicate => (observation) => observation.hasEvent(type),
  completed: (task: TaskRef): Predicate =>
    (observation) => observation.state(task) === 'completed',
  all: (...parts: Predicate[]): Predicate =>
    (observation) => parts.every((part) => part(observation)),
  any: (...parts: Predicate[]): Predicate =>
    (observation) => parts.some((part) => part(observation)),
};

export interface BeatOrigin {
  readonly type: string;
  /** The beat position can contain a subdivision such as 0.25. */
  readonly beat: number;
  readonly bpm: number;
  readonly from: Date;
  /** Repeat at this many beat positions after the first occurrence. */
  readonly every?: number;
}

export type CronField = number | readonly number[];

/** UTC cron selectors. When both day fields are present, both must match. */
export interface CronSelection {
  readonly minute?: CronField;
  readonly hour?: CronField;
  readonly dayOfMonth?: CronField;
  /** January is 1 and December is 12. */
  readonly month?: CronField;
  /** Sunday is 0 and Saturday is 6. */
  readonly dayOfWeek?: CronField;
}

export interface ResolvedCronSelection {
  readonly minute?: readonly number[];
  readonly hour?: readonly number[];
  readonly dayOfMonth?: readonly number[];
  readonly month?: readonly number[];
  readonly dayOfWeek?: readonly number[];
}

export interface CalendarOrigin {
  readonly type: string;
  /** An absolute UTC instant. */
  readonly at: Date;
  /** Recur on UTC calendar minute, hour, or day boundaries from `at`. */
  readonly every?: 'minute' | 'hour' | 'day';
  /** Select recurring UTC calendar minutes at or after `at`. */
  readonly cron?: CronSelection;
}

interface TaskDefinition {
  readonly ref: TaskRef;
  readonly when: Predicate;
  readonly run?: (observation: Observation, occurrence?: TimelineEvent) => void | Promise<void>;
  readonly recurringEvent?: string;
}

type OriginRecurrence =
  | { readonly kind: 'calendar-interval'; readonly every: NonNullable<CalendarOrigin['every']> }
  | { readonly kind: 'cron'; readonly selection: ResolvedCronSelection }
  | { readonly kind: 'beat'; readonly every: number; readonly bpm: number; readonly from: Date };

interface OriginDefinition {
  readonly type: string;
  at: Date;
  readonly recurrence?: OriginRecurrence;
  origin: NonNullable<TimelineEvent['origin']>;
}

interface TaskCompletion {
  readonly task: TaskDefinition;
  readonly failure?: TimelineError;
}

interface HumanWaiter {
  readonly resolve: () => void;
  readonly reject: (error: TimelineError) => void;
}

interface AdvanceWaiter {
  readonly baseline: ReadonlySet<TaskRef>;
  readonly pending: Set<TaskRef>;
  seenCycle: boolean;
  readonly resolve: () => void;
  readonly reject: (error: TimelineError) => void;
}

const cronRanges = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 6],
} as const;

function normalizeCron(selection: CronSelection): ResolvedCronSelection {
  const normalized: Record<string, readonly number[] | undefined> = {};
  for (const [field, [minimum, maximum]] of Object.entries(cronRanges)) {
    const input = selection[field as keyof CronSelection];
    if (input === undefined) continue;
    const values = [...new Set(Array.isArray(input) ? input : [input])].sort((a, b) => a - b);
    if (!values.length || values.some((value) =>
      !Number.isInteger(value) || value < minimum || value > maximum)) {
      throw new TimelineError('INVALID_CRON', `Invalid UTC cron ${field} selection`);
    }
    normalized[field] = Object.freeze(values);
  }
  return Object.freeze(normalized) as ResolvedCronSelection;
}

function includesCron(values: readonly number[] | undefined, value: number): boolean {
  return values === undefined || values.includes(value);
}

function cronMatches(at: Date, selection: ResolvedCronSelection): boolean {
  return includesCron(selection.minute, at.getUTCMinutes()) &&
    includesCron(selection.hour, at.getUTCHours()) &&
    includesCron(selection.dayOfMonth, at.getUTCDate()) &&
    includesCron(selection.month, at.getUTCMonth() + 1) &&
    includesCron(selection.dayOfWeek, at.getUTCDay());
}

function nextCronAtOrAfter(lowerBound: Date, selection: ResolvedCronSelection): Date {
  const candidate = new Date(lowerBound);
  if (candidate.getUTCSeconds() !== 0 || candidate.getUTCMilliseconds() !== 0) {
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1, 0, 0);
  } else {
    candidate.setUTCSeconds(0, 0);
  }
  const limit = new Date(candidate);
  limit.setUTCFullYear(limit.getUTCFullYear() + 40);

  while (candidate.getTime() <= limit.getTime()) {
    if (!includesCron(selection.month, candidate.getUTCMonth() + 1) ||
        !includesCron(selection.dayOfMonth, candidate.getUTCDate()) ||
        !includesCron(selection.dayOfWeek, candidate.getUTCDay())) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      candidate.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!includesCron(selection.hour, candidate.getUTCHours())) {
      candidate.setUTCHours(candidate.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!includesCron(selection.minute, candidate.getUTCMinutes())) {
      candidate.setUTCMinutes(candidate.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    if (cronMatches(candidate, selection)) return candidate;
  }
  throw new TimelineError('INVALID_CRON', 'UTC cron selection has no occurrence within 40 years');
}

/** The execution object is the shared token used to acquire one Timeline Root. */
export class Timeline {
  private static readonly roots = new WeakMap<object, Timeline>();
  private readonly tasks: TaskDefinition[] = [];
  private readonly origins: OriginDefinition[] = [];
  private issued = false;

  private constructor(private readonly clock: Clock) {}

  static forExecution(execution: object, clock: Clock): Timeline {
    let root = Timeline.roots.get(execution);
    if (!root) {
      root = new Timeline(clock);
      Timeline.roots.set(execution, root);
    } else if (root.clock !== clock) {
      throw new TimelineError('CLOCK_CONFLICT', 'An execution already has a Timeline with another Clock');
    }
    return root;
  }

  ai(label: string, run: TaskDefinition['run'], when: Predicate = () => true): TaskRef {
    if (!run) throw new TimelineError('INVALID_TASK', 'AI task requires a runner');
    return this.addTask('ai', label, when, run);
  }

  /** Run once for each new event of `eventType`; ordinary ai() tasks remain one-shot. */
  recurring(
    label: string,
    eventType: string,
    run: (observation: Observation, occurrence: TimelineEvent) => void | Promise<void>,
    when: Predicate = () => true,
  ): TaskRef {
    if (!eventType || !run) {
      throw new TimelineError('INVALID_TASK', 'Recurring AI task requires an event type and runner');
    }
    return this.addTask('ai', label, when, (observation, occurrence) => {
      if (!occurrence) {
        throw new TimelineError('MISSING_OCCURRENCE', 'Recurring task requires an event occurrence');
      }
      return run(observation, occurrence);
    }, eventType);
  }

  user(label: string, when: Predicate = () => true): TaskRef {
    return this.addTask('user', label, when);
  }

  humanLogin(label: string, when: Predicate = () => true): TaskRef {
    return this.addTask('human-login', label, when);
  }

  beat(origin: BeatOrigin): this {
    this.ensureDraft();
    if (!Number.isFinite(origin.bpm) || origin.bpm <= 0 ||
        !Number.isFinite(origin.beat) || origin.beat < 0 ||
        (origin.every !== undefined &&
          (!Number.isFinite(origin.every) || origin.every <= 0))) {
      throw new TimelineError('INVALID_BEAT', 'Beat and BPM must be finite; BPM must be positive');
    }
    const at = new Date(origin.from.getTime() + origin.beat * 60_000 / origin.bpm);
    if (!Number.isFinite(at.getTime())) {
      throw new TimelineError('INVALID_BEAT', 'Beat origin time must be finite');
    }
    const recurrence = origin.every === undefined ? undefined : {
      kind: 'beat' as const,
      every: origin.every,
      bpm: origin.bpm,
      from: new Date(origin.from),
    };
    if (recurrence) {
      const next = new Date(
        recurrence.from.getTime() + (origin.beat + recurrence.every) * 60_000 / origin.bpm,
      );
      if (next.getTime() <= at.getTime()) {
        throw new TimelineError('INVALID_BEAT', 'Recurring beat interval must advance time');
      }
    }
    this.origins.push({
      type: origin.type,
      at,
      recurrence,
      origin: { kind: 'beat', beat: origin.beat, bpm: origin.bpm },
    });
    return this;
  }

  calendar(origin: CalendarOrigin): this {
    this.ensureDraft();
    if (!Number.isFinite(origin.at.getTime())) {
      throw new TimelineError('INVALID_CALENDAR', 'Invalid calendar time');
    }
    if (origin.every && origin.cron) {
      throw new TimelineError('INVALID_CALENDAR', 'Calendar origin cannot combine every and cron');
    }
    if (origin.cron) {
      const selection = normalizeCron(origin.cron);
      this.origins.push({
        type: origin.type,
        at: nextCronAtOrAfter(origin.at, selection),
        recurrence: { kind: 'cron', selection },
        origin: { kind: 'calendar', cron: selection },
      });
      return this;
    }
    this.origins.push({
      type: origin.type,
      at: new Date(origin.at),
      recurrence: origin.every
        ? { kind: 'calendar-interval', every: origin.every }
        : undefined,
      origin: { kind: 'calendar' },
    });
    return this;
  }

  /** Issuing snapshots an executable plan. No task starts until start() is called. */
  issue(): ExecutablePlan {
    this.ensureDraft();
    this.issued = true;
    return new ExecutablePlan(this.clock, [...this.tasks], [...this.origins]);
  }

  private addTask(
    kind: TaskKind,
    label: string,
    when: Predicate,
    run?: TaskDefinition['run'],
    recurringEvent?: string,
  ): TaskRef {
    this.ensureDraft();
    const ref: TaskRef = Object.freeze({ kind, label });
    this.tasks.push({ ref, when, run, recurringEvent });
    return ref;
  }

  private ensureDraft(): void {
    if (this.issued) throw new TimelineError('ALREADY_ISSUED', 'Timeline has already issued its plan');
  }
}

export class ExecutablePlan {
  private readonly states = new Map<TaskRef, TaskState>();
  private readonly observed: TimelineEvent[] = [];
  private readonly scheduled: OriginDefinition[];
  private started = false;
  private advancing: Promise<void> | undefined;
  private reevaluate = false;
  private fatalFailure: TimelineError | undefined;
  private readonly humanWaiters = new Map<TaskRef, Set<HumanWaiter>>();
  private readonly recurringCursors = new Map<TaskRef, number>();
  private readonly schedulerWaiters = new Set<() => void>();
  private readonly activeRuns = new Map<TaskRef, Promise<TaskCompletion>>();
  private readonly advanceWaiters = new Set<AdvanceWaiter>();

  constructor(private readonly clock: Clock, private readonly tasks: readonly TaskDefinition[],
              origins: readonly OriginDefinition[]) {
    for (const task of tasks) {
      this.states.set(task.ref, 'pending');
      if (task.recurringEvent) this.recurringCursors.set(task.ref, 0);
    }
    this.scheduled = origins.map((origin) => ({
      ...origin,
      at: new Date(origin.at),
      recurrence: origin.recurrence?.kind === 'beat'
        ? { ...origin.recurrence, from: new Date(origin.recurrence.from) }
        : origin.recurrence,
      origin: { ...origin.origin },
    }));
  }

  get observation(): Observation {
    return {
      events: [...this.observed],
      state: (task) => {
        const state = this.states.get(task);
        if (!state) throw new TimelineError('UNKNOWN_TASK', 'Task does not belong to this plan');
        return state;
      },
      hasEvent: (type) => this.observed.some((event) => event.type === type),
    };
  }

  async start(): Promise<void> {
    if (this.started) throw new TimelineError('ALREADY_STARTED', 'Plan has already started');
    this.started = true;
    await this.advance();
  }

  /** Reevaluate due time origins and predicates against the injected Clock. */
  async advance(): Promise<void> {
    if (!this.started) throw new TimelineError('NOT_STARTED', 'Start the plan before advancing it');
    if (this.fatalFailure) throw this.fatalFailure;
    if (this.advancing) {
      this.reevaluate = true;
      const pass = this.waitForSchedulerPass();
      this.signalScheduler();
      return pass;
    }
    // Defer the first pass until `advancing` is set, including when a runner
    // publishes an event synchronously before its first await.
    const work = Promise.resolve().then(async () => {
      try {
        do {
          this.reevaluate = false;
          await this.advanceOnce();
        } while (this.reevaluate);
      } finally {
        this.advancing = undefined;
      }
    });
    this.advancing = work;
    return work;
  }

  /**
   * A person completes user and login work by emitting this event.
   * Awaiting emit always guarantees the event is recorded (and human state updated).
   * If a pass is running, it also guarantees a later evaluation is queued, but
   * does not wait for that evaluation: an AI runner may safely await emit.
   * If idle, emit waits for the evaluation it starts. External callers that
   * need the result of a queued evaluation can await advance() after the runner.
   */
  async emit(event: {
    readonly type: string;
    readonly task?: TaskRef;
    readonly details?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    if (!this.started) throw new TimelineError('NOT_STARTED', 'Start the plan before emitting events');
    if (this.fatalFailure) throw this.fatalFailure;
    if (event.type === 'human-completed') {
      const task = this.tasks.find((entry) => entry.ref === event.task);
      if (!task || task.ref.kind === 'ai' || this.states.get(task.ref) !== 'waiting') {
        throw new TimelineError('INVALID_COMPLETION', 'Human completion requires a waiting human task');
      }
      this.states.set(task.ref, 'completed');
      const waiters = this.humanWaiters.get(task.ref);
      this.humanWaiters.delete(task.ref);
      waiters?.forEach((waiter) => waiter.resolve());
    }
    this.observed.push({ ...event, at: new Date(this.clock.now()) });
    if (this.advancing) {
      this.reevaluate = true;
      this.signalScheduler();
      return;
    }
    await this.advance();
  }

  /**
   * Suspend an asynchronous effect until a predeclared login task is completed.
   * The wait is promise-based: no credentials are accepted or retained and the
   * JavaScript event loop remains available to deliver the completion event.
   */
  waitForHumanLogin(task: TaskRef): Promise<void> {
    if (!this.started) {
      throw new TimelineError('NOT_STARTED', 'Start the plan before waiting for human login');
    }
    if (this.fatalFailure) return Promise.reject(this.fatalFailure);
    const definition = this.tasks.find((entry) => entry.ref === task);
    if (!definition || task.kind !== 'human-login') {
      throw new TimelineError(
        'INVALID_LOGIN_WAIT',
        'Human login wait requires a predeclared human-login task',
      );
    }
    const state = this.states.get(task);
    if (state === 'completed') return Promise.resolve();
    if (state === 'failed') {
      throw new TimelineError('INVALID_LOGIN_WAIT', 'Human login task is no longer waitable');
    }
    if (state === 'pending') this.states.set(task, 'waiting');
    return new Promise<void>((resolve, reject) => {
      const waiters = this.humanWaiters.get(task) ?? new Set<HumanWaiter>();
      waiters.add({ resolve, reject });
      this.humanWaiters.set(task, waiters);
    });
  }

  /** Reject commits from runners that outlive a fatal plan failure. */
  assertCommitAllowed(): void {
    if (this.fatalFailure) throw this.fatalFailure;
  }

  private async advanceOnce(): Promise<void> {
    for (;;) {
      this.recordDueOrigins();
      this.advanceWaiters.forEach((waiter) => { waiter.seenCycle = true; });
      for (const task of this.tasks) {
        if (this.states.get(task.ref) === 'pending' && task.when(this.observation) &&
            task.ref.kind !== 'ai') {
          this.states.set(task.ref, 'waiting');
        }
      }

      let launched = false;
      for (const task of this.tasks) {
        if (task.ref.kind !== 'ai' || this.states.get(task.ref) === 'running' ||
            this.states.get(task.ref) === 'failed') continue;
        const occurrence = task.recurringEvent
          ? this.takeRecurringOccurrence(task)
          : undefined;
        const ready = task.recurringEvent
          ? occurrence !== undefined
          : this.states.get(task.ref) === 'pending' && task.when(this.observation);
        if (!ready) continue;
        const execution = this.runTask(task, occurrence);
        this.activeRuns.set(task.ref, execution);
        this.trackAdvanceTask(task.ref);
        launched = true;
      }

      this.resolveAdvanceWaiters(launched);
      if (this.activeRuns.size === 0) {
        return;
      }

      const wake = this.schedulerWake();
      const completion = await Promise.race<TaskCompletion | undefined>([
        ...this.activeRuns.values(),
        wake.promise,
      ]);
      wake.cancel();
      if (!completion) continue;
      this.activeRuns.delete(completion.task.ref);
      this.finishAdvanceTask(completion.task.ref);
      if (completion.failure) {
        this.failPlan(completion.failure);
        throw completion.failure;
      }
    }
  }

  private recordDueOrigins(): void {
    const now = this.clock.now().getTime();
    for (const origin of [...this.scheduled]) {
      while (origin.at.getTime() <= now) {
        this.observed.push({
          type: origin.type,
          at: new Date(origin.at),
          origin: { ...origin.origin },
        });
        if (!this.advanceOrigin(origin)) {
          this.scheduled.splice(this.scheduled.indexOf(origin), 1);
          break;
        }
      }
    }
  }

  private advanceOrigin(origin: OriginDefinition): boolean {
    const recurrence = origin.recurrence;
    if (!recurrence) return false;
    if (recurrence.kind === 'calendar-interval') {
      const next = new Date(origin.at);
      if (recurrence.every === 'minute') next.setUTCMinutes(next.getUTCMinutes() + 1);
      else if (recurrence.every === 'hour') next.setUTCHours(next.getUTCHours() + 1);
      else next.setUTCDate(next.getUTCDate() + 1);
      origin.at = next;
      return true;
    }
    if (recurrence.kind === 'cron') {
      origin.at = nextCronAtOrAfter(
        new Date(origin.at.getTime() + 60_000),
        recurrence.selection,
      );
      return true;
    }
    if (origin.origin.kind !== 'beat') {
      throw new TimelineError('INVALID_BEAT', 'Recurring beat origin is malformed');
    }
    const beat = origin.origin.beat + recurrence.every;
    const next = new Date(recurrence.from.getTime() + beat * 60_000 / recurrence.bpm);
    if (next.getTime() <= origin.at.getTime()) {
      throw new TimelineError('INVALID_BEAT', 'Recurring beat interval must advance time');
    }
    origin.at = next;
    origin.origin = { kind: 'beat', beat, bpm: recurrence.bpm };
    return true;
  }

  private takeRecurringOccurrence(task: TaskDefinition): TimelineEvent | undefined {
    let cursor = this.recurringCursors.get(task.ref) ?? 0;
    while (cursor < this.observed.length) {
      const event = this.observed[cursor]!;
      if (event.type === task.recurringEvent) {
        this.recurringCursors.set(task.ref, cursor);
        if (!task.when(this.observation)) return undefined;
        this.recurringCursors.set(task.ref, cursor + 1);
        return event;
      }
      cursor++;
    }
    this.recurringCursors.set(task.ref, cursor);
    return undefined;
  }

  private runTask(task: TaskDefinition, occurrence?: TimelineEvent): Promise<TaskCompletion> {
    this.states.set(task.ref, 'running');
    return Promise.resolve().then(async () => {
      try {
        await task.run!(this.observation, occurrence);
        if (this.fatalFailure) {
          this.states.set(task.ref, 'failed');
          return { task, failure: this.fatalFailure };
        }
        this.states.set(task.ref, 'completed');
        return { task };
      } catch {
        this.states.set(task.ref, 'failed');
        return {
          task,
          failure: this.fatalFailure ??
            new TimelineError('TASK_FAILED', 'AI task failed', { task: task.ref.label }),
        };
      } finally {
        if (this.fatalFailure) this.activeRuns.delete(task.ref);
      }
    });
  }

  private waitForSchedulerPass(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.advanceWaiters.add({
        baseline: new Set(this.activeRuns.keys()),
        pending: new Set(),
        seenCycle: false,
        resolve,
        reject,
      });
    });
  }

  private trackAdvanceTask(task: TaskRef): void {
    for (const waiter of this.advanceWaiters) {
      if (!waiter.baseline.has(task)) waiter.pending.add(task);
    }
  }

  private finishAdvanceTask(task: TaskRef): void {
    this.advanceWaiters.forEach((waiter) => waiter.pending.delete(task));
  }

  private resolveAdvanceWaiters(launched: boolean): void {
    if (launched) return;
    for (const waiter of [...this.advanceWaiters]) {
      if (!waiter.seenCycle || waiter.pending.size > 0) continue;
      this.advanceWaiters.delete(waiter);
      waiter.resolve();
    }
  }

  private failPlan(error: TimelineError): void {
    if (this.fatalFailure) return;
    this.fatalFailure = error;
    for (const task of this.tasks) {
      if (this.states.get(task.ref) === 'running' || this.states.get(task.ref) === 'waiting') {
        this.states.set(task.ref, 'failed');
      }
    }
    for (const waiters of this.humanWaiters.values()) {
      waiters.forEach((waiter) => waiter.reject(error));
    }
    this.humanWaiters.clear();
    for (const waiter of this.advanceWaiters) waiter.reject(error);
    this.advanceWaiters.clear();
    this.signalScheduler();
  }

  private schedulerWake(): { promise: Promise<undefined>; cancel: () => void } {
    let resolve!: () => void;
    const promise = new Promise<undefined>((done) => {
      resolve = () => done(undefined);
      this.schedulerWaiters.add(resolve);
    });
    return {
      promise,
      cancel: () => this.schedulerWaiters.delete(resolve),
    };
  }

  private signalScheduler(): void {
    const waiters = [...this.schedulerWaiters];
    this.schedulerWaiters.clear();
    waiters.forEach((resolve) => resolve());
  }
}

/** Numeric animation track with linear interpolation and endpoint clamping. */
export class KeyframeTrack {
  private readonly frames: { at: number; value: number }[] = [];

  place(at: Date, value: number): this {
    const time = at.getTime();
    if (!Number.isFinite(time) || !Number.isFinite(value)) {
      throw new TimelineError('INVALID_KEYFRAME', 'Keyframe time and value must be finite');
    }
    const existing = this.frames.find((frame) => frame.at === time);
    if (existing) existing.value = value;
    else this.frames.push({ at: time, value });
    this.frames.sort((a, b) => a.at - b.at);
    return this;
  }

  sample(at: Date): number {
    if (!this.frames.length) throw new TimelineError('EMPTY_TRACK', 'Keyframe track is empty');
    const time = at.getTime();
    if (!Number.isFinite(time)) throw new TimelineError('INVALID_SAMPLE', 'Invalid sample time');
    if (time <= this.frames[0]!.at) return this.frames[0]!.value;
    for (let i = 1; i < this.frames.length; i++) {
      const right = this.frames[i]!;
      if (time <= right.at) {
        const left = this.frames[i - 1]!;
        return left.value + (right.value - left.value) *
          (time - left.at) / (right.at - left.at);
      }
    }
    return this.frames[this.frames.length - 1]!.value;
  }

  generate(at: readonly Date[]): number[] {
    return at.map((time) => this.sample(time));
  }
}

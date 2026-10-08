import type { AsyncHandlerMap } from '../darkcore/browser.js';
import { EffectTree } from '../effect-tree/index.js';
import type { BerylxNode } from '../node.js';
import { BerylxError } from '../error.js';
import { Focus } from '../focus.js';
import { Err, Ok, type Result } from '../result.js';
import type { Root } from '../root.js';
import type { Perform } from '../perform.js';
import {
  ExecutablePlan,
  Timeline,
  TimelineError,
  type Clock,
  type Observation,
  type Predicate,
  type TaskRef,
} from '../timeline.js';

/** Effect tag used by an AsyncTask to await a predeclared human-login task. */
export const BERYLX_HUMAN_LOGIN = 'berylx_timeline_human_login';

/** Await a login completion without passing credentials through the workflow. */
export async function waitForHumanLogin(performer: Perform, task: TaskRef): Promise<void> {
  await performer.perform(BERYLX_HUMAN_LOGIN, task);
}

/**
 * Binds a Berylx Root and workflows to the one Timeline owned by that Root.
 * Workflows still execute exclusively through EffectTree.
 */
export class BerylxTimeline<S = any> {
  private static readonly roots = new WeakMap<Root<any>, BerylxTimeline<any>>();
  private activePlan: BerylxTimelinePlan<S> | undefined;

  private constructor(
    readonly root: Root<S>,
    readonly timeline: Timeline,
  ) {}

  static forRoot<T>(root: Root<T>, clock: Clock): BerylxTimeline<T> {
    const timeline = Timeline.forExecution(root, clock);
    const existing = BerylxTimeline.roots.get(root) as BerylxTimeline<T> | undefined;
    if (existing) return existing;
    const connection = new BerylxTimeline(root, timeline);
    BerylxTimeline.roots.set(root, connection);
    return connection;
  }

  /** Predeclare login work; it becomes waiting only when its effect is reached. */
  humanLogin(label: string): TaskRef {
    return this.timeline.humanLogin(label, () => false);
  }

  /** Register a Berylx workflow as Timeline-managed AI work. */
  workflow(label: string, node: BerylxNode<S>, when: Predicate = () => true): TaskRef {
    let task!: TaskRef;
    task = this.timeline.ai(label, async () => {
      if (!this.activePlan) {
        throw new TimelineError('PLAN_NOT_ISSUED', 'Issue the Berylx Timeline before starting it');
      }
      await this.activePlan.runWorkflow(task, node);
    }, when);
    return task;
  }

  /** Snapshot the plan without starting any Timeline or Berylx work. */
  issue(): BerylxTimelinePlan<S> {
    const plan = new BerylxTimelinePlan(this.root, this.timeline.issue());
    this.activePlan = plan;
    return plan;
  }
}

/** Executable Timeline plan with Berylx results retained by Timeline task. */
export class BerylxTimelinePlan<S = any> {
  private readonly results = new Map<TaskRef, Result<S>>();

  constructor(
    readonly root: Root<S>,
    readonly executable: ExecutablePlan,
  ) {}

  get observation(): Observation {
    return this.executable.observation;
  }

  result(task: TaskRef): Result<S> | undefined {
    return this.results.get(task);
  }

  start(): Promise<void> {
    return this.executable.start();
  }

  advance(): Promise<void> {
    return this.executable.advance();
  }

  emit(event: {
    readonly type: string;
    readonly task?: TaskRef;
    readonly details?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    return this.executable.emit(event);
  }

  /** @internal Execute via the existing async EffectTree and its wrapping path. */
  async runWorkflow(task: TaskRef, node: BerylxNode<S>): Promise<void> {
    const base = this.root.toLay();
    const effects: AsyncHandlerMap = {
      [BERYLX_HUMAN_LOGIN]: (payload) =>
        this.executable.waitForHumanLogin(this.loginTask(payload)),
    };
    const handlers = EffectTree.aroundAsync(effects, async (tag, payload, inner) => {
      if (tag !== EffectTree.TASK) return inner(payload);
      const name = this.taskName(payload);
      await this.emit({ type: 'berylx-task-started', task, details: { node: name } });
      try {
        const result = await inner(payload);
        await this.emit({
          type: result instanceof Err ? 'berylx-task-failed' : 'berylx-task-completed',
          task,
          details: { node: name },
        });
        return result;
      } catch (error) {
        await this.emit({ type: 'berylx-task-failed', task, details: { node: name } });
        throw error;
      }
    });

    const result = await EffectTree.runAsync(node, this.root.toLay(), handlers);
    if (result instanceof Err) {
      this.results.set(task, result as Err<S>);
      throw new BerylxTimelineFailure(result as Err<S>);
    }
    try {
      this.executable.assertCommitAllowed();
      const merged = mergeConcurrentState(
        this.root.toLay(),
        result.focus as Focus<S, []>,
        base,
      );
      this.root.commit(merged);
      this.results.set(task, new Ok(merged));
    } catch (error) {
      const failed = new Err(
        result.focus as Focus<S, []>,
        BerylxError.from(error, { failedNode: task.label, trace: [task.label] }),
      );
      this.results.set(task, failed);
      throw new BerylxTimelineFailure(failed);
    }
  }

  private loginTask(payload: unknown): TaskRef {
    if (!payload || typeof payload !== 'object' ||
        (payload as TaskRef).kind !== 'human-login' ||
        typeof (payload as TaskRef).label !== 'string') {
      throw new TimelineError(
        'INVALID_LOGIN_WAIT',
        'Human login effect requires a predeclared human-login task',
      );
    }
    return payload as TaskRef;
  }

  private taskName(payload: unknown): string {
    if (!Array.isArray(payload) || !payload[0] ||
        typeof (payload[0] as { name?: unknown }).name !== 'string') {
      throw new TypeError('berylx task observation requires a named task payload');
    }
    return (payload[0] as { name: string }).name;
  }
}

class BerylxTimelineFailure<S> extends Error {
  constructor(readonly result: Err<S>) {
    super(result.message);
    this.name = 'BerylxTimelineFailure';
  }
}

function mergeConcurrentState<S>(
  current: Focus<S, []>,
  completed: Focus<S, []>,
  base: Focus<S, []>,
): Focus<S, []> {
  const currentValue = current.toObject();
  const completedValue = completed.toObject();
  const baseValue = base.toObject();
  if (isPlainRecord(currentValue) && isPlainRecord(completedValue) &&
      isPlainRecord(baseValue)) {
    return Focus.of(mergePlainRecords(currentValue, completedValue, baseValue)) as Focus<S, []>;
  }
  if (stateEqual(currentValue, baseValue)) return completed;
  if (stateEqual(completedValue, baseValue) || stateEqual(currentValue, completedValue)) {
    return current;
  }
  throw BerylxError.create('merge_conflict', 'concurrent non-object state conflict', {
    metadata: { current: currentValue, completed: completedValue, base: baseValue },
  });
}

const MISSING: unique symbol = Symbol('berylx.timeline.merge.missing');
type MergeValue = unknown | typeof MISSING;

function mergePlainRecords(
  current: Record<string, unknown>,
  completed: Record<string, unknown>,
  base: Record<string, unknown>,
  path: string[] = [],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(completed)]);
  for (const key of keys) {
    const next = mergeObjectValue(
      Object.prototype.hasOwnProperty.call(current, key) ? current[key] : MISSING,
      Object.prototype.hasOwnProperty.call(completed, key) ? completed[key] : MISSING,
      Object.prototype.hasOwnProperty.call(base, key) ? base[key] : MISSING,
      [...path, key],
    );
    if (next !== MISSING) merged[key] = next;
  }
  return merged;
}

function mergeObjectValue(
  current: MergeValue,
  completed: MergeValue,
  base: MergeValue,
  path: string[],
): MergeValue {
  const currentChanged = !mergeValueEqual(current, base);
  const completedChanged = !mergeValueEqual(completed, base);
  if (!completedChanged) return current;
  if (!currentChanged) return completed;
  if (mergeValueEqual(current, completed)) return current;
  if (isPlainRecord(current) && isPlainRecord(completed) &&
      (isPlainRecord(base) || base === MISSING)) {
    return mergePlainRecords(current, completed, base === MISSING ? {} : base, path);
  }
  throw BerylxError.create('merge_conflict', `merge conflict at ${path.join('.')}`, {
    metadata: {
      path,
      current: showMergeValue(current),
      completed: showMergeValue(completed),
      base: showMergeValue(base),
    },
  });
}

function mergeValueEqual(left: MergeValue, right: MergeValue): boolean {
  if (left === MISSING || right === MISSING) return left === right;
  return stateEqual(left, right);
}

function showMergeValue(value: MergeValue): unknown {
  return value === MISSING ? { missing: true } : value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stateEqual(
  left: unknown,
  right: unknown,
  seen: WeakMap<object, WeakSet<object>> = new WeakMap(),
): boolean {
  if (Object.is(left, right)) return true;
  if (left == null || right == null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  let rights = seen.get(left);
  if (rights?.has(right)) return true;
  if (!rights) {
    rights = new WeakSet<object>();
    seen.set(left, rights);
  }
  rights.add(right);
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => stateEqual(value, right[index], seen));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key) &&
    stateEqual(left[key], right[key], seen));
}

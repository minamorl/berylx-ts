export const VERSION = '0.1.0';

// Core state and execution
export { BerylxError, type BerylxErrorContext } from './error.js';
export { Ok, Err, ResultOps, type Result, type Callable } from './result.js';
export { Focus, KeyError, type PathKey, type PathAt, type KeysAt } from './focus.js';
export { Root, type RootEvent } from './root.js';
export { Flow } from './flow.js';
export { State } from './state.js';
export { Merge, type Reducer } from './merge.js';
export { Perform } from './perform.js';
export { ControlSignal } from './control-signal.js';

// Workflow combinators
export { Task, type TaskBlock } from './task.js';
export { AsyncTask, type AsyncTaskBlock } from './async-task.js';
export { Sequence } from './sequence.js';
export { Parallel, type ParallelOnErr } from './parallel.js';
export { When, Else, Branch, type Predicate, type BranchArm } from './branch.js';
export {
  Rescue,
  Catch,
  RescueBlock,
  type RescueHandler,
  type RescueHandlerBlock,
  type CatchOptions,
} from './rescue.js';
export { Workflow } from './workflow.js';
export { berylx, type Berylx } from './scoped.js';
export { Graph } from './graph.js';

// Effect interpreter
export { EffectTree, type DryRun } from './effect-tree/index.js';
export * as Darkcore from './darkcore.js';

// Host and cray compatibility adapters
export { attachRoot, type AttachRootOptions } from './attach.js';
export {
  CraySuccess,
  CrayFailure,
  Cray,
  fromCrayResult,
  toCrayResult,
  type CrayResult,
} from './cray-compat.js';

// Node contracts
export type { BerylxNode, NamedNode } from './node.js';

// Convenience helpers
import { Focus as FocusClass } from './focus.js';
import { Flow as FlowClass } from './flow.js';
import { Task as TaskClass, type TaskBlock } from './task.js';
import type { BerylxNode } from './node.js';
import type { Result } from './result.js';

/** Alias for Focus. */
export const Lay = FocusClass;

/** Execute a workflow through Flow from the supplied state. */
export function run<S = any>(workflow: BerylxNode<S>, focus: unknown): Result<S> {
  return (FlowClass.of(focus) as FlowClass<S>).call(workflow);
}

export function task<S = any>(name: string, block: TaskBlock<S>): TaskClass<S> {
  return TaskClass.of<S>(name, block);
}

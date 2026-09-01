// ==================================================================
// berylx — Graphable TypeScript workflows over focused, recoverable state.
//
// Ruby 版 lib/berylx.rb のトップレベル API を TS へ移植したエントリ。
// 全モジュールを re-export し、Ruby の Berylx.run / Berylx.task /
// Berylx::Lay(=Focus) 相当のヘルパを提供する。
// ==================================================================

export const VERSION = '0.1.0';

// --- core layer ---------------------------------------------------
export { BerylxError, type BerylxErrorContext } from './error.js';
export { Ok, Err, ResultOps, type Result, type Callable } from './result.js';
export { Focus, KeyError, type PathKey, type PathAt, type KeysAt } from './focus.js';
export { Root, type RootEvent } from './root.js';
export { Flow } from './flow.js';
export { State } from './state.js';
export { Merge, type Reducer } from './merge.js';
export { Perform } from './perform.js';
export { ControlSignal } from './control-signal.js';

// --- combinators --------------------------------------------------
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

// --- substrate ----------------------------------------------------
export { EffectTree, type DryRun } from './effect-tree/index.js';
export * as Darkcore from './darkcore.js';

// --- phase 3: cray-root-lay 互換ブリッジ ---------------------------
export { attachRoot, type AttachRootOptions } from './attach.js';
export {
  CraySuccess,
  CrayFailure,
  Cray,
  fromCrayResult,
  toCrayResult,
  type CrayResult,
} from './cray-compat.js';

// --- node contract ------------------------------------------------
export type { BerylxNode, NamedNode } from './node.js';

// --- top-level helpers (Ruby module Berylx の関数群) ---------------
import { Focus as FocusClass } from './focus.js';
import { Flow as FlowClass } from './flow.js';
import { Task as TaskClass, type TaskBlock } from './task.js';
import type { BerylxNode } from './node.js';
import type { Result } from './result.js';

/** Ruby の `Berylx::Lay = Focus` に対応する別名。 */
export const Lay = FocusClass;

/** Ruby Berylx.run(workflow, focus) : Flow 経由で workflow を実行する。 */
export function run<S = any>(workflow: BerylxNode<S>, focus: unknown): Result<S> {
  return (FlowClass.of(focus) as FlowClass<S>).call(workflow);
}

/** Ruby Berylx.task(name) { ... } : Task の smart constructor。 */
export function task<S = any>(name: string, block: TaskBlock<S>): TaskClass<S> {
  return TaskClass.of<S>(name, block);
}

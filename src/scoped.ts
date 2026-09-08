import { Focus } from './focus.js';
import { Flow } from './flow.js';
import { Root } from './root.js';
import { State } from './state.js';
import { Task, type TaskBlock } from './task.js';
import { AsyncTask, type AsyncTaskBlock } from './async-task.js';
import { When } from './branch.js';
import { Catch, type CatchOptions, type RescueHandler, type RescueHandlerBlock } from './rescue.js';

/** Workflow factories bound to a single root state type S. */
export interface Berylx<S> {
  task(name: string, block: TaskBlock<S>): Task<S>;
  asyncTask(name: string, block: AsyncTaskBlock<S>): AsyncTask<S>;
  when(name: string, block: (focus: Focus<S, []>) => unknown): When<S>;
  catch(
    name?: string,
    handler?: RescueHandler<S> | null,
    options?: CatchOptions,
    block?: RescueHandlerBlock<S>,
  ): Catch<S>;
  focus(value: S): Focus<S, []>;
  /** Alias for focus. */
  lay(value: S): Focus<S, []>;
  flow(value: S | Focus<S, []>): Flow<S>;
  root(value: S): Root<S>;
  state(value: S): State<S>;
}

/**
 * Declare the workflow state type once and reuse it across factories.
 * The returned factories create the same instances as Task.of<S>, Flow.of<S>,
 * and the other class factories; execution and composition are unchanged.
 *
 * @example
 * const b = berylx<Order>();
 * const trimName = b.task(
 *   'trimName',
 *   (f) => f.at('user').at('name').update((name) => name.trim()),
 * );
 */
export function berylx<S>(): Berylx<S> {
  return {
    task: (name, block) => Task.of<S>(name, block),
    asyncTask: (name, block) => AsyncTask.of<S>(name, block),
    when: (name, block) => When.of<S>(name, block),
    catch: (name, handler, options, block) => Catch.of<S>(name, handler, options, block),
    focus: (value) => Focus.of<S>(value),
    lay: (value) => Focus.of<S>(value),
    flow: (value) => Flow.of(value as S) as Flow<S>,
    root: (value) => Root.of<S>(value),
    state: (value) => State.of<S>(value),
  };
}

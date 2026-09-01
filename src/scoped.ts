// ==================================================================
// berylx<S>() — 状態型 S を一度だけ宣言する scope 付き入口。
//
// 型引数を毎回書くのを避けるためだけの薄い層で、実行時の振る舞いは
// Task.of / Flow.of などをそのまま呼ぶのと同一。返すのは既存のクラスの
// インスタンスなので、合成子・graph・EffectTree のいずれにも影響しない。
//
//   const b = berylx<Order>();
//   const strip = b.task('strip', (f) => f.at('user').at('name').update((s) => s.trim()));
//                                        //  ^ f: Focus<Order>、キーと型が検査される
//
// S は workflow の境界ごとに 1 つ (spec の core.root.singleton) なので、
// 宣言も境界ごとに 1 回で足りる。
// ==================================================================

import { Focus } from './focus.js';
import { Flow } from './flow.js';
import { Root } from './root.js';
import { State } from './state.js';
import { Task, type TaskBlock } from './task.js';
import { AsyncTask, type AsyncTaskBlock } from './async-task.js';
import { When } from './branch.js';
import { Catch, type CatchOptions, type RescueHandler, type RescueHandlerBlock } from './rescue.js';

/** 状態型 S に束縛した berylx の入口。 */
export interface Berylx<S> {
  /** Task.of<S> と同じ。block は Focus<S> を受け取る。 */
  task(name: string, block: TaskBlock<S>): Task<S>;
  /** AsyncTask.of<S> と同じ。 */
  asyncTask(name: string, block: AsyncTaskBlock<S>): AsyncTask<S>;
  /** When.of<S> と同じ。述語は Focus<S> を受け取る。 */
  when(name: string, block: (focus: Focus<S, []>) => unknown): When<S>;
  /** Catch.of<S> と同じ。 */
  catch(
    name?: string,
    handler?: RescueHandler<S> | null,
    options?: CatchOptions,
    block?: RescueHandlerBlock<S>,
  ): Catch<S>;
  /** Focus.of<S> と同じ (別名 lay)。 */
  focus(value: S): Focus<S, []>;
  /** Focus.of<S> の Ruby 名。 */
  lay(value: S): Focus<S, []>;
  /** Flow.of<S> と同じ。 */
  flow(value: S | Focus<S, []>): Flow<S>;
  /** Root.of<S> と同じ。 */
  root(value: S): Root<S>;
  /** State.of<S> と同じ。 */
  state(value: S): State<S>;
}

/**
 * 状態型 S に束縛した入口を作る。
 *
 * 実行時は薄いラッパで、`Task.of<S>(...)` などを直接書くのと等価。
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

// ==================================================================
// Task — 名前つき状態遷移。berylx の葉ノード。
//
// Ruby 版 Berylx::Task の TS 移植。block は Focus を受け取り、Focus か
// 結果封筒 (Ok/Err) を返す。例外は捕捉して Err (failed_node/trace 付き)
// に変換する。演算子は then(>>) / par(&) / pipe(|=then) へ写す。
// ==================================================================

import { ResultOps, Err, type Result } from './result.js';
import { Focus } from './focus.js';
import type { BerylxNode, NamedNode } from './node.js';
import { Sequence } from './sequence.js';
import { Parallel } from './parallel.js';
import { Graph } from './graph.js';
import type { RescueHandlerBlock } from './rescue.js';

/** Task の本体。Focus を受け取り Focus か Result を返す。 */
export type TaskBlock = (focus: Focus) => Focus | Result | unknown;

export class Task implements BerylxNode, NamedNode {
  readonly name: string;
  private readonly block: TaskBlock;

  constructor(name: string, block: TaskBlock) {
    if (typeof block !== 'function') {
      throw new Error('Task requires a block');
    }
    this.name = String(name);
    this.block = block;
  }

  /** Ruby Task[name] { ... } / Task.build に対応。 */
  static of(name: string, block: TaskBlock): Task {
    return new Task(name, block);
  }

  call(focus: unknown): Result {
    const root = ResultOps.coerceFocus(focus);
    try {
      const result = ResultOps.normalize(this.block(root));
      return result instanceof Err ? this.withTaskContext(result) : result;
    } catch (e) {
      const err = e as Error;
      return ResultOps.err(root, (err && err.name) || 'Error', (err && err.message) || String(e), {
        cause: e,
        failedNode: this.name,
        trace: [this.name],
      });
    }
  }

  then(other: BerylxNode): BerylxNode {
    return new Sequence([this, other]);
  }

  par(other: BerylxNode): BerylxNode {
    return new Parallel([this, other]);
  }

  /** Ruby Task#| は self >> other。 */
  pipe(other: BerylxNode): BerylxNode {
    return this.then(other);
  }

  rescueWith(handler: BerylxNode | null, name?: string | null, block?: RescueHandlerBlock): BerylxNode {
    return Sequence.buildRescue(this, handler, name, block);
  }

  compile(): Graph {
    return Graph.from(this);
  }

  nodes(): NamedNode[] {
    return [this];
  }

  private withTaskContext(result: Err): Err {
    const error = result.error.failedNode ? result.error : result.error.prependTrace(this.name);
    return new Err(result.focus, error);
  }
}

// ==================================================================
// Workflow — 名前つき workflow のラッパ。
//
// Ruby 版 Berylx::Workflow の TS 移植。build 関数の戻り値を body として保持し、
// compile で名前つき Graph を作る。
// ==================================================================

import type { Result } from './result.js';
import type { BerylxNode, NamedNode } from './node.js';
import type { RescueHandlerBlock } from './rescue.js';
import { Flow } from './flow.js';
import { Sequence } from './sequence.js';
import { Graph } from './graph.js';

export class Workflow implements BerylxNode {
  readonly name: string;
  readonly body: BerylxNode;

  constructor(name: string, body: BerylxNode) {
    this.name = String(name);
    this.body = body;
  }

  /** Ruby Workflow[name] { body } に対応。build は body を返す関数。 */
  static of(name: string, build: () => BerylxNode): Workflow {
    return new Workflow(name, build());
  }

  call(focus: unknown): Result {
    return Flow.of(focus).call(this.body);
  }

  then(other: BerylxNode): BerylxNode {
    return this.body.then(other);
  }

  par(other: BerylxNode): BerylxNode {
    return this.body.par(other);
  }

  rescueWith(handler: BerylxNode | null, name?: string | null, block?: RescueHandlerBlock): BerylxNode {
    return Sequence.buildRescue(this.body, handler, name, block);
  }

  compile(): Graph {
    return Graph.from(this.body, this.name);
  }

  nodes(): NamedNode[] {
    return this.body.nodes();
  }
}

// ==================================================================
// Graph — workflow を検査可能なグラフ・DOT へコンパイルする。
//
// Ruby 版 Berylx::Graph の TS 移植。nodes / parallel_nodes / to_dot を提供する。
// DotBuilder は #build が [entryIds, exitIds] を返し、Sequence が exit を次の
// step の entry へ繋ぐ (Ruby と同一のノード id 採番・エッジ生成)。
// ==================================================================

import type { BerylxNode, NamedNode } from './node.js';
import { Sequence } from './sequence.js';
import { Parallel } from './parallel.js';
import { Branch, type BranchArm, type Predicate } from './branch.js';
import { Rescue } from './rescue.js';

export class Graph {
  readonly name: string | null;
  readonly root: BerylxNode;

  constructor(name: string | null, root: BerylxNode) {
    this.name = name;
    this.root = root;
  }

  static from(node: BerylxNode, name: string | null = null): Graph {
    return new Graph(name, node);
  }

  nodes(): string[] {
    return this.root.nodes().map((n: NamedNode) => n.name);
  }

  parallelNodes(): string[][] {
    return collectParallelNodes(this.root);
  }

  toDot(): string {
    const graphName = this.name ?? 'berylx';
    const builder = new DotBuilder();
    builder.build(this.root);
    const lines: string[] = [`digraph ${quote(graphName)} {`];
    for (const line of builder.lines) {
      lines.push(`  ${line}`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  /**
   * フェーズ 3-c: cray の toMermaid 相当。DOT と同じノード木・同じ辿り方から
   * Mermaid flowchart 文字列を生成する。ノード id は mermaid の識別子制約
   * (英数字) に合わせて連番 nN を振り、表示名はラベルに載せる。
   */
  toMermaid(): string {
    const builder = new MermaidBuilder();
    builder.build(this.root);
    const lines: string[] = ['flowchart TD'];
    for (const line of builder.lines) {
      lines.push(`  ${line}`);
    }
    return lines.join('\n');
  }
}

function quote(value: unknown): string {
  return `"${value}"`;
}

function collectParallelNodes(node: BerylxNode): string[][] {
  if (node instanceof Parallel) {
    return collectParallelBranch(node);
  }
  if (node instanceof Sequence) {
    return node.steps.flatMap((s) => collectParallelNodes(s));
  }
  if (node instanceof Branch) {
    return node.arms.flatMap((arm: BranchArm) => collectParallelNodes(arm.body));
  }
  if (node instanceof Rescue) {
    return [
      ...collectParallelNodes(node.body),
      ...collectParallelNodes(node.handler as unknown as BerylxNode),
    ];
  }
  return [];
}

function collectParallelBranch(node: Parallel): string[][] {
  return [
    node.nodes().map((n) => n.name),
    ...node.branches.flatMap((b) => collectParallelNodes(b)),
  ];
}

/**
 * コンパイル済みノード木を辿り DOT のノード宣言とエッジを吐く。Task 名は
 * 重複しうるので全ノードに index 付きの安定 id を振る。#build は
 * [entryIds, exitIds] を返し、Sequence が exit を次 step の entry に繋げる。
 */
class DotBuilder {
  readonly lines: string[] = [];
  private counter = 0;

  build(node: BerylxNode): [string[], string[]] {
    if (node instanceof Sequence) {
      return this.buildSequence(node);
    }
    if (node instanceof Parallel) {
      return this.buildParallel(node);
    }
    if (node instanceof Branch) {
      return this.buildBranch(node);
    }
    if (node instanceof Rescue) {
      return this.buildRescue(node);
    }
    return this.buildLeaf((node as unknown as NamedNode).name);
  }

  private buildLeaf(name: string): [string[], string[]] {
    const id = this.nextId(name);
    this.declare(id);
    return [[id], [id]];
  }

  private buildSequence(node: Sequence): [string[], string[]] {
    let entries: string[] | null = null;
    let exits: string[] | null = null;
    for (const step of node.steps) {
      const [stepEntries, stepExits] = this.build(step);
      if (entries === null) {
        entries = stepEntries;
      }
      if (exits) {
        this.connect(exits, stepEntries);
      }
      exits = stepExits;
    }
    return [entries ?? [], exits ?? []];
  }

  private buildParallel(node: Parallel): [string[], string[]] {
    const split = this.nextId('split');
    const join = this.nextId('join');
    this.declare(split);
    this.declare(join);
    for (const branch of node.branches) {
      const [branchEntries, branchExits] = this.build(branch);
      this.connect([split], branchEntries);
      this.connect(branchExits, [join]);
    }
    return [[split], [join]];
  }

  private buildBranch(node: Branch): [string[], string[]] {
    const decision = this.nextId('branch');
    this.declare(decision);
    const exits: string[] = [];
    for (const arm of node.arms) {
      const [armEntries, armExits] = this.build(arm.body);
      this.connect([decision], armEntries, armLabel(arm.predicate));
      exits.push(...armExits);
    }
    return [[decision], exits];
  }

  private buildRescue(node: Rescue): [string[], string[]] {
    const [bodyEntries, bodyExits] = this.build(node.body);
    const [handlerEntries, handlerExits] = this.build(node.handler as unknown as BerylxNode);
    this.connect(bodyExits, handlerEntries);
    return [bodyEntries, [...bodyExits, ...handlerExits]];
  }

  private connect(fromIds: string[], toIds: string[], label: string | null = null): void {
    for (const from of fromIds) {
      for (const to of toIds) {
        this.lines.push(this.edge(from, to, label));
      }
    }
  }

  private edge(from: string, to: string, label: string | null): string {
    const attributes = label ? ` [label=${quote(label)}]` : '';
    return `${quote(from)} -> ${quote(to)}${attributes};`;
  }

  private declare(id: string): void {
    this.lines.push(`${quote(id)};`);
  }

  private nextId(name: string): string {
    const id = `${name}#${this.counter}`;
    this.counter += 1;
    return id;
  }
}

function armLabel(predicate: Predicate): string {
  return predicate.elseBranch ? 'else' : predicate.name;
}

/**
 * DotBuilder と同じ木の辿り方で Mermaid flowchart を吐く。DOT の `#` 付き id は
 * mermaid では識別子に使えないので、宣言のたびに連番 id (n0, n1, ...) を振り、
 * 元の名前はラベル `id["name"]` に載せる。#build は [entryIds, exitIds] を返し、
 * Sequence が exit を次 step の entry へ繋げる (DotBuilder と同一構造)。
 */
class MermaidBuilder {
  readonly lines: string[] = [];
  private counter = 0;

  build(node: BerylxNode): [string[], string[]] {
    if (node instanceof Sequence) {
      return this.buildSequence(node);
    }
    if (node instanceof Parallel) {
      return this.buildParallel(node);
    }
    if (node instanceof Branch) {
      return this.buildBranch(node);
    }
    if (node instanceof Rescue) {
      return this.buildRescue(node);
    }
    return this.buildLeaf((node as unknown as NamedNode).name);
  }

  private buildLeaf(name: string): [string[], string[]] {
    const id = this.node(name);
    return [[id], [id]];
  }

  private buildSequence(node: Sequence): [string[], string[]] {
    let entries: string[] | null = null;
    let exits: string[] | null = null;
    for (const step of node.steps) {
      const [stepEntries, stepExits] = this.build(step);
      if (entries === null) {
        entries = stepEntries;
      }
      if (exits) {
        this.connect(exits, stepEntries);
      }
      exits = stepExits;
    }
    return [entries ?? [], exits ?? []];
  }

  private buildParallel(node: Parallel): [string[], string[]] {
    const split = this.node('split');
    const join = this.node('join');
    for (const branch of node.branches) {
      const [branchEntries, branchExits] = this.build(branch);
      this.connect([split], branchEntries);
      this.connect(branchExits, [join]);
    }
    return [[split], [join]];
  }

  private buildBranch(node: Branch): [string[], string[]] {
    const decision = this.node('branch');
    const exits: string[] = [];
    for (const arm of node.arms) {
      const [armEntries, armExits] = this.build(arm.body);
      this.connect([decision], armEntries, armLabel(arm.predicate));
      exits.push(...armExits);
    }
    return [[decision], exits];
  }

  private buildRescue(node: Rescue): [string[], string[]] {
    const [bodyEntries, bodyExits] = this.build(node.body);
    const [handlerEntries, handlerExits] = this.build(node.handler as unknown as BerylxNode);
    this.connect(bodyExits, handlerEntries);
    return [bodyEntries, [...bodyExits, ...handlerExits]];
  }

  private connect(fromIds: string[], toIds: string[], label: string | null = null): void {
    for (const from of fromIds) {
      for (const to of toIds) {
        this.lines.push(this.edge(from, to, label));
      }
    }
  }

  private edge(from: string, to: string, label: string | null): string {
    return label ? `${from} -->|${escapeMermaid(label)}| ${to}` : `${from} --> ${to}`;
  }

  /** ノードを宣言し (`id["name"]`)、その id を返す。 */
  private node(name: string): string {
    const id = `n${this.counter}`;
    this.counter += 1;
    this.lines.push(`${id}["${escapeMermaid(name)}"]`);
    return id;
  }
}

function escapeMermaid(value: string): string {
  return String(value).replace(/"/g, '&quot;');
}

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
   * Render the same workflow structure as toDot, using Mermaid flowchart syntax.
   * Sequential alphanumeric IDs keep task names separate from node identifiers.
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
 * Emit DOT nodes and edges with indexed IDs because task names may repeat.
 * build returns [entryIds, exitIds], allowing sequences to connect each step
 * to the entry points of the next step.
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
 * Follow DotBuilder's traversal and entry/exit contract. Use n0, n1, ... IDs
 * because DOT IDs containing # are not valid Mermaid identifiers, and retain
 * task names in node labels.
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

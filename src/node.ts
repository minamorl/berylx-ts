import type { Result } from './result.js';
import type { RescueHandlerBlock } from './rescue.js';

/** A named leaf, such as Task or RescueBlock, used in graphs and traces. */
export interface NamedNode {
  readonly name: string;
}

/**
 * Shared contract for workflow nodes. Every node in a workflow uses the same
 * root state type S (core.root.singleton), so composition preserves S without
 * recursively rebuilding state types. The default any supports untyped usage.
 */
export interface BerylxNode<S = any> {
  /** Execute from a focus and return an Ok or Err result. */
  call(focus: unknown): Result<S>;
  /** Return flattened leaf nodes for graphs and traces. */
  nodes(): NamedNode[];
  /** Compose nodes in sequence. */
  then(other: BerylxNode<S>): BerylxNode<S>;
  /** Compose branches that start from the same state snapshot. */
  par(other: BerylxNode<S>): BerylxNode<S>;
  /** Attach a recovery handler to this node. */
  rescueWith(
    handler: BerylxNode<S> | null,
    name?: string | null,
    block?: RescueHandlerBlock<S>,
  ): BerylxNode<S>;
}

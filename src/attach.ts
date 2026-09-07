import type { Root, RootEvent } from './root.js';

export interface AttachRootOptions<S = unknown> {
  /** Project committed state for the host. Defaults to the identity function. */
  select?: (state: unknown) => S;
  /** Receive the initial snapshot immediately after subscribing. */
  onSnapshot?: (state: S, event: RootEvent) => void;
  /** Receive each committed state. */
  onCommit?: (state: S, event: RootEvent) => void;
  /** Suppress the initial snapshot for listener and onSnapshot. Defaults to false. */
  skipSnapshot?: boolean;
}

/**
 * Connect a Root to a host. The listener receives projected state on the initial
 * snapshot and each commit, unless skipSnapshot suppresses the snapshot.
 * Call the returned function to unsubscribe.
 */
export function attachRoot<S = unknown>(
  root: Root,
  listener: (state: S, event: RootEvent) => void,
  options: AttachRootOptions<S> = {},
): () => void {
  const select = options.select ?? ((state: unknown) => state as S);
  return root.subscribe((event) => {
    const state = select(event.value);
    if (event.type === 'snapshot') {
      if (options.skipSnapshot) {
        return;
      }
      options.onSnapshot?.(state, event);
    } else {
      options.onCommit?.(state, event);
    }
    listener(state, event);
  });
}

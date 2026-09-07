import type { Effect } from './effect.js';

/** Handlers indexed by effect tag; results may be values or promises. */
export type AsyncHandlerMap = Record<string, (payload: unknown) => unknown | Promise<unknown>>;

/**
 * Interpret effects with an iterative trampoline, awaiting each handler result
 * before passing it to the continuation.
 */
export async function foldAsync<A, R>(
  prog: Effect<A>,
  onReturn: (x: A) => R | Promise<R>,
  handlers: AsyncHandlerMap,
): Promise<R> {
  let cur = prog;
  for (;;) {
    const step = cur.step();
    if (step.closed) {
      return await onReturn(step.value);
    }
    const h = handlers[step.tag];
    if (!h) {
      throw new Error(`no handler for effect: ${step.tag}`);
    }
    cur = step.resume(await h(step.payload));
  }
}

/** Interpret effects asynchronously and return the terminal value. */
export async function runAsync<A>(prog: Effect<A>, handlers: AsyncHandlerMap): Promise<A> {
  return foldAsync(prog, (x) => x, handlers);
}

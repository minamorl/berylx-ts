import { PURE, type HandlerMap } from './darkcore.js';

/** Dispatch effects from tasks and recovery callbacks to the current handler map. */
export class Perform {
  private readonly handlers: HandlerMap;

  constructor(handlers: HandlerMap) {
    this.handlers = handlers;
  }

  perform(tag: string, payload: unknown = null): unknown {
    if (tag === PURE) {
      throw new Error(':pure is reserved (closed effect)');
    }

    const handler = this.handlers[tag];
    if (!handler) {
      throw new Error(`no handler for effect: ${tag}`);
    }
    return handler(payload);
  }
}

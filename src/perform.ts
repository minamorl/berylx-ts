import { PURE, type HandlerMap } from './darkcore.js';

/** Task と recovery block から、現在の handler map へ作用を発行する入口。 */
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

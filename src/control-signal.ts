/**
 * Base class for control signals that escape the interpreter without becoming Err.
 * Downstream runtimes can extend it to define their own signals.
 */
export class ControlSignal extends Error {
  constructor(message = '') {
    super(message);
    this.name = new.target.name;
  }
}

// Focus and Result reference each other only at method-call time, so their
// circular ESM imports do not access uninitialized bindings.

import { BerylxError, type BerylxErrorContext } from './error.js';
import { Focus } from './focus.js';

export interface Callable {
  call(focus: unknown): Result;
}

/**
 * Both outcomes retain a focus with the same root state type S. Err preserves
 * the partial state reached before failure instead of discarding it.
 */
export type Result<S = any> = Ok<S> | Err<S>;

/** A successful result carrying the current focus. */
export class Ok<S = any> {
  readonly focus: Focus<S, []>;

  constructor(focus: Focus<S, []>) {
    this.focus = focus;
  }

  /** Pass this focus to the next node. */
  pipe(node: Callable): Result<S> {
    return ResultOps.bind(this, (current) => node.call(current));
  }

  isOk(): this is Ok<S> {
    return true;
  }

  isErr(): this is Err<S> {
    return false;
  }
}

/** A failed result carrying partial state and a structured error. */
export class Err<S = any> {
  readonly focus: Focus<S, []>;
  readonly error: BerylxError;

  constructor(focus: Focus<S, []>, error: BerylxError) {
    this.focus = focus;
    this.error = error;
  }

  /** Throw the underlying cause, or the structured error when no cause exists. */
  unwrap(): never {
    throw this.error.unwrap();
  }

  toException(): unknown {
    return this.error.toException();
  }

  get code(): string {
    return this.error.code;
  }

  get message(): string {
    return this.error.message;
  }

  get cause(): unknown {
    return this.error.cause;
  }

  get failedNode(): string | null {
    return this.error.failedNode;
  }

  get trace(): readonly string[] {
    return this.error.trace;
  }

  get parallelErrors(): readonly BerylxError[] {
    return this.error.parallelErrors;
  }

  /** Short-circuit: retain this failure without executing the next node. */
  pipe(_node: Callable): Result {
    return this;
  }

  isOk(): this is Ok {
    return false;
  }

  isErr(): this is Err {
    return true;
  }
}

export const ResultOps = {
  ok<S = any>(value: unknown): Ok<S> {
    return new Ok(ResultOps.coerceFocus(value));
  },

  err<S = any>(
    value: unknown,
    codeOrError: string | BerylxError,
    message?: string,
    context: BerylxErrorContext = {},
  ): Err<S> {
    const error =
      codeOrError instanceof BerylxError
        ? codeOrError.withContext(context)
        : BerylxError.create(codeOrError, message ?? String(codeOrError), context);
    return new Err(ResultOps.coerceFocus(value), error);
  },

  /** Preserve existing Ok/Err results; wrap other values in Ok. */
  normalize<S = any>(value: unknown): Result<S> {
    if (value instanceof Ok || value instanceof Err) {
      return value;
    }
    return ResultOps.ok(value);
  },

  /** Preserve an existing Focus or wrap a raw state value in one. */
  coerceFocus<S = any>(value: unknown): Focus<S, []> {
    if (value instanceof Focus) {
      return value as Focus<S, []>;
    }
    return Focus.of(value) as Focus<S, []>;
  },

  map<S = any>(result: Result<S>, block: (focus: Focus<S, []>) => unknown): Result<S> {
    if (result instanceof Ok) {
      return ResultOps.normalize(block(result.focus));
    }
    return result;
  },

  bind<S = any>(result: Result<S>, block: (focus: Focus<S, []>) => unknown): Result<S> {
    if (result instanceof Ok) {
      return ResultOps.normalize(block(result.focus));
    }
    return result;
  },
};

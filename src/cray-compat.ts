// Adapters accept cray-like results structurally, without a cray dependency.
// Error conversion preserves BerylxError values, wraps Error instances with their
// name and cause, uses strings as error codes, and assigns cray_failure otherwise.
// Wrapped values remain available in metadata.crayError.

import { Ok, Err, ResultOps, type Result } from './result.js';
import { Focus } from './focus.js';
import { BerylxError } from './error.js';

/** A cray-compatible success result carrying a value. */
export class CraySuccess<T = unknown> {
  readonly value: T;

  constructor(value: T) {
    this.value = value;
  }

  isSuccess(): this is CraySuccess<T> {
    return true;
  }

  isFailure(): boolean {
    return false;
  }
}

/** A cray-compatible failure result carrying an error of any type. */
export class CrayFailure<E = unknown> {
  readonly error: E;

  constructor(error: E) {
    this.error = error;
  }

  isSuccess(): boolean {
    return false;
  }

  isFailure(): this is CrayFailure<E> {
    return true;
  }
}

export type CrayResult<T = unknown, E = unknown> = CraySuccess<T> | CrayFailure<E>;

export const Cray = {
  success: <T>(value: T): CraySuccess<T> => new CraySuccess(value),
  failure: <E>(error: E): CrayFailure<E> => new CrayFailure(error),
};

/** Recognize success using the structure of a cray-like result. */
function craySucceeded(result: unknown): boolean {
  if (result instanceof CraySuccess) {
    return true;
  }
  if (result instanceof CrayFailure) {
    return false;
  }
  const r = result as Record<string, unknown> | null;
  if (r == null) {
    return false;
  }
  if (typeof r.isSuccess === 'function') {
    return Boolean((r.isSuccess as () => unknown)());
  }
  if (typeof r.isFailure === 'function') {
    return !(r.isFailure as () => unknown)();
  }
  if ('success' in r) {
    return Boolean(r.success);
  }
  if ('ok' in r) {
    return Boolean(r.ok);
  }
  if ('tag' in r) {
    return r.tag === 'success' || r.tag === 'ok' || r.tag === 'right';
  }
  return 'value' in r && !('error' in r);
}

/** Convert an arbitrary cray error into an Err carrying a BerylxError. */
function foldCrayError(error: unknown, focus?: unknown): Err {
  const f = ResultOps.coerceFocus(focus ?? {});
  if (error instanceof BerylxError) {
    return new Err(f, error);
  }
  if (error instanceof Error) {
    return ResultOps.err(f, error.name || 'Error', error.message, {
      cause: error,
      metadata: { crayError: error },
    }) as Err;
  }
  if (typeof error === 'string') {
    return ResultOps.err(f, error, error, { metadata: { crayError: error } }) as Err;
  }
  return ResultOps.err(f, 'cray_failure', 'cray failure', { metadata: { crayError: error } }) as Err;
}

/**
 * Convert cray Success/Failure to berylx Ok/Err. Success values become Focus
 * instances; failures become structured BerylxError values. The optional focus
 * supplies partial state on failure and a fallback for an undefined success value.
 */
export function fromCrayResult(result: unknown, focus?: unknown): Result {
  if (craySucceeded(result)) {
    const value = (result as { value?: unknown }).value;
    if (value instanceof Focus) {
      return new Ok(value);
    }
    return ResultOps.ok(value !== undefined ? value : focus);
  }
  const error = (result as { error?: unknown }).error;
  return foldCrayError(error, focus);
}

/**
 * Convert berylx Ok/Err to cray Success/Failure. Success carries the root state;
 * failure carries the BerylxError, preserving its code, message, and metadata.
 */
export function toCrayResult(result: Result): CrayResult {
  if (result instanceof Ok) {
    return new CraySuccess(result.focus.toObject());
  }
  return new CrayFailure(result.error);
}

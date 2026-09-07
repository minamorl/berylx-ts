import { ResultOps, type Result } from './result.js';

/** Distinguish an omitted default from an explicitly supplied value. */
const MISSING: unique symbol = Symbol('berylx.focus.missing');

export type PathKey = string | number | symbol;

/**
 * The type reached by following path P through state S. Encoding the current
 * path in the type determines the return type of get. Recursion is bounded by
 * the path length; the default S = any keeps untyped usage available.
 */
export type PathAt<S, P extends readonly PathKey[]> =
  P extends readonly [infer H, ...infer R]
    ? R extends readonly PathKey[]
      ? H extends keyof S
        ? PathAt<S[H], R>
        : never
      : never
    : S;

/**
 * Keys accessible at path P. Scalars resolve to never to prevent prototype
 * methods such as number.toFixed from appearing as navigable state keys.
 */
export type KeysAt<S, P extends readonly PathKey[]> =
  PathAt<S, P> extends object ? keyof PathAt<S, P> & PathKey : never;

/** Support immutable updates on values that expose with(patch). */
interface WithUpdatable {
  with(patch: Record<PathKey, unknown>): unknown;
}

function hasWith(value: unknown): value is WithUpdatable {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { with?: unknown }).with === 'function'
  );
}

function isPlainRecord(value: unknown): value is Record<PathKey, unknown> {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isDeepFreezeTarget(value: unknown): value is unknown[] | Record<PathKey, unknown> {
  return Array.isArray(value) || isPlainRecord(value);
}

function enumerableOwnKeys(value: object): PathKey[] {
  return Reflect.ownKeys(value).filter((key) => Object.prototype.propertyIsEnumerable.call(value, key));
}

/** Defensively copy and deeply freeze arrays and plain records, preserving cycles. */
function copyAndDeepFreeze(value: unknown): unknown {
  const deeplyFrozen = new WeakMap<object, boolean>();
  const activeCopies = new WeakMap<object, unknown[] | Record<PathKey, unknown>>();

  const isAlreadyDeeplyFrozen = (current: unknown, visiting: WeakSet<object>): boolean => {
    if (!isDeepFreezeTarget(current)) {
      return true;
    }

    const cached = deeplyFrozen.get(current);
    if (cached !== undefined) {
      return cached;
    }
    // Ruby has no cycle handling; conservatively copying a cycle keeps TS finite and defensive.
    if (visiting.has(current)) {
      return false;
    }

    visiting.add(current);
    let result = Object.isFrozen(current);
    if (result) {
      if (Array.isArray(current)) {
        for (let index = 0; index < current.length && result; index += 1) {
          if (Object.prototype.hasOwnProperty.call(current, index)) {
            result = isAlreadyDeeplyFrozen(current[index], visiting);
          }
        }
      } else {
        for (const key of enumerableOwnKeys(current)) {
          if (!isAlreadyDeeplyFrozen(current[key], visiting)) {
            result = false;
            break;
          }
        }
      }
    }
    visiting.delete(current);
    deeplyFrozen.set(current, result);
    return result;
  };

  const copy = (current: unknown): unknown => {
    // Map, Set, Date, typed arrays, and class instances retain their identity.
    if (!isDeepFreezeTarget(current)) {
      return current;
    }
    if (isAlreadyDeeplyFrozen(current, new WeakSet())) {
      return current;
    }

    const existing = activeCopies.get(current);
    if (existing !== undefined) {
      return existing;
    }

    if (Array.isArray(current)) {
      const rebuilt: unknown[] = new Array(current.length);
      activeCopies.set(current, rebuilt);
      for (let index = 0; index < current.length; index += 1) {
        if (Object.prototype.hasOwnProperty.call(current, index)) {
          rebuilt[index] = copy(current[index]);
        }
      }
      const frozen = Object.freeze(rebuilt);
      activeCopies.delete(current);
      return frozen;
    }

    // Normalize prototypes and property descriptors into an ordinary record.
    const rebuilt: Record<PathKey, unknown> = {};
    activeCopies.set(current, rebuilt);
    for (const key of enumerableOwnKeys(current)) {
      Object.defineProperty(rebuilt, key, {
        configurable: true,
        enumerable: true,
        value: copy(current[key]),
        writable: true,
      });
    }
    const frozen = Object.freeze(rebuilt);
    activeCopies.delete(current);
    return frozen;
  };

  return copy(value);
}

/**
 * Immutable state with a current path P into root state S. Supplying S checks
 * at keys and determines the type returned by get; S = any allows untyped use.
 *
 * One state type is fixed per workflow boundary (core.root.singleton). Updates
 * preserve S, so task composition does not need to reconcile changing root types
 * or recursively rebuild object types after each set.
 */
export class Focus<S = any, P extends readonly PathKey[] = []> {
  readonly value: S;
  readonly path: P;

  constructor(value: unknown = {}, path: readonly PathKey[] = []) {
    this.value = copyAndDeepFreeze(value) as S;
    this.path = Object.freeze([...path]) as unknown as P;
  }

  static of<T>(value: T): Focus<T, []>;
  static of(): Focus<any, []>;
  static of(value: unknown = {}): Focus<any, []> {
    return new Focus(value);
  }

  /** Return a focus one level deeper without reading the value yet. */
  at<K extends KeysAt<S, P>>(key: K): Focus<S, [...P, K]> {
    return new Focus(this.value, [...this.path, key as PathKey]) as Focus<S, [...P, K]>;
  }

  /**
   * Read the value at the current path. If traversal fails, return the supplied
   * default or rethrow the traversal error when no default was provided.
   */
  get(): PathAt<S, P>;
  get<D>(options: { default: D }): PathAt<S, P> | D;
  get(options?: { default?: unknown }): unknown;
  get(options: { default?: unknown } = {}): unknown {
    const hasDefault = 'default' in options;
    try {
      return dig(this.value, this.path);
    } catch (e) {
      if (hasDefault) {
        return options.default;
      }
      throw e;
    }
  }

  /** Like get, with the default value supplied as a positional argument. */
  fetch(): PathAt<S, P>;
  fetch<D>(defaultValue: D): PathAt<S, P> | D;
  fetch(defaultValue: unknown = MISSING): unknown {
    if (defaultValue === MISSING) {
      return this.get();
    }
    return this.get({ default: defaultValue });
  }

  /** Return null when the current path cannot be read. */
  maybe(): PathAt<S, P> | null {
    return this.get({ default: null });
  }

  /** Whether the current path can be read. */
  present(): boolean {
    try {
      dig(this.value, this.path);
      return true;
    } catch {
      return false;
    }
  }

  /** Return Ok(this) if the path is readable, or Err with this focus otherwise. */
  required(code = 'missing_focus', message?: string): Result<S> {
    try {
      this.get();
      return ResultOps.ok(this);
    } catch (e) {
      return this.reject(
        code,
        message ?? `missing focus at ${JSON.stringify(this.path.map(String))}`,
        { cause: e },
      );
    }
  }

  /** Replace the value at the current path and return a new focus at the root. */
  set(nextValue: PathAt<S, P>): Focus<S, []> {
    return new Focus(assocIn(this.value, this.path, nextValue));
  }

  /** Transform the current value and return the updated focus at the root. */
  update(block: (current: PathAt<S, P>) => PathAt<S, P>): Focus<S, []> {
    return this.set(block(this.get()));
  }

  /** Set a child value and return the updated focus at the root. */
  put<K extends KeysAt<S, P>>(key: K, nextValue: PathAt<S, [...P, K]>): Focus<S, []> {
    return this.at(key).set(nextValue);
  }

  /** Create an Err that retains this focus as its partial state. */
  reject(
    code: string,
    message: string = code,
    options: { cause?: unknown } = {},
  ): Result<S> {
    return ResultOps.err(this, code, message, { cause: options.cause });
  }

  /** Return the root value, with arrays and plain records deeply frozen. */
  toObject(): S {
    return this.value;
  }

  toString(): string {
    let shown: unknown;
    try {
      shown = this.get();
    } catch {
      shown = undefined;
    }
    return `#<Berylx::Focus path=${JSON.stringify(this.path.map(String))} value=${JSON.stringify(shown)}>`;
  }
}

/** Follow a path, throwing KeyError when a key cannot be traversed. */
function dig(current: unknown, path: readonly PathKey[]): unknown {
  return path.reduce<unknown>((acc, key) => {
    if (isPlainRecord(acc) || (acc != null && typeof acc === 'object' && !Array.isArray(acc))) {
      const rec = acc as Record<PathKey, unknown>;
      if (!(key in rec)) {
        throw new KeyError(key);
      }
      return rec[key];
    }
    if (Array.isArray(acc)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx >= acc.length) {
        throw new KeyError(key);
      }
      return acc[idx];
    }
    throw new KeyError(key);
  }, current);
}

/** Replace a value along a path without mutating existing containers. */
function assocIn(current: unknown, path: readonly PathKey[], nextValue: unknown): unknown {
  if (path.length === 0) {
    return nextValue;
  }
  const [key, ...rest] = path;

  if (isPlainRecord(current) || current == null) {
    const base: Record<PathKey, unknown> = isPlainRecord(current) ? current : {};
    const child = base[key as PathKey];
    return { ...base, [key]: assocIn(child, rest, nextValue) };
  }

  if (Array.isArray(current)) {
    const idx = Number(key);
    const copy = [...current];
    copy[idx] = assocIn(copy[idx], rest, nextValue);
    return copy;
  }

  if (hasWith(current)) {
    const child = (current as unknown as Record<PathKey, unknown>)[key as PathKey];
    return current.with({ [key]: assocIn(child, rest, nextValue) });
  }

  throw new TypeError(`cannot update ${typeof current} at ${String(key)}`);
}

/** Raised when a focus path cannot be traversed. */
export class KeyError extends Error {
  constructor(key: PathKey) {
    super(`key not found: ${String(key)}`);
    this.name = 'KeyError';
  }
}

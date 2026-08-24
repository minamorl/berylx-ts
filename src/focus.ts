// ==================================================================
// Focus (別名 Lay) — 焦点つき不変状態。
//
// Ruby 版 Berylx::Focus の TS 移植。ネストした値をパスで読み書きし、
// 更新は共有変更なしの immutable な置換で行う。Ruby の Hash に対応する
// のは plain object。Ruby の struct (#with を持つ値) 相当として、
// with(patch) メソッドを持つオブジェクトも更新対象に含める。
// ==================================================================

import { ResultOps, type Result } from './result.js';

/** get のデフォルト値が「未指定」であることを表す番兵。 */
const MISSING: unique symbol = Symbol('berylx.focus.missing');

type PathKey = string | number | symbol;

/** #with(patch) を持つ値 (Ruby の struct/Data 相当) の判定用。 */
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

/** Ruby Freeze.deep と同じ対象を defensive copy し、循環を保ったまま深く凍結する。 */
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
    // JS 固有の Map/Set/Date/TypedArray/class instances は Ruby のその他の object と同様に触れない。
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

    // Ruby deep_hash と同様、prototype や property descriptor は素の record へ正規化する。
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

export class Focus {
  readonly value: unknown;
  readonly path: readonly PathKey[];

  constructor(value: unknown = {}, path: readonly PathKey[] = []) {
    this.value = copyAndDeepFreeze(value);
    this.path = Object.freeze([...path]);
  }

  /** Ruby Focus[value] / Focus.new に対応する smart constructor。 */
  static of(value: unknown = {}): Focus {
    return new Focus(value);
  }

  /** パスを 1 段掘る (Ruby Focus#[])。 */
  at(key: PathKey): Focus {
    return new Focus(this.value, [...this.path, key]);
  }

  /**
   * 現在のパスの値を取り出す。パスが辿れない場合、default が渡されていれば
   * それを返し、無ければ例外を投げる (Ruby Focus#get)。
   */
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

  /** get のエイリアス。default を位置引数で受ける (Ruby Focus#fetch)。 */
  fetch(defaultValue: unknown = MISSING): unknown {
    if (defaultValue === MISSING) {
      return this.get();
    }
    return this.get({ default: defaultValue });
  }

  /** 値が無ければ null を返す (Ruby Focus#maybe)。 */
  maybe(): unknown {
    return this.get({ default: null });
  }

  /** パスが辿れるか (Ruby Focus#present?)。 */
  present(): boolean {
    try {
      dig(this.value, this.path);
      return true;
    } catch {
      return false;
    }
  }

  /** パスが辿れれば Ok(self)、辿れなければ Err (Ruby Focus#required)。 */
  required(code = 'missing_focus', message?: string): Result {
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

  /** 現在のパスへ値をセットした新しい Focus をルートで返す (Ruby Focus#set)。 */
  set(nextValue: unknown): Focus {
    return new Focus(assocIn(this.value, this.path, nextValue));
  }

  /** 現在値をブロックで変換してセットする (Ruby Focus#update)。 */
  update(block: (current: unknown) => unknown): Focus {
    return this.set(block(this.get()));
  }

  /** 子キーへ値をセットする (Ruby Focus#put)。 */
  put(key: PathKey, nextValue: unknown): Focus {
    return this.at(key).set(nextValue);
  }

  /** この Focus を部分状態に持つ Err を作る (Ruby Focus#reject)。 */
  reject(
    code: string,
    message: string = code,
    options: { cause?: unknown } = {},
  ): Result {
    return ResultOps.err(this, code, message, { cause: options.cause });
  }

  /** Ruby Focus#to_h と同様、deep-frozen なルート値を返す。 */
  toObject(): unknown {
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

/** パスに沿って値を掘る。辿れないキーは例外を投げる (Ruby #dig)。 */
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

/** パスに沿って値を immutable にセットする (Ruby #assoc_in)。 */
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

/** Ruby の KeyError 相当 (dig で辿れなかったときに投げる)。 */
export class KeyError extends Error {
  constructor(key: PathKey) {
    super(`key not found: ${String(key)}`);
    this.name = 'KeyError';
  }
}

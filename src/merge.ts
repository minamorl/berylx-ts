// ==================================================================
// Merge — parallel の reducer 群。
//
// Ruby 版 Berylx::Merge の TS 移植。Focus 同士を畳む reducer を提供する。
//   keepLeft / keepRight : 単純な左右採用。
//   deep                 : 再帰的な deep merge (右優先)。
//   strict               : base からの変更を突き合わせ、双方が別々に変えた
//                          ら merge_conflict で衝突。
//
// reducer は (left, right) または (left, right, base) を受け取り Focus を返す。
// arity は関数の length で判別する (Ruby の reducer.arity 相当)。
// ==================================================================

import { BerylxError } from './error.js';
import { Focus } from './focus.js';

const MISSING: unique symbol = Symbol('berylx.merge.missing');
type Maybe<T> = T | typeof MISSING;

type PlainObject = Record<string, unknown>;

export type Reducer<S = any> =
  | ((left: Focus<S, []>, right: Focus<S, []>) => Focus<S, []>)
  | ((left: Focus<S, []>, right: Focus<S, []>, base: Focus<S, []>) => Focus<S, []>);

function asObject(value: unknown): PlainObject {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as PlainObject;
  }
  return {};
}

function isObject(value: unknown): value is PlainObject {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export const Merge = {
  keepLeft<S = any>(): Reducer<S> {
    return (left: Focus<S, []>, _right: Focus<S, []>) => left;
  },

  keepRight<S = any>(): Reducer<S> {
    return (_left: Focus<S, []>, right: Focus<S, []>) => right;
  },

  deep<S = any>(): Reducer<S> {
    return (left: Focus<S, []>, right: Focus<S, []>) =>
      Focus.of(deepMerge(asObject(left.toObject()), asObject(right.toObject()))) as Focus<S, []>;
  },

  strict<S = any>(): Reducer<S> {
    const reducer = (left: Focus<S, []>, right: Focus<S, []>, base: Focus<S, []>) =>
      Focus.of(
        strictMerge(asObject(left.toObject()), asObject(right.toObject()), asObject(base.toObject())),
      ) as Focus<S, []>;
    // arity 3 を length で判別できるよう関数を返す (Ruby の reducer.arity == 3 相当)。
    return reducer as Reducer<S>;
  },

  deepMerge,
  strictMerge,
};

function deepMerge(left: PlainObject, right: PlainObject): PlainObject {
  const merged: PlainObject = { ...left };
  for (const key of Object.keys(right)) {
    const a = left[key];
    const b = right[key];
    if (Object.prototype.hasOwnProperty.call(left, key) && isObject(a) && isObject(b)) {
      merged[key] = deepMerge(a, b);
    } else {
      merged[key] = b;
    }
  }
  return merged;
}

function strictMerge(
  left: PlainObject,
  right: PlainObject,
  base: PlainObject = {},
  path: string[] = [],
): PlainObject {
  const keys = unionKeys(left, right, base);
  const merged: PlainObject = {};

  for (const key of keys) {
    const leftHas = Object.prototype.hasOwnProperty.call(left, key);
    const rightHas = Object.prototype.hasOwnProperty.call(right, key);
    const baseHas = Object.prototype.hasOwnProperty.call(base, key);

    const leftValue: Maybe<unknown> = leftHas ? left[key] : MISSING;
    const rightValue: Maybe<unknown> = rightHas ? right[key] : MISSING;
    const baseValue: Maybe<unknown> = baseHas ? base[key] : MISSING;

    merged[key] = strictValue(leftValue, rightValue, baseValue, [...path, key]);
  }

  return merged;
}

function strictValue(
  left: Maybe<unknown>,
  right: Maybe<unknown>,
  base: Maybe<unknown>,
  path: string[],
): unknown {
  const missingResolved = strictValueWithMissing(left, right);
  if (missingResolved !== MISSING) {
    return missingResolved;
  }

  const hashMerged = strictValueWithHashMerge(left, right, base, path);
  if (hashMerged !== MISSING) {
    return hashMerged;
  }

  return strictValueFromChanges(left, right, base, path);
}

function strictValueWithMissing(left: Maybe<unknown>, right: Maybe<unknown>): Maybe<unknown> {
  if (right === MISSING) {
    return left;
  }
  if (left === MISSING) {
    return right;
  }
  return MISSING;
}

function strictValueWithHashMerge(
  left: Maybe<unknown>,
  right: Maybe<unknown>,
  base: Maybe<unknown>,
  path: string[],
): Maybe<unknown> {
  if (!isObject(left) || !isObject(right)) {
    return MISSING;
  }
  if (!(isObject(base) || base === MISSING)) {
    return MISSING;
  }
  return strictMerge(left, right, base === MISSING ? {} : (base as PlainObject), path);
}

function strictValueFromChanges(
  left: Maybe<unknown>,
  right: Maybe<unknown>,
  base: Maybe<unknown>,
  path: string[],
): unknown {
  const rightChanged = changedFromBase(right, base);
  const leftChanged = changedFromBase(left, base);

  if (!rightChanged) {
    return left;
  }
  if (!leftChanged) {
    return right;
  }
  if (deepEqual(left, right)) {
    return left;
  }

  throw BerylxError.create('merge_conflict', `merge conflict at ${path.join('.')}`, {
    metadata: {
      path,
      left,
      right,
      base: base === MISSING ? null : base,
    },
  });
}

function changedFromBase(value: Maybe<unknown>, base: Maybe<unknown>): boolean {
  if (base === MISSING) {
    return true;
  }
  return !deepEqual(value, base);
}

function unionKeys(...objs: PlainObject[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const obj of objs) {
    for (const key of Object.keys(obj)) {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }
  return ordered;
}

/** Ruby の値比較 (==) 相当。plain object/array を構造的に比較する。 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a === MISSING || b === MISSING) {
    return false;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) {
      return false;
    }
    return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

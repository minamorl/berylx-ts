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

export type PathKey = string | number | symbol;

/**
 * 焦点の path P を状態 S へ適用した先の型。
 *
 * Focus は zipper なので「いまどこを見ているか」は path が持つ。get の戻り値を
 * 型として言うには path を型に載せるしかない。再帰は path の長さで止まるので
 * 有界であり、深さ無制限の型レベル計算にはならない。
 * S = any (既定・型を付けない使い方) のときは any へ落ちる。
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
 * path P の先で掘れるキー。
 *
 * スカラの先は掘れないので never にする。そうしないと keyof number が
 * toFixed / toExponential といった prototype メソッドを候補として提案してくる。
 */
export type KeysAt<S, P extends readonly PathKey[]> =
  PathAt<S, P> extends object ? keyof PathAt<S, P> & PathKey : never;

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

/**
 * 焦点つき不変状態。
 *
 * 型引数は状態のルート型 S と、いま見ている path P。既定は S = any なので、
 * 型を付けない使い方はこれまでどおり通る。S を与えると at のキーが検査され、
 * get の戻り値が確定する。
 *
 * S は workflow の境界ごとに 1 つ固定される (spec の core.root.singleton)。
 * したがって Task を Focus<A> -> Focus<B> の遷移として型付ける必要はなく、
 * S について単相でよい。set が型を広げないので、object 型を再帰的に組み直す
 * SetAt のような型が要らず、型レベルの計算が path の読み出し一本で済む。
 */
export class Focus<S = any, P extends readonly PathKey[] = []> {
  readonly value: S;
  readonly path: P;

  constructor(value: unknown = {}, path: readonly PathKey[] = []) {
    this.value = value as S;
    this.path = Object.freeze([...path]) as unknown as P;
  }

  /** Ruby Focus[value] / Focus.new に対応する smart constructor。 */
  static of<T>(value: T): Focus<T, []>;
  static of(): Focus<any, []>;
  static of(value: unknown = {}): Focus<any, []> {
    return new Focus(value);
  }

  /** パスを 1 段掘る (Ruby Focus#[])。 */
  at<K extends KeysAt<S, P>>(key: K): Focus<S, [...P, K]> {
    return new Focus(this.value, [...this.path, key as PathKey]) as Focus<S, [...P, K]>;
  }

  /**
   * 現在のパスの値を取り出す。パスが辿れない場合、default が渡されていれば
   * それを返し、無ければ例外を投げる (Ruby Focus#get)。
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

  /** get のエイリアス。default を位置引数で受ける (Ruby Focus#fetch)。 */
  fetch(): PathAt<S, P>;
  fetch<D>(defaultValue: D): PathAt<S, P> | D;
  fetch(defaultValue: unknown = MISSING): unknown {
    if (defaultValue === MISSING) {
      return this.get();
    }
    return this.get({ default: defaultValue });
  }

  /** 値が無ければ null を返す (Ruby Focus#maybe)。 */
  maybe(): PathAt<S, P> | null {
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

  /** 現在のパスへ値をセットした新しい Focus をルートで返す (Ruby Focus#set)。 */
  set(nextValue: PathAt<S, P>): Focus<S, []> {
    return new Focus(assocIn(this.value, this.path, nextValue));
  }

  /** 現在値をブロックで変換してセットする (Ruby Focus#update)。 */
  update(block: (current: PathAt<S, P>) => PathAt<S, P>): Focus<S, []> {
    return this.set(block(this.get()));
  }

  /** 子キーへ値をセットする (Ruby Focus#put)。 */
  put<K extends KeysAt<S, P>>(key: K, nextValue: PathAt<S, [...P, K]>): Focus<S, []> {
    return this.at(key).set(nextValue);
  }

  /** この Focus を部分状態に持つ Err を作る (Ruby Focus#reject)。 */
  reject(
    code: string,
    message: string = code,
    options: { cause?: unknown } = {},
  ): Result<S> {
    return ResultOps.err(this, code, message, { cause: options.cause });
  }

  /** ルートの生値を返す (Ruby Focus#to_h)。 */
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

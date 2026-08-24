// ==================================================================
// darkcore substrate — 単一 Effect 型 (Freer monad) の最小 TS 内包版。
//
// darkcore-ruby (minamorl/darkcore-ruby) の Effect / op / pure / fold /
// bind を berylx-ts が必要とする範囲だけ TypeScript へ移植したもの。
// darkcore の TS パッケージがまだ無いため、berylx の唯一の実行基盤
// (EffectTree) を成立させる substrate としてリポジトリ内に内包する。
//
// 掟 (darkcore spec pins) との対応:
//   - core.effect.node = single_tagged : 全ノードを 1 種の tagged effect で表す。
//   - core.pure.encoding = closed_effect: pure / return は継続を持たない
//       :pure タグの閉じた作用として畳み込む。
//   - core.bind.free                    : bind は圏固有の演算をひとつも
//       埋め込まない。ただの構造の接ぎ木 (free = 意味を持たない)。
//   - core.algebra.site in [handler, on_return]:
//       演算 (各圏の algebra) が現れてよいのは fold の on_return と
//       handler マップだけ。
//   - run.strategy = trampoline / run.no_naive_recursion:
//       実行は再帰でなく反復 (loop) で深い木でもスタックを食わない。
//   - effect.dispatch = by_tag          : 作用は tag でディスパッチする。
// ==================================================================

/** :pure タグ (継続を持たない閉じた作用) を表す予約シンボル。 */
export const PURE = 'pure';

/**
 * Effect — 単一 Effect 型 (Freer monad)。
 *
 *   tag     : どの圏 (handler) で解釈されるかの印。ディスパッチキー。
 *   payload : 作用への入力 (検査・差し替え可能なただのデータ)。
 *   k       : 継続。作用の結果を受け取り「次の Effect」を返す関数。
 *             閉じた作用 (:pure) では null。
 */
export class Effect<A = unknown> {
  readonly tag: string;
  readonly payload: unknown;
  readonly k: ((x: unknown) => Effect<A>) | null;

  constructor(tag: string, payload: unknown, k: ((x: unknown) => Effect<A>) | null) {
    this.tag = tag;
    this.payload = payload;
    this.k = k;
    Object.freeze(this);
  }

  /** 閉じた作用 (継続なし) = 従来の pure / return。 */
  static pure<A>(x: A): Effect<A> {
    return new Effect<A>(PURE, x, null);
  }

  /** 継続を持たない :pure ノードか? (= 実行の終端) */
  closed(): boolean {
    return this.tag === PURE && this.k === null;
  }

  /**
   * bind — 圏固有の演算 (category algebra) をひとつも埋め込まない。
   * ただの構造の接ぎ木 (free = 意味を持たない)。
   */
  bind<B>(f: (x: unknown) => Effect<B>): Effect<B> {
    if (this.closed()) {
      // 閉じた点なら、そのまま次の作用へ継続を接ぐだけ。
      return f(this.payload);
    }
    // 実行せず木を伸ばす。継続の内側に f を差し込むだけ。
    const prevK = this.k!;
    return new Effect<B>(this.tag, this.payload, (x: unknown) => prevK(x).bind(f));
  }

  /** 逐次実行 (前の結果を捨てて次の作用へ)。bind の特例。 */
  seq<B>(next: Effect<B>): Effect<B> {
    return this.bind(() => next);
  }
}

/** 閉じた作用 = pure / return。 */
export function pure<A>(x: A): Effect<A> {
  return Effect.pure(x);
}

/**
 * op / perform — 作用の smart constructor。
 * tag を投げて結果 x を受け取る (継続は「値をそのまま返す」で初期化)。
 * ここでは一切副作用が起きない。返るのは検査可能な純粋データ。
 */
export function op(tag: string, payload: unknown = null): Effect<unknown> {
  if (tag === PURE) {
    throw new Error(':pure は予約タグ (閉じた作用)');
  }
  return new Effect<unknown>(tag, payload, (x: unknown) => Effect.pure(x));
}

/** op の別名 (プロトタイプ由来の慣習)。 */
export const perform = op;

/** tag ごとの解釈 (handler) のマップ。 */
export type HandlerMap = Record<string, (payload: unknown) => unknown>;

/**
 * fold — 作用木の畳み込み (インタプリタの本体)。
 *
 *   onReturn : 終端の :pure 値を最終結果へ写す関数 (圏の algebra)。
 *   handlers : { tag => (payload) => ... } の handler マップ。
 *              tag ごとの解釈 (= もう一つの algebra site)。
 *
 * 演算 (各圏の algebra) が現れてよいのはこの onReturn と handler だけ。
 * 実行は再帰でなく反復 (トランポリン = loop)。
 */
export function fold<R>(
  prog: Effect<unknown>,
  onReturn: (x: unknown) => R,
  handlers: HandlerMap,
): R {
  let cur = prog;
  for (;;) {
    if (cur.tag === PURE && cur.k === null) {
      return onReturn(cur.payload);
    }
    const h = handlers[cur.tag];
    if (!h) {
      throw new Error(`no handler for effect: ${cur.tag}`);
    }
    const next = cur.k!(h(cur.payload));
    cur = next;
  }
}

/**
 * run — fold の素直な特化 (onReturn = 恒等)。
 * 同一 program を書き換えず handlers を差し替えるだけで圏を選ぶ。
 */
export function run(prog: Effect<unknown>, handlers: HandlerMap): unknown {
  return fold(prog, (x) => x, handlers);
}

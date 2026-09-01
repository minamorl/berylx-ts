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
export type ResponseDecoder<A> = (value: unknown) => A;

/** Effect の現在位置。handler 応答だけを動的境界として unknown で受ける。 */
export type EffectStep<A> =
  | { readonly closed: true; readonly value: A }
  | {
      readonly closed: false;
      readonly tag: string;
      readonly payload: unknown;
      readonly resume: (response: unknown) => Effect<A>;
    };

export class Effect<A = unknown> {
  readonly tag: string;
  readonly payload: unknown;
  readonly k: ((x: unknown) => Effect<A>) | null;
  private readonly current: EffectStep<A>;

  private constructor(current: EffectStep<A>) {
    this.current = current;
    this.tag = current.closed ? PURE : current.tag;
    this.payload = current.closed ? current.value : current.payload;
    this.k = current.closed ? null : current.resume;
  }

  /** 閉じた作用 (継続なし) = 従来の pure / return。 */
  static pure<A>(x: A): Effect<A> {
    return new Effect<A>({ closed: true, value: x });
  }

  /** decoder で handler 応答を narrow する、開いた作用の smart constructor。 */
  static op<P, A>(tag: string, payload: P, decode: ResponseDecoder<A>): Effect<A> {
    if (tag === PURE) {
      throw new Error(':pure は予約タグ (閉じた作用)');
    }
    return Effect.suspend(tag, payload, (response) => Effect.pure(decode(response)));
  }

  /** 継続を持たない :pure ノードか? (= 実行の終端) */
  closed(): boolean {
    return this.current.closed;
  }

  /** interpreter 用の型付き 1-step view。 */
  step(): EffectStep<A> {
    return this.current;
  }

  /**
   * bind — 圏固有の演算 (category algebra) をひとつも埋め込まない。
   * ただの構造の接ぎ木 (free = 意味を持たない)。
   */
  bind<B>(f: (x: A) => Effect<B>): Effect<B> {
    const current = this.current;
    if (current.closed) {
      // 閉じた点なら、そのまま次の作用へ継続を接ぐだけ。
      return f(current.value);
    }
    // 実行せず木を伸ばす。継続の内側に f を差し込むだけ。
    return Effect.suspend<B>(current.tag, current.payload, (response) =>
      current.resume(response).bind(f),
    );
  }

  /** 逐次実行 (前の結果を捨てて次の作用へ)。bind の特例。 */
  seq<B>(next: Effect<B>): Effect<B> {
    return this.bind(() => next);
  }

  private static suspend<A>(
    tag: string,
    payload: unknown,
    resume: (response: unknown) => Effect<A>,
  ): Effect<A> {
    return new Effect<A>({ closed: false, tag, payload, resume });
  }
}

/** 閉じた作用 = pure / return。 */
export function pure<A>(x: A): Effect<A> {
  return Effect.pure(x);
}

/**
 * op / perform — 作用の smart constructor。
 * tag を投げて handler 応答を受け取り、decode 後の値を継続へ渡す。
 * ここでは一切副作用が起きない。返るのは検査可能な純粋データ。
 */
export function op<P, A>(tag: string, payload: P, decode: ResponseDecoder<A>): Effect<A> {
  return Effect.op(tag, payload, decode);
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
export function fold<A, R>(
  prog: Effect<A>,
  onReturn: (x: A) => R,
  handlers: HandlerMap,
): R {
  let cur = prog;
  for (;;) {
    const step = cur.step();
    if (step.closed) {
      return onReturn(step.value);
    }
    const h = handlers[step.tag];
    if (!h) {
      throw new Error(`no handler for effect: ${step.tag}`);
    }
    cur = step.resume(h(step.payload));
  }
}

/**
 * run — fold の素直な特化 (onReturn = 恒等)。
 * 同一 program を書き換えず handlers を差し替えるだけで圏を選ぶ。
 */
export function run<A>(prog: Effect<A>, handlers: HandlerMap): A {
  return fold(prog, (x) => x, handlers);
}

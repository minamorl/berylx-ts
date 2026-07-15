// ==================================================================
// Monad — 共通導出ヘルパ。
//
// darkcore-ruby monad.rb の TS 移植。Ruby は module Monad を mixin して
// fmap/ap を pure+bind から自動導出していた。TS には HKT が無いので mixin
// ではなく「pure と bind から fmap/ap を導出する共通関数」を提供し、各圏
// (Maybe / Either / Result / State / Validation) の fmap/ap はこの導出を
// 呼ぶだけにする。
//
// 掟 (darkcore spec pins) との対応:
//   - api.derive.from in [pure, bind] : fmap/ap は pure と bind から導出。
//   - api.no_operator_overload        : 演算子は一切定義しない。
//   - api.bind_name = method_bind     : 合成はメソッド名 (bind/fmap/map/ap/seq)。
// ==================================================================

/**
 * Functor: fmap f = bind (x => pure (f x))。
 * bindFn は圏のインスタンスの bind をそのまま渡す。pure は同じ圏の
 * smart constructor。これで「fmap を手書きしない」導出が全圏で共有される。
 */
export function deriveFmap<A, B, M>(
  bindFn: (f: (a: A) => M) => M,
  pure: (b: B) => M,
  f: (a: A) => B,
): M {
  return bindFn((x) => pure(f(x)));
}

/**
 * Applicative: self は「関数を包んだ圏」、other は「値を包んだ圏」。
 * ap = bind (g => other.fmap (x => g x))。fmap 同様 bind から導出する。
 */
export function deriveAp<A, B, M>(
  bindFn: (f: (g: (a: A) => B) => M) => M,
  otherFmap: (h: (a: A) => B) => M,
): M {
  return bindFn((g) => otherFmap((x) => g(x)));
}

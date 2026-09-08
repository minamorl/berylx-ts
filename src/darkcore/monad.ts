// Shared derivations avoid repeating fmap/ap across monads without native
// higher-kinded types. Validation provides its own error-accumulating ap.

/**
 * Derive fmap from bind and pure: fmap f = bind (x => pure (f x)).
 * bindFn and pure must belong to the same monad.
 */
export function deriveFmap<A, B, M>(
  bindFn: (f: (a: A) => M) => M,
  pure: (b: B) => M,
  f: (a: A) => B,
): M {
  return bindFn((x) => pure(f(x)));
}

/**
 * Derive application from bind and fmap: ap = bind (g => other.fmap (x => g x)).
 * bindFn unwraps the function; otherFmap maps over the argument.
 */
export function deriveAp<A, B, M>(
  bindFn: (f: (g: (a: A) => B) => M) => M,
  otherFmap: (h: (a: A) => B) => M,
): M {
  return bindFn((g) => otherFmap((x) => g(x)));
}

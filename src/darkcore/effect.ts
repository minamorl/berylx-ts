// Effects describe a program as a tagged Freer monad tree. Binding only joins
// structure; interpretation belongs to fold handlers and onReturn.

/** Reserved tag for a closed effect with no continuation. */
export const PURE = 'pure';

/** Validate or decode a dynamic handler response into the effect result type. */
export type ResponseDecoder<A> = (value: unknown) => A;

/** An effect step; only handler responses cross the dynamic unknown boundary. */
export type EffectStep<A> =
  | { readonly closed: true; readonly value: A }
  | {
      readonly closed: false;
      readonly tag: string;
      readonly payload: unknown;
      readonly resume: (response: unknown) => Effect<A>;
    };

/**
 * A tagged effect in a Freer monad tree.
 *
 * tag selects the handler; payload holds inspectable input data. The continuation
 * k receives the handler result and returns the next effect, or is null for pure.
 */
export class Effect<A = unknown> {
  readonly tag: string;
  readonly payload: unknown;
  readonly k: ((x: unknown) => Effect<A>) | null;
  private readonly current: EffectStep<A>;

  private constructor(current: EffectStep<A>) {
    this.current = Object.freeze(current);
    this.tag = current.closed ? PURE : current.tag;
    this.payload = current.closed ? current.value : current.payload;
    this.k = current.closed ? null : current.resume;
    Object.freeze(this);
  }

  /** Create a terminal value with no continuation. */
  static pure<A>(x: A): Effect<A> {
    return new Effect<A>({ closed: true, value: x });
  }

  /** Describe an effect whose handler response is narrowed by the decoder. */
  static op<P, A>(tag: string, payload: P, decode: ResponseDecoder<A>): Effect<A> {
    if (tag === PURE) {
      throw new Error('The :pure tag is reserved (closed effects)');
    }
    return Effect.suspend(tag, payload, (response) => Effect.pure(decode(response)));
  }

  /** Whether this is a terminal pure node. */
  closed(): boolean {
    return this.current.closed;
  }

  /** Inspect the current typed step without executing handlers. */
  step(): EffectStep<A> {
    return this.current;
  }

  /** Join the tree structure without embedding interpreter-specific operations. */
  bind<B>(f: (x: A) => Effect<B>): Effect<B> {
    const current = this.current;
    if (current.closed) {
      return f(current.value);
    }
    return Effect.suspend<B>(current.tag, current.payload, (response) =>
      current.resume(response).bind(f),
    );
  }

  /** Sequence effects, discarding the previous result. */
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

/** Create a terminal value with no continuation. */
export function pure<A>(x: A): Effect<A> {
  return Effect.pure(x);
}

/**
 * Describe an effect without executing it. The decoder validates the handler
 * response before passing it to the continuation as a typed pure value.
 */
export function op<P, A>(tag: string, payload: P, decode: ResponseDecoder<A>): Effect<A> {
  return Effect.op(tag, payload, decode);
}

export const perform = op;

/** Handlers indexed by effect tag. */
export type HandlerMap = Record<string, (payload: unknown) => unknown>;

/**
 * Interpret an effect tree with an iterative trampoline. Handlers interpret each
 * tag; onReturn maps the terminal pure value to the final result. All
 * interpreter-specific operations belong in those two places.
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

/** Interpret the program with the supplied handlers and return its terminal value. */
export function run<A>(prog: Effect<A>, handlers: HandlerMap): A {
  return fold(prog, (x) => x, handlers);
}

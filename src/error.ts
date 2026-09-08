export interface BerylxErrorContext {
  cause?: unknown;
  failedNode?: string | null;
  trace?: TraceInput;
  /** Child errors collected by parallel execution in accumulate mode. */
  parallelErrors?: BerylxError[];
  metadata?: Record<string, unknown>;
  fatal?: boolean;
}

type TraceElement = string | { name: string };
type TraceInput = ReadonlyArray<TraceElement | null | undefined> | undefined;

export class BerylxError extends Error {
  readonly code: string;
  override readonly cause: unknown;
  readonly failedNode: string | null;
  readonly trace: readonly string[];
  readonly parallelErrors: readonly BerylxError[];
  readonly metadata: Readonly<Record<string, unknown>>;
  private readonly _fatal: boolean;

  constructor(code: string, message: string = code, context: BerylxErrorContext = {}) {
    super(message);
    this.name = 'BerylxError';
    this.code = String(code);
    this.cause = context.cause;
    this.failedNode = context.failedNode != null ? String(context.failedNode) : null;
    this.trace = normalizeTrace(context.trace ?? []);
    this.parallelErrors = Object.freeze([...(context.parallelErrors ?? [])]);
    this.metadata = Object.freeze({ ...(context.metadata ?? {}) });
    this._fatal = context.fatal ?? false;
    // Preserve the original failure location when wrapping an exception.
    if (context.cause instanceof Error && context.cause.stack) {
      this.stack = context.cause.stack;
    }
  }

  static create(code: string, message: string = code, context: BerylxErrorContext = {}): BerylxError {
    return new BerylxError(code, message, context);
  }

  /**
   * Create a structured error from an arbitrary value. Existing BerylxError
   * instances retain their details with the supplied context merged in.
   */
  static from(value: unknown, context: BerylxErrorContext = {}): BerylxError {
    if (value instanceof BerylxError) {
      return value.withContext(context);
    }
    const cause = context.cause ?? (value instanceof Error ? value : undefined);
    const code = context.metadata && 'code' in (context as Record<string, unknown>)
      ? String((context as Record<string, unknown>).code)
      : codeFrom(cause);
    const message = messageFrom(cause, code);
    return new BerylxError(code, message, { ...context, cause });
  }

  static codeFrom(cause: unknown): string {
    return cause instanceof Error ? cause.name || 'Error' : 'error';
  }

  fatal(): boolean {
    return this._fatal;
  }

  withContext(context: BerylxErrorContext): BerylxError {
    return new BerylxError(this.code, this.message, {
      cause: 'cause' in context ? context.cause : this.cause,
      failedNode: context.failedNode ?? this.failedNode,
      trace: context.trace ? normalizeTrace(context.trace) : this.trace,
      parallelErrors: context.parallelErrors ?? [...this.parallelErrors],
      metadata: context.metadata ? { ...this.metadata, ...context.metadata } : { ...this.metadata },
      fatal: 'fatal' in context ? context.fatal : this._fatal,
    });
  }

  /** Prepend a node to the trace and set failedNode if it is not already set. */
  prependTrace(node: TraceElement): BerylxError {
    const nodeName = typeof node === 'string' ? node : node.name;
    return this.withContext({
      failedNode: this.failedNode ?? nodeName,
      trace: [nodeName, ...this.trace],
    });
  }

  /** Return the underlying cause, or this error when no cause is present. */
  unwrap(): unknown {
    if (this.cause == null) {
      return this;
    }
    return this.cause;
  }

  toException(): unknown {
    return this.unwrap();
  }

  toObject(): {
    code: string;
    message: string;
    failedNode: string | null;
    trace: readonly string[];
    fatal: boolean;
    parallelErrors: unknown[];
    metadata: Readonly<Record<string, unknown>>;
  } {
    return {
      code: this.code,
      message: this.message,
      failedNode: this.failedNode,
      trace: this.trace,
      fatal: this.fatal(),
      parallelErrors: this.parallelErrors.map((e) =>
        e instanceof BerylxError ? e.toObject() : e,
      ),
      metadata: this.metadata,
    };
  }
}

function codeFrom(cause: unknown): string {
  return BerylxError.codeFrom(cause);
}

function messageFrom(cause: unknown, code: string): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return code;
}

function normalizeTrace(trace: TraceInput | readonly string[]): readonly string[] {
  const arr = Array.isArray(trace) ? trace : [...(trace ?? [])];
  return Object.freeze(
    arr
      .filter((el): el is TraceElement => el != null)
      .map((el) => (typeof el === 'string' ? el : el.name)),
  );
}

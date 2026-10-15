/**
 * Input types and the mutable parse {@link State} cursor.
 *
 * Like winnow, effect-nom parsers advance a mutable cursor rather than
 * returning the remaining input. A {@link State} wraps the original input
 * together with the current offset, the streaming (partial) flag, the
 * services available to the parser, and the details of the most recent
 * failure.
 *
 * Most users never touch `State` directly. It is exposed for writing custom
 * low-level parsers with `Parser.make`.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import type { ErrorKind } from "./ParseError.js"

/**
 * The kinds of input a parser can consume.
 *
 * - `string`: tokens are Unicode code points (returned as strings), offsets
 *   are UTF-16 code-unit indices.
 * - `Uint8Array`: tokens are bytes (numbers), slices are `subarray` views.
 * - `ReadonlyArray<T>`: tokens are elements, e.g. the output of a lexer.
 *
 * @since 0.1.0
 * @category models
 */
export type Input = string | Uint8Array | ReadonlyArray<unknown>

/**
 * The type of a single token of an input.
 *
 * @since 0.1.0
 * @category models
 */
export type Token<I> = I extends string ? string
  : I extends Uint8Array ? number
  : I extends ReadonlyArray<infer T> ? T
  : never

/**
 * The type of a contiguous slice of an input.
 *
 * @since 0.1.0
 * @category models
 */
export type Slice<I> = I extends string ? string
  : I extends Uint8Array ? Uint8Array
  : I extends ReadonlyArray<infer T> ? ReadonlyArray<T>
  : never

/**
 * Sentinel returned by a parser step to signal failure. The failure details
 * are stored on the {@link State}.
 *
 * @since 0.1.0
 * @category failure
 */
export const Fail: unique symbol = Symbol.for("effect-nom/Fail")

/**
 * @since 0.1.0
 * @category failure
 */
export type Fail = typeof Fail

/**
 * How a failure propagates (winnow's `ErrMode`, nom's `Err`).
 *
 * - `Backtrack`: recoverable; `alt`, `opt`, `repeat`, ... try something else.
 * - `Cut`: unrecoverable; alternatives are not attempted.
 * - `Incomplete`: a partial (streaming) input ran out; more data is needed.
 *
 * @since 0.1.0
 * @category failure
 */
export type ErrMode = "Backtrack" | "Cut" | "Incomplete"

/**
 * The details of a parse failure.
 *
 * @since 0.1.0
 * @category failure
 */
export class Failure {
  constructor(
    /** Offset into the input where the failure occurred. */
    readonly offset: number,
    /** The kind of parser that failed. */
    readonly kind: ErrorKind,
    /** Rendered descriptions of what was expected at `offset`. */
    readonly expected: ReadonlyArray<string>,
    /** Context labels added by `Parser.context`, innermost first. */
    readonly context: ReadonlyArray<string>,
    /** Whether a user supplied cause is present. */
    readonly hasCause: boolean,
    /** A user supplied (typed) cause. */
    readonly cause: unknown,
    /** An optional free-form message. */
    readonly message: string | undefined,
    /** For `Incomplete` failures, how many more tokens are needed (0 if unknown). */
    readonly needed: number
  ) {}
}

const empty: ReadonlyArray<string> = []

/** @internal */
export const emptyStrings = empty

/**
 * A tracing event emitted by `Parser.trace`.
 *
 * @since 0.1.0
 * @category tracing
 */
export interface TraceEvent {
  readonly _tag: "Enter" | "Exit"
  readonly name: string
  readonly depth: number
  readonly offset: number
  /** For `Exit` events: the outcome. */
  readonly result?: "Ok" | ErrMode
  /** For `Exit` events: the offset reached. */
  readonly endOffset?: number
  readonly state: State
}

/**
 * The mutable parsing cursor.
 *
 * @since 0.1.0
 * @category models
 */
export class State<I extends Input = Input> {
  /** The full input being parsed. */
  readonly input: I
  /** The current offset. Advanced by parsers, rewound on backtracking. */
  pos: number
  /** The bit offset within the current byte, used by `Bits` parsers. */
  bit = 0
  /** The end offset (the input's length). */
  readonly end: number
  /** 0 = string, 1 = Uint8Array, 2 = array. */
  readonly inputKind: 0 | 1 | 2
  /** Whether the input is partial (streaming): running out yields `Incomplete`. */
  partial: boolean
  /** Services available to `Parser.service`. */
  context: Context.Context<never>
  /** Mode of the latest failure. Only meaningful after a step returned {@link Fail}. */
  mode: ErrMode = "Backtrack"
  /** Details of the latest failure. Only meaningful after a step returned {@link Fail}. */
  failure: Failure
  /**
   * A recoverable failure that occurred without consuming input at the
   * current offset (for example the last attempt of a `repeat`). Its
   * expectations are merged into new failures at the same offset, producing
   * messages like `expected digit or ")"`.
   */
  hint: Failure | undefined = undefined
  /** When defined, `Parser.resumeAfter`/`retryAfter` record failures here. */
  recovered: Array<Failure> | undefined = undefined
  /** When defined, `Parser.trace` reports events here. */
  tracer: ((event: TraceEvent) => void) | undefined = undefined
  /** Current tracing depth. */
  depth = 0

  constructor(input: I, options?: {
    readonly partial?: boolean | undefined
    readonly context?: Context.Context<never> | undefined
    readonly offset?: number | undefined
  }) {
    this.input = input
    this.end = input.length
    this.pos = options?.offset ?? 0
    this.partial = options?.partial ?? false
    this.context = options?.context ?? Context.empty()
    this.inputKind = typeof input === "string" ? 0 : input instanceof Uint8Array ? 1 : 2
    this.failure = new Failure(0, "Fail", empty, empty, false, undefined, undefined, 0)
  }

  /**
   * The number of input units (code units, bytes or elements) remaining.
   */
  remaining(): number {
    return this.end - this.pos
  }

  /**
   * Whether the cursor is at the end of the input.
   */
  atEnd(): boolean {
    return this.pos >= this.end
  }

  /**
   * Extracts the slice `[start, end)` of the input.
   */
  slice(start: number, end: number): Slice<I> {
    const input = this.input as any
    switch (this.inputKind) {
      case 0:
        return input.slice(start, end)
      case 1:
        return input.subarray(start, end)
      default:
        return input.slice(start, end)
    }
  }

  /**
   * Records a recoverable failure at the current offset and returns {@link Fail}.
   */
  backtrack(kind: ErrorKind, expected: ReadonlyArray<string> = empty, offset: number = this.pos): Fail {
    return this.failWith("Backtrack", this.makeFailure(offset, kind, expected))
  }

  /**
   * Records an unrecoverable failure at the current offset and returns {@link Fail}.
   */
  cut(kind: ErrorKind, expected: ReadonlyArray<string> = empty, offset: number = this.pos): Fail {
    return this.failWith("Cut", this.makeFailure(offset, kind, expected))
  }

  /**
   * Records an `Incomplete` failure (only meaningful for partial input) and
   * returns {@link Fail}.
   */
  incomplete(needed: number, expected: ReadonlyArray<string> = empty): Fail {
    return this.failWith(
      "Incomplete",
      new Failure(this.pos, "Incomplete", expected, empty, false, undefined, undefined, needed)
    )
  }

  /**
   * Fails because the input ended: `Incomplete` for partial input, otherwise
   * a `Backtrack` failure of the given kind.
   */
  eoi(kind: ErrorKind, expected: ReadonlyArray<string>, needed: number): Fail {
    return this.partial ? this.incomplete(needed, expected) : this.backtrack(kind, expected)
  }

  /**
   * Records a failure carrying a user supplied cause.
   */
  failCause(mode: ErrMode, kind: ErrorKind, cause: unknown, offset: number = this.pos): Fail {
    return this.failWith(mode, new Failure(offset, kind, empty, empty, true, cause, undefined, 0))
  }

  /**
   * Records a failure carrying a message.
   */
  failMessage(mode: ErrMode, kind: ErrorKind, message: string, offset: number = this.pos): Fail {
    return this.failWith(mode, new Failure(offset, kind, empty, empty, false, undefined, message, 0))
  }

  /**
   * Records the given failure and returns {@link Fail}.
   */
  failWith(mode: ErrMode, failure: Failure): Fail {
    this.mode = mode
    this.failure = failure
    return Fail
  }

  /** @internal */
  makeFailure(offset: number, kind: ErrorKind, expected: ReadonlyArray<string>): Failure {
    const hint = this.hint
    if (hint !== undefined && hint.offset === offset && hint.expected.length > 0) {
      expected = mergeExpected(hint.expected, expected)
    }
    return new Failure(offset, kind, expected, empty, false, undefined, undefined, 0)
  }
}

/** @internal */
export const mergeExpected = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>
): ReadonlyArray<string> => {
  if (a.length === 0) return b
  if (b.length === 0) return a
  const out = a.slice()
  for (const e of b) {
    if (!out.includes(e)) out.push(e)
  }
  return out
}

/**
 * Combines the failures of two alternatives: the furthest failure wins, and
 * failures at the same offset have their expectations merged.
 *
 * @internal
 */
export const mergeFailures = (a: Failure, b: Failure): Failure => {
  if (a.offset > b.offset) return a
  if (b.offset > a.offset) return b
  const expected = mergeExpected(a.expected, b.expected)
  if (expected === b.expected) return b
  return new Failure(
    b.offset,
    b.kind,
    expected,
    b.context.length > 0 ? b.context : a.context,
    b.hasCause || a.hasCause,
    b.hasCause ? b.cause : a.cause,
    b.message ?? a.message,
    b.needed
  )
}

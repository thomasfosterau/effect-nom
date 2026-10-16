/**
 * Running parsers over Effect `Stream`s of input chunks.
 *
 * This is where nom's and winnow's *partial* (streaming) parsing meets
 * Effect: chunks are buffered and the parser runs in partial mode, so a
 * value split across chunk boundaries is reported as `Incomplete` and
 * retried once more data arrives. When the stream ends, the leftover input
 * is parsed in complete mode.
 *
 * @example
 * ```ts
 * import { Effect, Stream } from "effect"
 * import { Ascii, Parser, ParserStream, Token } from "effect-nom"
 *
 * const line = Parser.terminated(Ascii.decInt, Token.literal("\n"))
 *
 * const program = Stream.make("1\n2", "3\n", "4\n").pipe(
 *   ParserStream.parseMany(line),
 *   Stream.runCollect
 * )
 * // Effect.runSync(program) => [1, 23, 4]
 * ```
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Stream from "effect/Stream"
import type { Input } from "./Input.js"
import { Fail, Failure, State } from "./Input.js"
import * as ParseError from "./ParseError.js"
import type { Parser } from "./Parser.js"

/**
 * Input kinds that can be streamed in chunks.
 *
 * @since 0.1.0
 * @category models
 */
export type Chunkable = string | Uint8Array | ReadonlyArray<unknown>

const concat = <I extends Chunkable>(a: I, b: I): I => {
  if (typeof a === "string") return (a + (b as string)) as I
  if (a instanceof Uint8Array) {
    if (a.length === 0) return b
    const out = new Uint8Array(a.length + (b as Uint8Array).length)
    out.set(a)
    out.set(b as Uint8Array, a.length)
    return out as I
  }
  return [...a, ...(b as ReadonlyArray<unknown>)] as unknown as I
}

const join = <I extends Chunkable>(chunks: ReadonlyArray<I>, empty: I | undefined): I => {
  if (chunks.length === 0) return (empty ?? "") as I
  const first = chunks[0]!
  if (chunks.length === 1) return first
  if (typeof first === "string") return chunks.join("") as I
  if (first instanceof Uint8Array) {
    let length = 0
    for (const c of chunks) length += c.length
    const out = new Uint8Array(length)
    let offset = 0
    for (const c of chunks as ReadonlyArray<Uint8Array>) {
      out.set(c, offset)
      offset += c.length
    }
    return out as I
  }
  return (chunks as ReadonlyArray<ReadonlyArray<unknown>>).flat() as unknown as I
}

const sliceFrom = <I extends Chunkable>(input: I, offset: number): I =>
  (typeof input === "string" ? input.slice(offset) : input.slice(offset)) as I

const noProgress = (input: Input, offset: number) =>
  ParseError.fromFailure<never>(
    input,
    new Failure(offset, "Assert", [], [], false, undefined, "`parseMany` parsers must always consume", 0),
    "Cut"
  )

/**
 * Options for {@link parseMany}.
 *
 * @since 0.1.0
 * @category models
 */
export interface ParseManyOptions<I> {
  /** The empty input, used to initialise the buffer (inferred from the first chunk if omitted). */
  readonly empty?: I | undefined
}

/**
 * Transforms a stream of input chunks into a stream of parsed values by
 * applying `parser` repeatedly. Each application must consume input.
 *
 * Services required by the parser are taken from the stream's context.
 * Error offsets are relative to the internal buffer of unconsumed input,
 * which is also the `input` of the reported `ParseError`.
 *
 * @since 0.1.0
 * @category combinators
 */
export const parseMany: {
  <A, E, R, I extends Chunkable>(
    parser: Parser<A, E, R, I>,
    options?: ParseManyOptions<I>
  ): <E0, R0>(self: Stream.Stream<I, E0, R0>) => Stream.Stream<A, E0 | ParseError.ParseError<E>, R0 | R>
  <I extends Chunkable, E0, R0, A, E, R>(
    self: Stream.Stream<I, E0, R0>,
    parser: Parser<A, E, R, I>,
    options?: ParseManyOptions<I>
  ): Stream.Stream<A, E0 | ParseError.ParseError<E>, R0 | R>
} = dual((args) => Stream.isStream(args[0]), <I extends Chunkable, E0, R0, A, E, R>(
  self: Stream.Stream<I, E0, R0>,
  parser: Parser<A, E, R, I>,
  options?: ParseManyOptions<I>
): Stream.Stream<A, E0 | ParseError.ParseError<E>, R0 | R> =>
  Stream.suspend(() => {
    const step = parser.step
    let buffer: I | undefined = options?.empty

    const drain = (
      context: any,
      partial: boolean
    ): Effect.Effect<Array<A>, ParseError.ParseError<E>> => {
      const out: Array<A> = []
      if (buffer === undefined) return Effect.succeed(out)
      const input = buffer
      let offset = 0
      while (offset < input.length) {
        const state = new State(input, { partial, context, offset })
        const a = step(state)
        if (a === Fail) {
          if (partial && state.mode === "Incomplete") break
          return Effect.fail(ParseError.fromFailure<E>(input, state.reportedFailure(), state.mode, state.encoding))
        }
        if (state.pos === offset) return Effect.fail(noProgress(input, offset))
        out.push(a)
        offset = state.pos
      }
      buffer = sliceFrom(input, offset)
      return Effect.succeed(out)
    }

    const feed = (chunk: I) =>
      Effect.flatMap(Effect.context<R>(), (context) =>
        Effect.suspend(() => {
          buffer = buffer === undefined ? chunk : concat(buffer, chunk)
          return drain(context, true)
        }))

    const finish = Effect.flatMap(Effect.context<R>(), (context) => Effect.suspend(() => drain(context, false)))

    return self.pipe(
      Stream.mapEffect(feed),
      Stream.flattenIterable,
      Stream.concat(Stream.unwrap(Effect.map(finish, Stream.fromIterable)))
    )
  }))

/**
 * Parses an entire stream of chunks as a single complete input.
 *
 * @since 0.1.0
 * @category combinators
 */
export const parseAll: {
  <A, E, R, I extends Chunkable>(
    parser: Parser<A, E, R, I>,
    options?: ParseManyOptions<I>
  ): <E0, R0>(self: Stream.Stream<I, E0, R0>) => Effect.Effect<A, E0 | ParseError.ParseError<E>, R0 | R>
  <I extends Chunkable, E0, R0, A, E, R>(
    self: Stream.Stream<I, E0, R0>,
    parser: Parser<A, E, R, I>,
    options?: ParseManyOptions<I>
  ): Effect.Effect<A, E0 | ParseError.ParseError<E>, R0 | R>
} = dual((args) => Stream.isStream(args[0]), <I extends Chunkable, E0, R0, A, E, R>(
  self: Stream.Stream<I, E0, R0>,
  parser: Parser<A, E, R, I>,
  options?: ParseManyOptions<I>
): Effect.Effect<A, E0 | ParseError.ParseError<E>, R0 | R> =>
  Effect.flatMap(
    Stream.runCollect(self),
    (chunks) =>
      Effect.flatMap(Effect.context<R>(), (context) =>
        Effect.suspend(() => {
          const all = join(chunks, options?.empty)
          const state = new State(all, { context })
          const a = parser.step(state)
          if (a === Fail) return Effect.fail(ParseError.fromFailure<E>(all, state.reportedFailure(), state.mode, state.encoding))
          if (state.pos < state.end) {
            state.backtrack("Eof", ["end of input"])
            return Effect.fail(ParseError.fromFailure<E>(all, state.reportedFailure(), state.mode, state.encoding))
          }
          return Effect.succeed(a)
        }))
  ))

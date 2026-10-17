/**
 * Building Effect `Schema`s from parsers.
 *
 * A parser over strings becomes a schema that decodes a `string` into the
 * parser's output. Parse errors become schema issues carrying the rendered
 * `ParseError` message. Encoding needs a printer, supplied as `encode`;
 * without one, encoding is forbidden.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Ascii, Parser, ParserSchema, Token } from "@thomasfosterau/effect-parse"
 *
 * const Version = ParserSchema.make(
 *   Parser.struct({
 *     major: Ascii.decUint,
 *     minor: Parser.preceded(Token.literal("."), Ascii.decUint)
 *   }),
 *   { encode: ({ major, minor }) => `${major}.${minor}` }
 * )
 *
 * Schema.decodeUnknownSync(Version)("1.2") // { major: 1, minor: 2 }
 * Schema.encodeSync(Version)({ major: 3, minor: 4 }) // "3.4"
 * ```
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as SchemaIssue from "effect/SchemaIssue"
import * as SchemaTransformation from "effect/SchemaTransformation"
import type { Parser } from "./Parser.js"
import * as P from "./Parser.js"

/**
 * Options for {@link make}.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options<A> {
  /** Prints a value back to a string. Without it, encoding fails. */
  readonly encode?: ((value: A) => string) | undefined
  /** A description of the decoded type, used by schema tooling. */
  readonly description?: string | undefined
}

/**
 * A schema decoding strings with a parser.
 *
 * @since 0.1.0
 * @category models
 */
export interface ParserSchema<A> extends Schema.decodeTo<Schema.declare<A>, Schema.String> {}

/**
 * Creates a schema that decodes a string with `parser`, which must consume
 * the whole string.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <A, E>(parser: Parser<A, E, never, string>, options?: Options<A>): ParserSchema<A> => {
  const target = Schema.declare<A>(
    (_u): _u is A => true,
    options?.description !== undefined ? { description: options.description } : undefined
  )
  const encode = options?.encode
  return Schema.String.pipe(
    Schema.decodeTo(
      target,
      SchemaTransformation.transformEffect<A, string>({
        decode: (input, parseOptions) => {
          const result = P.parse(parser, input)
          return Result.isSuccess(result)
            ? Effect.succeed(result.success)
            : Effect.fail(new SchemaIssue.InvalidValue({ message: result.failure.message }, input, parseOptions))
        },
        encode: (value, parseOptions) =>
          encode !== undefined
            ? Effect.succeed(encode(value))
            : Effect.fail(new SchemaIssue.Forbidden({ message: "Encoding is not supported" }, value, parseOptions))
      })
    )
  )
}

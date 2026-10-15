/**
 * Parsers for ASCII text: character classes, line endings, numbers and
 * escaped strings (winnow's `ascii` module, nom's `character` module).
 *
 * The parsers are typed for `string` input. Each also works on
 * `Uint8Array` input (treating bytes as ASCII), and `Ascii.bytes` gives the
 * same parsers typed for bytes:
 *
 * ```ts
 * import { Ascii, Parser } from "effect-nom"
 *
 * Parser.parse(Ascii.decUint, "42")                              // 42
 * Parser.parse(Ascii.bytes.decUint, new TextEncoder().encode("42")) // 42
 * ```
 *
 * Partial (streaming) input is supported: for example `digit1` on the
 * partial input `"123"` reports `Incomplete`, since more digits may follow.
 *
 * @since 0.1.0
 */
import * as Result from "effect/Result"
import type { Input, Slice, State } from "./Input.js"
import { Fail } from "./Input.js"
import type { ErrorKind } from "./ParseError.js"
import type { Parser } from "./Parser.js"
import * as P from "./Parser.js"
import { literalImpl, range, takeWhileImpl } from "./Token.js"
import * as Token from "./Token.js"

// -----------------------------------------------------------------------------
// Character predicates
// -----------------------------------------------------------------------------

const code = (c: string | number): number => typeof c === "number" ? c : c.charCodeAt(0)

/**
 * `[a-zA-Z]`
 *
 * @since 0.1.0
 * @category predicates
 */
export const isAlpha = (c: string | number): boolean => {
  const x = code(c)
  return (x >= 65 && x <= 90) || (x >= 97 && x <= 122)
}

/**
 * `[0-9]`
 *
 * @since 0.1.0
 * @category predicates
 */
export const isDigit = (c: string | number): boolean => {
  const x = code(c)
  return x >= 48 && x <= 57
}

/**
 * `[0-9a-fA-F]`
 *
 * @since 0.1.0
 * @category predicates
 */
export const isHexDigit = (c: string | number): boolean => {
  const x = code(c)
  return (x >= 48 && x <= 57) || (x >= 65 && x <= 70) || (x >= 97 && x <= 102)
}

/**
 * `[0-7]`
 *
 * @since 0.1.0
 * @category predicates
 */
export const isOctDigit = (c: string | number): boolean => {
  const x = code(c)
  return x >= 48 && x <= 55
}

/**
 * `[0-9a-zA-Z]`
 *
 * @since 0.1.0
 * @category predicates
 */
export const isAlphanumeric = (c: string | number): boolean => isAlpha(c) || isDigit(c)

/**
 * `[ \t]`
 *
 * @since 0.1.0
 * @category predicates
 */
export const isSpace = (c: string | number): boolean => {
  const x = code(c)
  return x === 32 || x === 9
}

/**
 * `[ \t\r\n]`
 *
 * @since 0.1.0
 * @category predicates
 */
export const isMultispace = (c: string | number): boolean => {
  const x = code(c)
  return x === 32 || x === 9 || x === 10 || x === 13
}

/**
 * `\n`
 *
 * @since 0.1.0
 * @category predicates
 */
export const isNewline = (c: string | number): boolean => code(c) === 10

// Token sets usable for both string and byte input
const alphaSet = [range("a", "z"), range("A", "Z")]
const digitSet = range("0", "9")
const hexSet = [range("0", "9"), range("a", "f"), range("A", "F")]
const octSet = range("0", "7")
const alnumSet = [range("a", "z"), range("A", "Z"), range("0", "9")]
const spaceSet = " \t"
const multispaceSet = " \t\r\n"

const cls = (set: unknown, min: 0 | 1, description: string, kind: ErrorKind, hint = true): Parser<string> =>
  takeWhileImpl<string>(set, { min }, false, `${kind.toLowerCase()}${min}`, description, kind, hint)

// -----------------------------------------------------------------------------
// Character classes
// -----------------------------------------------------------------------------

/**
 * Zero or more ASCII letters, `[a-zA-Z]*`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const alpha0: Parser<string> = cls(alphaSet, 0, "letter", "Alpha")

/**
 * One or more ASCII letters, `[a-zA-Z]+`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const alpha1: Parser<string> = cls(alphaSet, 1, "letter", "Alpha")

/**
 * Zero or more ASCII digits, `[0-9]*`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const digit0: Parser<string> = cls(digitSet, 0, "digit", "Digit")

/**
 * One or more ASCII digits, `[0-9]+`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const digit1: Parser<string> = cls(digitSet, 1, "digit", "Digit")

/**
 * Zero or more hexadecimal digits, `[0-9a-fA-F]*`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const hexDigit0: Parser<string> = cls(hexSet, 0, "hexadecimal digit", "HexDigit")

/**
 * One or more hexadecimal digits, `[0-9a-fA-F]+`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const hexDigit1: Parser<string> = cls(hexSet, 1, "hexadecimal digit", "HexDigit")

/**
 * Zero or more octal digits, `[0-7]*`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const octDigit0: Parser<string> = cls(octSet, 0, "octal digit", "OctDigit")

/**
 * One or more octal digits, `[0-7]+`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const octDigit1: Parser<string> = cls(octSet, 1, "octal digit", "OctDigit")

/**
 * Zero or more ASCII letters or digits, `[0-9a-zA-Z]*`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const alphanumeric0: Parser<string> = cls(alnumSet, 0, "letter or digit", "AlphaNumeric")

/**
 * One or more ASCII letters or digits, `[0-9a-zA-Z]+`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const alphanumeric1: Parser<string> = cls(alnumSet, 1, "letter or digit", "AlphaNumeric")

/**
 * Zero or more spaces and tabs, `[ \t]*`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const space0: Parser<string> = cls(spaceSet, 0, "space", "Space", false)

/**
 * One or more spaces and tabs, `[ \t]+`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const space1: Parser<string> = cls(spaceSet, 1, "space", "Space", false)

/**
 * Zero or more spaces, tabs, carriage returns and line feeds,
 * `[ \t\r\n]*`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const multispace0: Parser<string> = cls(multispaceSet, 0, "whitespace", "MultiSpace", false)

/**
 * One or more spaces, tabs, carriage returns and line feeds,
 * `[ \t\r\n]+`.
 *
 * @since 0.1.0
 * @category character classes
 */
export const multispace1: Parser<string> = cls(multispaceSet, 1, "whitespace", "MultiSpace", false)

// -----------------------------------------------------------------------------
// Line endings
// -----------------------------------------------------------------------------

/**
 * A carriage return followed by a line feed, `\r\n`.
 *
 * @since 0.1.0
 * @category line endings
 */
export const crlf: Parser<"\r\n"> = Token.literal("\r\n")

/**
 * A line feed, `\n` (nom's `newline`).
 *
 * @since 0.1.0
 * @category line endings
 */
export const newline: Parser<"\n"> = Token.literal("\n")

/**
 * A tab, `\t`.
 *
 * @since 0.1.0
 * @category line endings
 */
export const tab: Parser<"\t"> = Token.literal("\t")

/**
 * A line ending: `\n` or `\r\n`.
 *
 * @since 0.1.0
 * @category line endings
 */
export const lineEnding: Parser<"\n" | "\r\n"> = P.alt(newline, crlf).pipe(P.expected("line ending"))

const expectedLineEnding = ["line ending"]

/**
 * Everything up to (not including) a line ending, `[^\r\n]*` (winnow's
 * `till_line_ending`, nom's `not_line_ending`). A carriage return that is
 * not followed by a line feed is an error.
 *
 * @since 0.1.0
 * @category line endings
 */
export const tillLineEnding: Parser<string> = P.make<string>((state: State<any>) => {
  const start = state.pos
  const input = state.input
  const isString = state.inputKind === 0
  let i = start
  while (i < state.end) {
    const c = isString ? (input as string).charCodeAt(i) : (input as Uint8Array)[i]
    if (c === 10) break
    if (c === 13) {
      if (i + 1 >= state.end) {
        if (state.partial) return state.incomplete(1, expectedLineEnding)
        return state.backtrack("LineEnding", expectedLineEnding, i)
      }
      const d = isString ? (input as string).charCodeAt(i + 1) : (input as Uint8Array)[i + 1]
      if (d === 10) break
      return state.backtrack("LineEnding", expectedLineEnding, i)
    }
    i++
  }
  if (i >= state.end && state.partial) return state.incomplete(1, expectedLineEnding)
  state.pos = i
  return state.slice(start, i) as string
}, "tillLineEnding")

// -----------------------------------------------------------------------------
// Numbers
// -----------------------------------------------------------------------------

const toText = (s: Input): string =>
  typeof s === "string" ? s : s instanceof Uint8Array ? latin1.decode(s) : s.join("")

const latin1 = new TextDecoder("latin1")

const overflow = (value: number): Result.Result<number, string> =>
  Number.isSafeInteger(value) ? Result.succeed(value) : Result.fail("integer overflow")

/**
 * An unsigned decimal integer: one or more digits (winnow's `dec_uint`,
 * nom's `u32`/`u64`). Fails if the value is not a safe integer.
 *
 * @since 0.1.0
 * @category numbers
 */
export const decUint: Parser<number, string> = digit1.pipe(
  P.tryMap((s) => overflow(Number(toText(s)))),
  P.named("decUint")
)

/**
 * A signed decimal integer: an optional `+` or `-` followed by one or more
 * digits (winnow's `dec_int`, nom's `i32`/`i64`). Fails if the value is not
 * a safe integer.
 *
 * @since 0.1.0
 * @category numbers
 */
export const decInt: Parser<number, string> = P.taken(P.seq(P.opt(Token.oneOf("+-")), digit1)).pipe(
  P.tryMap((s) => overflow(Number(toText(s)))),
  P.named("decInt")
)

/**
 * An unsigned decimal integer as a `bigint`, of any size.
 *
 * @since 0.1.0
 * @category numbers
 */
export const decBigUint: Parser<bigint> = digit1.pipe(P.map((s) => BigInt(toText(s))))

/**
 * A signed decimal integer as a `bigint`, of any size.
 *
 * @since 0.1.0
 * @category numbers
 */
export const decBigInt: Parser<bigint> = P.taken(P.seq(P.opt(Token.oneOf("+-")), digit1)).pipe(
  P.map((s) => {
    const t = toText(s)
    return BigInt(t.startsWith("+") ? t.slice(1) : t)
  })
)

/**
 * A hexadecimal unsigned integer, without prefix (winnow's `hex_uint`, nom's
 * `hex_u32`). Fails if the value is not a safe integer.
 *
 * @since 0.1.0
 * @category numbers
 */
export const hexUint: Parser<number, string> = hexDigit1.pipe(
  P.tryMap((s) => overflow(parseInt(toText(s), 16))),
  P.named("hexUint")
)

const sign = P.opt(Token.oneOf("+-"))
const exponent = P.opt(P.seq(Token.oneOf("eE"), sign, digit1))
const unsignedFloat = P.alt(
  P.seq(literalImpl("inf", true), P.opt(literalImpl("inity", true))),
  P.seq(Token.literal("."), digit1, exponent),
  P.seq(digit1, P.opt(P.seq(Token.literal("."), P.opt(digit1))), exponent)
)
const floatText = P.taken(P.alt(
  literalImpl("nan", true),
  P.seq(sign, unsignedFloat)
)).pipe(P.expected("number")) as Parser<string>

const toFloat = (s: Input): number => {
  const t = toText(s).toLowerCase()
  const negative = t.startsWith("-")
  const body = t.startsWith("-") || t.startsWith("+") ? t.slice(1) : t
  if (body === "nan") return NaN
  if (body.startsWith("inf")) return negative ? -Infinity : Infinity
  return Number(t)
}

/**
 * A floating point number in decimal or scientific notation, including
 * `inf`, `infinity` and `nan` (case insensitive), as accepted by winnow's
 * `float` and nom's `double`.
 *
 * @example
 * ```ts
 * import { Ascii, Parser } from "effect-nom"
 *
 * Parser.parse(Ascii.float, "-1.5e3") // Result.succeed(-1500)
 * ```
 *
 * @since 0.1.0
 * @category numbers
 */
export const float: Parser<number> = floatText.pipe(P.map(toFloat), P.named("float"))

// -----------------------------------------------------------------------------
// Literals
// -----------------------------------------------------------------------------

/**
 * Matches a literal ignoring ASCII case (winnow's `Caseless`, nom's
 * `tag_no_case`). Returns the input as written.
 *
 * @since 0.1.0
 * @category literals
 */
export const caseless: {
  (literal: string): Parser<string>
  (literal: Uint8Array): Parser<Uint8Array, never, never, Uint8Array>
} = (lit: string | Uint8Array): any => literalImpl(lit, true)

// -----------------------------------------------------------------------------
// Escapes
// -----------------------------------------------------------------------------

const controlCode = (c: string | number): number => typeof c === "number" ? c : c.charCodeAt(0)

const atControl = (state: State<Input>, control: number): boolean => {
  if (state.pos >= state.end) return false
  const input = state.input
  const c = state.inputKind === 0 ? (input as string).charCodeAt(state.pos) : (input as Uint8Array)[state.pos]
  return c === control
}

/**
 * Recognizes a string containing escape sequences, returning the raw slice
 * (winnow's `take_escaped`, nom's `escaped`).
 *
 * - `normal` matches runs of ordinary characters (it must consume input)
 * - `control` is the escape character, e.g. `"\\"`
 * - `escapable` matches what may follow the control character
 *
 * @example
 * ```ts
 * import { Ascii, Parser, Token } from "effect-nom"
 *
 * const raw = Ascii.takeEscaped(Ascii.alpha1, "\\", Token.oneOf("\"n\\"))
 * Parser.parse(raw, "ab\\\"cd") // Result.succeed("ab\\\"cd")
 * ```
 *
 * @since 0.1.0
 * @category escapes
 */
export const takeEscaped = <A, E, R, I extends Input, B, E2, R2, I2 extends Input>(
  normal: Parser<A, E, R, I>,
  control: string | number,
  escapable: Parser<B, E2, R2, I2>
): Parser<Slice<I & I2>, E | E2, R | R2, I & I2> => {
  const ctrl = controlCode(control)
  const normalStep = normal.step
  const escStep = escapable.step
  return P.make((state: State<any>) => {
    const start = state.pos
    while (state.pos < state.end) {
      const before = state.pos
      const a = normalStep(state)
      if (a !== Fail) {
        if (state.pos === before) return state.failMessage("Cut", "Assert", "`takeEscaped` parsers must always consume")
        continue
      }
      if (state.mode !== "Backtrack") return Fail
      state.pos = before
      if (atControl(state, ctrl)) {
        state.pos++
        if (escStep(state) === Fail) return Fail
      } else {
        return state.slice(start, state.pos) as Slice<I & I2>
      }
    }
    if (state.partial) return state.incomplete(0)
    return state.slice(start, state.pos) as Slice<I & I2>
  }, "takeEscaped")
}

/**
 * Parses a string containing escape sequences, returning the *unescaped*
 * string (winnow's `escaped`, nom's `escaped_transform`).
 *
 * - `normal` matches runs of ordinary characters, returning them
 * - `control` is the escape character, e.g. `"\\"`
 * - `escape` parses what follows the control character, returning its
 *   replacement
 *
 * @example
 * ```ts
 * import { Ascii, Parser, Token } from "effect-nom"
 *
 * const unescaped = Ascii.escaped(
 *   Token.takeTill("\\\""),
 *   "\\",
 *   Parser.alt(
 *     Token.literal("n").pipe(Parser.as("\n")),
 *     Token.literal("\\"),
 *     Token.literal("\"")
 *   )
 * )
 * Parser.parse(unescaped, "a\\nb") // Result.succeed("a\nb")
 * ```
 *
 * @since 0.1.0
 * @category escapes
 */
export const escaped = <E, R, I extends Input, E2, R2, I2 extends Input>(
  normal: Parser<string, E, R, I>,
  control: string | number,
  escape: Parser<string, E2, R2, I2>
): Parser<string, E | E2, R | R2, I & I2> => {
  const ctrl = controlCode(control)
  const normalStep = normal.step
  const escStep = escape.step
  return P.make((state: State<any>) => {
    let out = ""
    while (state.pos < state.end) {
      const before = state.pos
      const a = normalStep(state)
      if (a !== Fail) {
        if (state.pos === before) {
          // `normal` matched nothing: fall through to the control character
          if (!atControl(state, ctrl)) return out
        } else {
          out += a
          continue
        }
      } else {
        if (state.mode !== "Backtrack") return Fail
        state.pos = before
      }
      if (atControl(state, ctrl)) {
        state.pos++
        const b = escStep(state)
        if (b === Fail) return Fail
        out += b
      } else {
        return out
      }
    }
    if (state.partial) return state.incomplete(0)
    return out
  }, "escaped")
}

// -----------------------------------------------------------------------------
// Byte views
// -----------------------------------------------------------------------------

type Bytes<P> = P extends Parser<infer A, infer E, infer R, infer _I> ? Parser<A extends string ? Uint8Array : A, E, R, Uint8Array>
  : never

/**
 * The parsers of this module, typed for `Uint8Array` input. Slices are
 * returned as `Uint8Array`s.
 *
 * @example
 * ```ts
 * import { Ascii, Parser, Token } from "effect-nom"
 *
 * const encode = (s: string) => new TextEncoder().encode(s)
 * const header = Parser.separatedPair(
 *   Ascii.bytes.alpha1,
 *   Token.literal(encode(": ")),
 *   Ascii.bytes.tillLineEnding
 * )
 * ```
 *
 * @since 0.1.0
 * @category byte views
 */
export const bytes: {
  readonly alpha0: Bytes<typeof alpha0>
  readonly alpha1: Bytes<typeof alpha1>
  readonly digit0: Bytes<typeof digit0>
  readonly digit1: Bytes<typeof digit1>
  readonly hexDigit0: Bytes<typeof hexDigit0>
  readonly hexDigit1: Bytes<typeof hexDigit1>
  readonly octDigit0: Bytes<typeof octDigit0>
  readonly octDigit1: Bytes<typeof octDigit1>
  readonly alphanumeric0: Bytes<typeof alphanumeric0>
  readonly alphanumeric1: Bytes<typeof alphanumeric1>
  readonly space0: Bytes<typeof space0>
  readonly space1: Bytes<typeof space1>
  readonly multispace0: Bytes<typeof multispace0>
  readonly multispace1: Bytes<typeof multispace1>
  readonly crlf: Parser<Uint8Array, never, never, Uint8Array>
  readonly newline: Parser<Uint8Array, never, never, Uint8Array>
  readonly tab: Parser<Uint8Array, never, never, Uint8Array>
  readonly lineEnding: Parser<Uint8Array, never, never, Uint8Array>
  readonly tillLineEnding: Bytes<typeof tillLineEnding>
  readonly decUint: Parser<number, string, never, Uint8Array>
  readonly decInt: Parser<number, string, never, Uint8Array>
  readonly decBigUint: Parser<bigint, never, never, Uint8Array>
  readonly decBigInt: Parser<bigint, never, never, Uint8Array>
  readonly hexUint: Parser<number, string, never, Uint8Array>
  readonly float: Parser<number, never, never, Uint8Array>
} = (() => {
  const lit = (s: string) => Token.literal(new TextEncoder().encode(s))
  const crlfB = lit("\r\n")
  const newlineB = lit("\n")
  return {
    alpha0,
    alpha1,
    digit0,
    digit1,
    hexDigit0,
    hexDigit1,
    octDigit0,
    octDigit1,
    alphanumeric0,
    alphanumeric1,
    space0,
    space1,
    multispace0,
    multispace1,
    crlf: crlfB,
    newline: newlineB,
    tab: lit("\t"),
    lineEnding: P.alt(newlineB, crlfB).pipe(P.expected("line ending")),
    tillLineEnding,
    decUint,
    decInt,
    decBigUint,
    decBigInt,
    hexUint,
    float
  } as any
})()

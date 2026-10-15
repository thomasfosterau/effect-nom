# effect-nom

Parser combinators for [Effect](https://effect.website), ported from Rust's
[nom](https://github.com/rust-bakery/nom) and
[winnow](https://github.com/winnow-rs/winnow).

effect-nom keeps the core model of nom and winnow: small parsers composed
into larger ones; `Backtrack` / `Cut` / `Incomplete` error modes; one set of
parsers for both complete and streaming input; text, bytes, bits and token
streams. On top of that it follows Effect's conventions:

- pipeable, dual (data-first or data-last) combinators
- generator syntax with `Parser.gen`
- typed user errors in the `E` channel, and `ParseError` as a `Data.TaggedError`
- dependency injection with `Context` services in the `R` channel
- `Option`, `Result`, `Effect`, `Stream` and `Schema` integration

```ts
import { Ascii, Parser, Token } from "effect-nom"

const point = Parser.gen(function*() {
  yield* Token.literal("(")
  const x = yield* Ascii.decInt
  yield* Token.literal(",")
  const y = yield* Ascii.decInt
  yield* Token.literal(")")
  return { x, y }
})

Parser.parse(point, "(1,-2)")
// Result.succeed({ x: 1, y: -2 })

Parser.parse(point, "(1;-2)")
// Result.fail(ParseError):
//   Parse error at line 1, column 3:
//   1 | (1;-2)
//     |   ^
//   expected digit or ",", found ";"
```

## Installation

```sh
pnpm add effect-nom effect
```

effect-nom requires `effect` 4.x as a peer dependency.

## Contents

- [The `Parser` type](#the-parser-type)
- [Writing parsers](#writing-parsers)
- [Running parsers](#running-parsers)
- [Errors](#errors)
- [Streaming and partial input](#streaming-and-partial-input)
- [Services](#services)
- [Modules](#modules)
- [Coming from nom or winnow](#coming-from-nom-or-winnow)
- [Examples](#examples)
- [Design](#design)

## The `Parser` type

```ts
interface Parser<A, E = never, R = never, I extends Input = string>
```

| Parameter | Meaning |
|---|---|
| `A` | the value produced |
| `E` | the type of user errors (see [Errors](#errors)); `never` for pure syntax |
| `R` | the services required (see [Services](#services)) |
| `I` | the input: `string` (the default), `Uint8Array`, or `ReadonlyArray<T>` |

Like winnow, a parser is a function over a mutable cursor. Failing is cheap,
and backtracking means resetting an offset. String tokens are Unicode code
points, `Uint8Array` tokens are bytes, and array tokens are elements, which
is useful for parsing the output of a lexer.

## Writing parsers

There are three styles, and they mix freely.

**Combinators**, data-first or piped:

```ts
import { Ascii, Parser, Token } from "effect-nom"

const keyValue = Parser.separatedPair(
  Ascii.alpha1,
  Parser.delimited(Ascii.space0, Token.literal("="), Ascii.space0),
  Ascii.decInt
)

const list = Parser.separated(Ascii.decInt, Token.literal(",")).pipe(
  Parser.map((ns) => ns.reduce((a, b) => a + b, 0)),
  Parser.context("list")
)
```

**Generators**, like `Effect.gen`:

```ts
const header = Parser.gen(function*() {
  const name = yield* Token.takeWhile(Ascii.isAlphanumeric, { min: 1 })
  yield* Token.literal(": ")
  const value = yield* Ascii.tillLineEnding
  yield* Ascii.lineEnding
  return { name, value }
})
```

**Records, tuples and Do notation**:

```ts
const version = Parser.struct({
  major: Ascii.decUint,
  minor: Parser.preceded(Token.literal("."), Ascii.decUint)
})

const range = Parser.Do.pipe(
  Parser.bind("start", () => Ascii.decUint),
  Parser.zipLeft(Token.literal("..")),
  Parser.bind("end", () => Ascii.decUint)
)
```

Recursive grammars use `Parser.suspend`:

```ts
type Tree = ReadonlyArray<Tree>
const tree: Parser.Parser<Tree> = Parser.delimited(
  Token.literal("["),
  Parser.separated(Parser.suspend(() => tree), Token.literal(",")),
  Token.literal("]")
)
```

Low-level parsers can be written directly against the cursor with
`Parser.make`, in the same way that any function can be a parser in winnow:

```ts
const upper = Parser.make<string>((state) => {
  const c = state.input.charCodeAt(state.pos)
  if (c >= 65 && c <= 90) {
    state.pos++
    return String.fromCharCode(c)
  }
  return state.atEnd() ? state.eoi("Token", ["uppercase letter"], 1) : state.backtrack("Token", ["uppercase letter"])
})
```

### Combinator overview

| Category | Combinators |
|---|---|
| Constructors | `succeed`, `sync`, `empty`, `fail`, `failMessage`, `reject`, `todo`, `suspend`, `make`, `location`, `eof` |
| Mapping | `map`, `as`, `asVoid`, `asSome`, `tap`, `tryMap`, `tryMapUnknown`, `filterMap`, `filter`, `filterOrFail`, `mapParser` |
| Sequencing | `seq`, `struct`, `zip`, `zipWith`, `zipLeft`, `zipRight`, `preceded`, `terminated`, `delimited`, `separatedPair`, `flatMap`, `gen`, `Do`/`bind`/`bindTo`/`let` |
| Choice | `alt`, `orElse`, `orElseSucceed`, `dispatch`, `permutation` |
| Repetition | `repeat`, `repeatTill`, `separated`, `separatedFoldl1`, `separatedFoldr1`, `fold` |
| Control | `opt`, `optional`, `cond`, `peek`, `not`, `allConsuming` |
| Consumed input | `taken`, `withTaken`, `span`, `withSpan` |
| Errors | `cut`, `backtrack`, `complete`, `context`, `expected`, `mapError`, `orFail` |
| Services | `service`, `provideService`, `provide` |
| Recovery | `resumeAfter`, `retryAfter` |
| Debugging | `trace`, `named` |

Repetition ranges follow winnow: `Parser.repeat(p)` matches zero or more
times, `Parser.repeat(p, 3)` exactly three times, and
`Parser.repeat(p, { min: 1, max: 4 })` between one and four times. When
`min` is a positive literal, the result is typed as a non-empty array.

## Running parsers

| Runner | Result |
|---|---|
| `Parser.parse(p, input)` | `Result<A, ParseError<E>>`; the whole input must be consumed |
| `Parser.parseSync(p, input)` | `A`; throws `ParseError<E>` |
| `Parser.parsePeek(p, input)` | `Result<[remaining, A], ParseError<E>>`, nom-style |
| `Parser.parsePartial(p, input)` | `Result<Done \| Incomplete, ParseError<E>>` for streaming input |
| `Parser.parseEffect(p, input)` | `Effect<A, ParseError<E>, R>`; services come from the Effect context |
| `Parser.parseRecoverable(p, input)` | `{ value: Option<A>, errors }` with error recovery enabled |
| `ParserStream.parseMany(p)` | `Stream<I> => Stream<A>` (see [Streaming](#streaming-and-partial-input)) |
| `ParserSchema.make(p)` | a `Schema` decoding strings with the parser |

## Errors

Failures have a mode, as in winnow:

- **Backtrack**: recoverable. `alt`, `opt`, `repeat` and friends try
  something else.
- **Cut**: unrecoverable. Use `Parser.cut(p)` once a branch is certain
  (e.g. after an opening `[`), so errors point at the real problem instead of
  backtracking to an unhelpful alternative.
- **Incomplete**: partial input ran out (see below).

`ParseError` is a `Data.TaggedError("ParseError")`. It records the
`offset`, `kind`, `expected` set, `context` labels and an optional typed
`cause`, and its `message` points at the problem:

```text
Parse error at line 1, column 4:
1 | [1,,2]
  |    ^
while parsing array
expected value, found ","
```

effect-nom tries hard to produce good messages without annotations:

- `alt` merges the expectations of failed branches:
  `expected "true", "false" or "null"`.
- Optional and repeated parsers leave *hints*, so after
  `repeat(digit)` a failure reads `expected digit or ")"`.
- The furthest failure wins (the PEG heuristic), so a value that fails
  after a separator is reported where it failed.
- `Parser.expected("value")` names a rule; `Parser.context("array")` adds
  "while parsing array".

User errors are typed. `Parser.fail(e)`, `Parser.tryMap(f)` and
`Parser.filterOrFail(pred, f)` add their error type to `E`, and the error
arrives as `ParseError.cause`:

```ts
class OutOfRange extends Data.TaggedError("OutOfRange")<{ value: number }> {}

const port = Ascii.decUint.pipe(
  Parser.filterOrFail((n) => n < 65536, (value) => new OutOfRange({ value }))
)
// Parser<number, string | OutOfRange>
```

## Streaming and partial input

nom has separate `streaming` and `complete` modules. winnow marks the input
as `Partial`. In effect-nom, partiality is decided by the runner, so every
parser works in both modes:

```ts
Parser.parsePartial(Ascii.digit1, "123")
// Result.succeed({ _tag: "Incomplete", needed: Option.some(1) })   -- more digits may follow
Parser.parsePartial(Ascii.digit1, "123;")
// Result.succeed({ _tag: "Done", value: "123", offset: 3 })
```

`ParserStream.parseMany` connects this to Effect streams. It buffers chunks,
retries on `Incomplete`, and parses the tail in complete mode when the stream
ends:

```ts
import { Effect, Stream } from "effect"
import { Ascii, Parser, ParserStream, Token } from "effect-nom"

const line = Parser.terminated(Ascii.decInt, Token.literal("\n"))

Stream.make("1\n2", "3\n", "4\n").pipe(ParserStream.parseMany(line), Stream.runCollect)
// Effect<[1, 23, 4], ParseError<string>>
```

## Services

Parsers can require Effect services. These replace winnow's `Stateful`
input: configuration, symbol tables, indentation stacks and so on.

```ts
import { Context, Effect } from "effect"

class Radix extends Context.Service<Radix, number>()("Radix") {}

const number = Parser.service(Radix).pipe(
  Parser.flatMap((radix) => Ascii.alphanumeric1.pipe(Parser.map((s) => parseInt(s, radix))))
)
// Parser<number, never, Radix>

Parser.parse(Parser.provideService(number, Radix, 16), "ff")      // 255
Parser.parseEffect(number, "777").pipe(Effect.provideService(Radix, 8)) // Effect<511>
```

## Modules

| Module | Contents | winnow / nom equivalent |
|---|---|---|
| `Parser` | the type, combinators, runners | `Parser` trait, `combinator` / `combinator`, `branch`, `multi`, `sequence` |
| `Token` | `any`, `literal`, `oneOf`, `noneOf`, `take`, `takeWhile`, `takeTill`, `takeUntil`, `rest`, `range` | `token` / `bytes` |
| `Ascii` | character classes, `lineEnding`, `decInt`, `decUint`, `hexUint`, `float`, `caseless`, `takeEscaped`, `escaped`, `Ascii.bytes.*` | `ascii` / `character`, `number` |
| `Binary` | `u8`, `beU16` … `leI128`, floats, `lengthTake`, `lengthRepeat`, `lengthAndThen` | `binary` / `number`, `multi::length_*` |
| `Bits` | `bits`, `bytes`, `take`, `takeBig`, `pattern`, `bool` | `binary::bits` / `bits` |
| `Expression` | Pratt parser with prefix, postfix and infix operators | `combinator::expression` / `nom-language::precedence` |
| `ParseError` | the error type, `lineColumn`, `formatExpected` | `error` |
| `ParserStream` | `parseMany`, `parseAll` over Effect `Stream`s | `Partial` / `streaming` |
| `ParserSchema` | `make`: a `Schema` from a parser | — |
| `Nom` | nom names and argument orders (`tag`, `many0`, `separatedList1`, `mapRes`, …) | nom |
| `Input` | input types and the `State` cursor for `Parser.make` | `stream` |

Token parsers that cannot infer their input type take a type argument that
defaults to `string`, like a Rust turbofish:

```ts
Token.take(4)              // Parser<string>
Token.take<Uint8Array>(4)  // Parser<Uint8Array, never, never, Uint8Array>
Token.oneOf<ReadonlyArray<Tok>>((t) => t.kind === "Number")
```

## Coming from nom or winnow

| nom | winnow | effect-nom |
|---|---|---|
| `tag("x")` | `"x"`, `literal("x")` | `Token.literal("x")` |
| `char('x')` | `'x'` | `Token.literal("x")` |
| `alt((a, b))` | `alt((a, b))` | `Parser.alt(a, b)` |
| `(a, b)` / `tuple` | `(a, b)` | `Parser.seq(a, b)` |
| — | `seq!(S { a: .., b: .. })` | `Parser.struct({ a, b })` |
| `many0(p)` | `repeat(0.., p)` | `Parser.repeat(p)` |
| `many1(p)` | `repeat(1.., p)` | `Parser.repeat(p, { min: 1 })` |
| `count(p, n)` | `repeat(n, p)` | `Parser.repeat(p, n)` |
| `separated_list0(s, p)` | `separated(0.., p, s)` | `Parser.separated(p, s)` |
| `fold_many0(p, i, f)` | `repeat(0.., p).fold(i, f)` | `Parser.fold(p, { init, f })` |
| `many_till(p, e)` | `repeat_till(0.., p, e)` | `Parser.repeatTill(p, e)` |
| `take_while1(f)` | `take_while(1.., f)` | `Token.takeWhile(f, { min: 1 })` |
| `map(p, f)` | `p.map(f)` | `Parser.map(p, f)` / `p.pipe(Parser.map(f))` |
| `map_res(p, f)` | `p.try_map(f)` | `Parser.tryMap(p, f)` (`f` returns a `Result`) |
| `map_opt(p, f)` | `p.verify_map(f)` | `Parser.filterMap(p, f)` (`f` returns an `Option`) |
| `verify(p, f)` | `p.verify(f)` | `Parser.filter(p, f)` |
| `value(v, p)` | `p.value(v)` | `Parser.as(p, v)` |
| `recognize(p)` | `p.take()` | `Parser.taken(p)` |
| `consumed(p)` | `p.with_taken()` | `Parser.withTaken(p)` |
| `map_parser(p, q)` | `p.and_then(q)` | `Parser.mapParser(p, q)` |
| `flat_map(p, f)` | `p.flat_map(f)` | `Parser.flatMap(p, f)` |
| `cut(p)` | `cut_err(p)` | `Parser.cut(p)` |
| `context("x", p)` | `p.context(StrContext::Label("x"))` | `Parser.context(p, "x")` |
| `complete(p)` | `p.complete_err()` | `Parser.complete(p)` |
| `IResult` | `parse_peek` | `Parser.parsePeek` |
| `streaming::*` | `Partial<I>` | `Parser.parsePartial`, `ParserStream` |
| — | `dispatch!` | `Parser.dispatch(selector, cases)` |
| — | `Stateful<I, S>` | `Parser.service` + Effect `Context` |
| — | `LocatingSlice` | `Parser.span`, `Parser.withSpan`, `Parser.location` |
| — | `resume_after` | `Parser.resumeAfter` + `Parser.parseRecoverable` |

The `Nom` module provides the nom names directly, with nom's argument
orders, for mechanical ports.

## Examples

[`examples/`](examples) contains ports of winnow's examples, each with tests
in [`test/examples.test.ts`](test/examples.test.ts):

- [`json.ts`](examples/json.ts): JSON with `dispatch`, `cut` and escapes
- [`arithmetic.ts`](examples/arithmetic.ts): direct evaluation, an AST via
  the Pratt parser, and a lexer plus a parser over the token array
- [`ini.ts`](examples/ini.ts): INI files with a generator-style parser
- [`http.ts`](examples/http.ts): HTTP requests over bytes, complete and
  streamed
- [`sexpr.ts`](examples/sexpr.ts): s-expressions with typed evaluation
  errors

`pnpm build && pnpm bench` compares the JSON example with `JSON.parse`.

## Design

[`docs/DESIGN.md`](docs/DESIGN.md) records the research into nom, winnow and
Effect, and the reasoning behind each decision in this port.

## Development

```sh
pnpm install
pnpm check   # type-check sources, tests and examples
pnpm test    # run the test suite
pnpm build   # emit dist/
```

## License

MIT

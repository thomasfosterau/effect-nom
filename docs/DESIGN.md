# effect-nom design

This document records the research behind effect-nom and the plan used to
build it. effect-nom is a port of two Rust parser-combinator libraries,
[nom](https://github.com/rust-bakery/nom) (8.x) and
[winnow](https://github.com/winnow-rs/winnow) (0.7.x), to TypeScript, written
in the style of [Effect](https://effect.website) 4.

## 1. What the source libraries look like

### nom 8

- A parser is anything implementing `Parser<I>`, with
  `process(input) -> IResult<I, O, E>`. Input goes in by value and comes back
  as the remaining input, so `IResult<I, O, E> = Result<(I, O), Err<E>>`.
- `Err<E>` has three modes: `Error` (recoverable, so `alt` tries the next
  branch), `Failure` (unrecoverable, produced by `cut`), and
  `Incomplete(Needed)` (streaming input ran out).
- Modules come in pairs, `bytes::{complete, streaming}` and
  `character::{complete, streaming}`. The streaming variants return
  `Incomplete` at end of input.
- Error types are pluggable through the `ParseError<I>` trait (`error::Error`
  holds `(input, ErrorKind)`, and `VerboseError` holds a context stack).
- Naming: `tag`, `char`, `many0`/`many1`, `separated_list0`, `map_res`,
  `recognize`, `consumed`, `value`, `pair`, `tuple`, `count`, and so on.

### winnow 0.7

winnow forked from nom and changed a few things that matter here:

- `Parser<I, O, E>::parse_next(&mut I) -> Result<O, E>`. The input is a
  **mutable cursor** that parsers advance, and alternatives rewind it with
  `checkpoint`/`reset`. Plain functions/closures are parsers.
- `ErrMode<E>` = `Backtrack | Cut | Incomplete(Needed)`.
- Instead of separate streaming modules, the *input type* says whether it is
  streaming: `Partial<I>`. One set of parsers handles both cases.
- Stream wrappers add features: `LocatingSlice` (spans), `Stateful<I, S>`
  (user state), `Recoverable` (error recovery), `Bytes`, `BStr`, and
  `TokenSlice` (parsing a lexer's tokens).
- `ContextError` collects `StrContext::{Label, Expected}` context and an
  optional external `cause`. `ParseError` renders the input with a caret.
- Parser methods: `map`, `try_map`, `verify_map`, `verify`, `value`,
  `default_value`, `void`, `take` (recognize), `with_taken`, `span`,
  `with_span`, `flat_map`, `and_then`, `parse_to`, `context`,
  `complete_err`, `retry_after`, `resume_after`.
- Combinators: `alt`, `dispatch!`, `permutation`, `seq!`, `preceded`,
  `terminated`, `delimited`, `separated_pair`, `repeat(range, p)`,
  `repeat_till`, `separated`, `separated_foldl1/foldr1`, `fold`, `opt`,
  `cond`, `peek`, `not`, `eof`, `cut_err`, `backtrack_err`, `empty`, `fail`,
  `trace`.
- Modules: `token` (`any`, `literal`, `one_of`, `none_of`, `take`,
  `take_while(range, set)`, `take_till`, `take_until`, `rest`), `ascii`
  (character classes, `dec_int`, `dec_uint`, `hex_uint`, `float`, escaping,
  `Caseless`), and `binary` (endian numbers, `length_*`, `bits`).
- `repeat` and `separated` treat a parser that succeeds without consuming
  input as a bug, and fail with an assertion error instead of looping
  forever.

### What Effect 4 brings

- Pipeable data types with **dual** APIs: `Parser.map(p, f)` and
  `p.pipe(Parser.map(f))` both work.
- Generator syntax (`Effect.gen`), where `yield*` unwraps values.
- Typed error channels, `Data.TaggedError` (errors that can be yielded
  inside `Effect.gen`), `Option`, and `Result`.
- `Context` services and requirements (`R`).
- `Stream` for incremental input, and `Schema` for decoding.

## 2. Synthesis: decisions

| Topic | nom | winnow | effect-nom |
|---|---|---|---|
| Parser signature | `I -> Result<(I, O), Err<E>>` | `&mut I -> Result<O, ErrMode<E>>` | Mutable cursor like winnow (`(state) => A \| Fail`), for speed and cheap backtracking |
| Type | `impl Parser<I>` | `impl Parser<I, O, E>` | `Parser<A, E = never, R = never, I = string>`, ordered like Effect's `Effect<A, E, R>` with the input type last |
| Error modes | Error / Failure / Incomplete | Backtrack / Cut / Incomplete | Backtrack / Cut / Incomplete (winnow names) |
| Streaming | separate `streaming` modules | `Partial<I>` input | `partial` flag on the parse state; `Parser.parsePartial` and the `ParserStream` module, which works over Effect `Stream`s |
| Error type | pluggable trait | pluggable trait (`ContextError` by default) | One rich `ParseError<E>` (`Data.TaggedError`) with offset, kind, expected set, context labels, and a typed `cause: E` for user errors |
| Custom errors | `FromExternalError` | `FromExternalError`, `cause` | Typed through the `E` channel: `Parser.fail(e)`, `Parser.tryMap(f)` |
| User state | none | `Stateful<I, S>` | Effect `Context` services in `R`: `Parser.service(Tag)` and `Parser.provideService`; `parseEffect` takes them from the running Effect |
| Spans | `nom_locate` crate | `LocatingSlice` | Offsets are always absolute: `Parser.span`, `Parser.withSpan`, `Parser.location` |
| Recovery | none | `Recoverable` + `resume_after` / `retry_after` | `Parser.resumeAfter` / `Parser.retryAfter` + `Parser.parseRecoverable` |
| Sequencing | tuples, `pair` | tuples, `seq!` | `Parser.seq(...)` (tuple), `Parser.struct({...})`, `Parser.gen(function*(){})`, and Do notation |
| Repetition | `many0`, `many1`, `many_m_n`, `count`... | `repeat(range, p)` | `Parser.repeat(p, range)` with `range = number \| { min?, max? }`. The result is typed `NonEmptyArray` when `min` is a positive literal |
| Names | snake_case nom names | snake_case winnow names | camelCase winnow names in the main API; nom names in the `Nom` module |
| Expressions | `nom-language::precedence` | `separated_foldl1` | Both: `Parser.separatedFoldl1/r1` and an `Expression.precedence` Pratt parser |
| Debugging | `dbg_dmp` | `trace` | `Parser.trace(name, p)` plus a `trace` option on `parse` |

### Inputs and tokens

`Input = string | Uint8Array | ReadonlyArray<unknown>`. These map to winnow's
`&str`, `&[u8]`, and `TokenSlice<T>`:

| Input | Token | Slice |
|---|---|---|
| `string` | `string` (one Unicode code point) | `string` |
| `Uint8Array` | `number` (byte) | `Uint8Array` (a `subarray` view, no copy) |
| `ReadonlyArray<T>` | `T` | `ReadonlyArray<T>` |

Offsets are UTF-16 code-unit indices for strings, byte indices for
`Uint8Array`, and element indices for arrays.

When a token parser could work on several input kinds, it takes a type
parameter that defaults to `string`, much like Rust's turbofish:
`Token.take<Uint8Array>(4)`. When the input kind can be inferred from an
argument (`Token.literal(new Uint8Array([1]))`), it is. The `Binary` module
is typed for bytes only.

### Text and encodings

nom and winnow parse `&str` and `&[u8]`, and their character parsers are
ASCII. effect-nom adds a `Text` module for Unicode text in any encoding.

**One implementation, many encodings.** An `Encoding` is a small record:
`decode(input, offset, end)` returns a code point, *malformed* (-1) or
*truncated* (-2), and there are also `width`, `encode` and `text` (slice to
string). `Text.make(encoding)` builds every text parser from one generic
implementation, and returns a `TextParsers<I>` record. Grammars written
against that record parse JavaScript strings, UTF-8, UTF-16LE/BE and
Latin-1 unchanged, and users can add encodings. The parsers are a record of
values rather than functions with an encoding argument, so they are built
once per encoding and the encoding never appears in a hot loop's call
signature.

**Why not parse bytes everywhere?** An obvious design would be to encode
strings to UTF-8 with `TextEncoder` and parse only bytes. We measured it on
V8 with a 0.5 MB document:

| Operation | Time |
|---|---|
| `TextEncoder.encode` of the whole document | 0.9 ms |
| scanning digits, string (`charCodeAt`) | 1.25 ms |
| scanning digits, bytes | 0.53 ms |
| 37k slices with `String.prototype.slice` | 0.7 ms |
| 37k slices with `TextDecoder.decode(subarray)` | 5.0 ms |
| 37k slices built with `String.fromCharCode` | 2.9 ms |

Scanning bytes is faster, but text parsers mostly *produce strings*, and
building a string from bytes costs 4–7 times more than slicing a string. It
would also turn string offsets into byte offsets, which would break spans,
error columns and `Parser.location`. So strings are parsed natively, as
UTF-16 code units, and only byte inputs are decoded. Short slices of bytes
are built by hand (that beats `TextDecoder`'s fixed cost below about 24
bytes), and longer ones use `TextDecoder`. With the JSON grammar (best of
interleaved runs), `Text.string` was 5–15% slower than the hand-written
`Token`/`Ascii` parser, and `Text.utf8` on bytes was within about 10% of
`TextDecoder` followed by `Text.string`. The generic scan loop, which calls
through the encoding and predicate, accounts for most of the difference.

**Fast paths.** The scan loop skips `decode` for units that are known to be
single-unit code points: below 0xD800 for strings, below 0x80 for UTF-8 and
0x100 for Latin-1. Unicode predicates (`Text.isLetter`, built on regular
expression property escapes) cache their answers for the BMP in a lazily
allocated table. They are marked as *code-point predicates*, so `Token` and
`Text` call them with numbers instead of allocating a string per character.
This also applies to the `Ascii` predicates.

**Strictness.** Text parsers never match malformed input: invalid UTF-8,
overlong forms, surrogates encoded in UTF-8, and unpaired UTF-16
surrogates. On partial input, a sequence cut off at the end reports
`Incomplete`, so byte streams can be parsed as text chunk by chunk. `Token`
keeps its lenient handling of lone surrogates in strings.

**Errors.** `Text` parsers on byte input record their encoding on the
`State`, and the runners copy it to `ParseError.encoding`. The error message
then decodes the line (replacing malformed bytes with U+FFFD) and reports
the line and column in code points, plus the byte offset.

### Error model

Internally a failure stores a small error record on the parse state, then
returns a unique `Fail` sentinel. Successful steps allocate nothing for
errors.

```
mode:     Backtrack | Cut | Incomplete
offset:   where it failed
kind:     ErrorKind (nom-style: "Literal", "Digit", "Verify", "Eof", ...)
expected: ReadonlyArray<string>   (rendered alternatives: `"abc"`, `digit`, ...)
context:  ReadonlyArray<string>   (labels from Parser.context, innermost first)
cause:    E | undefined           (user error)
needed:   number | undefined      (Incomplete)
```

`alt` merges branch errors with the *furthest failure wins* rule. When
branches fail at the same offset, their `expected` sets are combined. That
gives messages like `expected one of "true", "false", "null"` without any
annotation, which is better than both nom and winnow out of the box (each
keeps only one branch's error).

`Parser.expected(desc)` replaces the expected set when a parser fails without
consuming input (Parsec's `<?>`). `Parser.context(label)` adds a context
label (winnow `StrContext::Label`, nom `context`).

The public `ParseError<E>` extends `Data.TaggedError("ParseError")`. It can
be yielded in `Effect.gen`, and its `message` renders like this:

```
Parse error at line 1, column 3:
1 | [1,,2]
  |    ^
expected value
```

## 3. Module plan

| Module | Contents |
|---|---|
| `Parser` | Core type, constructors (`make`, `succeed`, `sync`, `fail`, `reject`, `empty`, `suspend`, `todo`), mapping (`map`, `as`, `asVoid`, `tap`, `flatMap`, `mapParser`, `tryMap`, `filterMap`, `filter`), consumption (`taken`, `withTaken`, `span`, `withSpan`, `location`), errors (`cut`, `backtrack`, `complete`, `context`, `expected`, `mapError`, `catch`-style `orElse`), control (`opt`, `cond`, `peek`, `not`, `eof`, `allConsuming`), sequencing (`seq`, `struct`, `zip`, `zipWith`, `preceded`, `terminated`, `delimited`, `separatedPair`, `gen`, `Do`/`bind`/`bindTo`/`let`), choice (`alt`, `dispatch`, `permutation`), repetition (`repeat`, `repeatTill`, `separated`, `separatedFoldl1`, `separatedFoldr1`, `fold`), services (`service`, `serviceWith`, `provide`, `provideService`), recovery (`resumeAfter`, `retryAfter`), debugging (`trace`), and runners (`parse`, `parseSync`, `parsePeek`, `parsePartial`, `parseEffect`, `parseRecoverable`) |
| `ParseError` | `ParseError` class, `ErrorKind`, `Needed`, `lineColumn` |
| `Input` | Input/token/slice types, the `State` cursor used by `Parser.make` |
| `Token` | `any`, `literal`, `oneOf`, `noneOf`, `take`, `takeWhile`, `takeTill`, `takeUntil`, `rest`, `restLen`, and `TokenSet` (`string`, predicate, array, ranges) |
| `Ascii` | `digit0/1`, `alpha0/1`, `alphanumeric0/1`, `hexDigit0/1`, `octDigit0/1`, `space0/1`, `multispace0/1`, `crlf`, `lineEnding`, `newline`, `tab`, `tillLineEnding`, `decUint`, `decInt`, `hexUint`, `float`, `takeEscaped`, `escapedTransform`, `caseless`, character predicates, and an `Ascii.bytes` view for `Uint8Array` input |
| `Text` | `TextParsers<I>` built by `make(encoding)`, with `string`, `utf8`, `utf16le`, `utf16be` and `latin1` instances: tokens, slices, Unicode character classes, `identifier`, line endings, numbers and escapes; Unicode predicates and `property` |
| `Encoding` | The `Encoding` interface, the built-in encodings, and `sniff` (BOM detection) |
| `Binary` | `u8`, `i8`, `be*/le*` numbers (16/24/32 as `number`, 64/128 as `bigint`), floats, `lengthTake`, `lengthRepeat`, `lengthAndThen`, `bits` |
| `Bits` | Bit-level parsers inside `Binary.bits`: `take`, `pattern`, `bool`, `bytes` |
| `Expression` | Pratt / precedence-climbing expression parser (from `nom-language::precedence`) |
| `ParserStream` | Run a parser repeatedly over an Effect `Stream` of chunks (partial parsing) |
| `ParserSchema` | Build an Effect `Schema` that decodes a string with a parser |
| `Nom` | nom-named aliases: `tag`, `tagNoCase`, `char`, `many0`, `many1`, `manyMN`, `manyTill`, `count`, `separatedList0/1`, `foldMany0/1`, `mapRes`, `mapOpt`, `recognize`, `consumed`, `value`, `pair`, `tuple`, `isA`, `isNot`, `takeWhile1`, `takeWhileMN`, `takeTill1`, ... |

## 4. Implementation phases

1. Tooling (pnpm, TypeScript, vitest), the core runtime (state, error
   record, `Parser` prototype with pipe and iterator), and runners.
2. General combinators (Parser module) and their tests, ported from winnow
   and nom test suites.
3. `Token` and `Ascii`, including partial (streaming) semantics.
4. `Binary` and `Bits`.
5. `ParseError` rendering, `Expression`, recovery, and trace.
6. Effect integrations: `parseEffect`, services, `ParserStream`,
   `ParserSchema`.
7. `Nom` aliases. Worked examples ported from winnow's topics (JSON,
   arithmetic, INI, HTTP, s-expressions) as tests. README.

## 5. Deliberate differences from nom and winnow

- **`eof` on partial input** returns `Incomplete`. More data might still
  arrive, so end of input can't be confirmed yet. `ParserStream` makes a
  final pass in complete mode, which settles it.
- **Error reporting** uses three heuristics that nom and winnow don't have:
  merging expectations in `alt`, *hints* from parsers that stopped without
  failing, and *furthest failure*. The furthest heuristic may report a
  deeper failure from an abandoned branch instead of a shallower final one.
  It never overrides a failure that carries a user `cause` or message.
- **`resumeAfter` / `retryAfter`** run the recovery parser from the position
  where the failing parser *started*, not from where it failed.
- **`ParserStream.parseMany` error offsets** are relative to the buffer of
  input not yet consumed. That buffer is also the `input` of the
  `ParseError`.
- **The progress check** (a parser that succeeds without consuming input is
  rejected) applies only to unbounded repetitions. Bounded ones simply end.
- **Strings are parsed by code point.** A surrogate pair split across two
  partial chunks is reported as `Incomplete`. The same goes for a UTF-8 or
  UTF-16 sequence split across chunks of bytes parsed with `Text`.
- **Unicode text in any encoding** (`Text`, `Encoding`) has no equivalent
  in nom or winnow, whose character parsers are ASCII.

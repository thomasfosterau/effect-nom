/**
 * Differential tests: compiled parsers must give exactly the interpreter's
 * results, values and errors alike, on valid, invalid and truncated input.
 */
import { Context, Option, Result } from "effect"
import { describe, expect, it } from "vitest"
import * as Arithmetic from "../examples/arithmetic.js"
import * as Http from "../examples/http.js"
import * as Ini from "../examples/ini.js"
import * as Json from "../examples/json.js"
import { makeJson } from "../examples/json-text.js"
import * as Sexpr from "../examples/sexpr.js"
import type { Input } from "../src/index.js"
import { Ascii, Binary, Encoding, Expression, Parser, Text, Token } from "../src/index.js"
import { State } from "../src/Input.js"
import { Fail } from "../src/Input.js"
import * as Registry from "../src/internal/compiler/registry.js"

const backends = ["closure"] as const
type Backend = typeof backends[number]

// -----------------------------------------------------------------------------
// Harness
// -----------------------------------------------------------------------------

/** A deterministic PRNG (mulberry32). */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const errorFields = (e: any) => ({
  offset: e.offset,
  kind: e.kind,
  mode: e.mode,
  expected: e.expected,
  context: e.context,
  cause: e.cause,
  description: e.description,
  message: e.message
})

const outcome = (r: Result.Result<unknown, any>) =>
  Result.isSuccess(r) ? { ok: true, value: r.success } : { ok: false, error: errorFields(r.failure) }

const compiledCopy = new Map<string, Map<Parser.Parser.Any, Parser.Parser.Any>>()

/** A compiled twin of `p` (with the same description), leaving `p` interpreted. */
const twin = <P extends Parser.Parser.Any>(p: P, backend: Backend): P => {
  let byParser = compiledCopy.get(backend)
  if (byParser === undefined) compiledCopy.set(backend, byParser = new Map())
  let c = byParser.get(p)
  if (c === undefined) {
    c = Parser.compile(Parser.named(p, p.name ?? "root"), { backend })
    byParser.set(p, c)
  }
  return c as P
}

/** Runs the compiled step alone, to catch compiled failures that the fallback would hide. */
const fast = (p: Parser.Parser.Any, input: Input.Input, context?: Context.Context<any>) => {
  const state = new State(input, { context })
  const step = Registry.stepFor(p, state)!
  const kind = state.inputKind
  const compiled = Registry.compiled(p, kind)!
  if (compiled.error !== undefined) throw compiled.error
  const a = step(state)
  return a === Fail ? undefined : { value: a, pos: state.pos, end: state.end }
}

let checked = 0

/** Checks that `p` gives the same results compiled and interpreted on `input`. */
const same = (p: Parser.Parser.Any, input: Input.Input, context?: Context.Context<any>): void => {
  const options = context === undefined ? undefined : { context }
  const expected = outcome(Parser.parse(p, input as never, options as never))
  const expectedPeek = outcome(Parser.parsePeek(p, input as never, options as never))
  for (const backend of backends) {
    const c = twin(p, backend)
    const label = `${backend} on ${JSON.stringify(typeof input === "string" ? input : Array.from(input as any))}`
    expect(outcome(Parser.parse(c, input as never, options as never)), label).toEqual(expected)
    expect(outcome(Parser.parsePeek(c, input as never, options as never)), label).toEqual(expectedPeek)
    // The compiled step on its own succeeds exactly when the interpreter does
    const f = fast(c, input, context)
    expect(f !== undefined, `${label}: compiled success`).toBe(expectedPeek.ok)
    if (f !== undefined && expected.ok) expect(f.pos, label).toBe(f.end)
    checked++
  }
}

/** Random mutations of a valid input: deletions, insertions, replacements and truncations. */
const mutations = (doc: string, alphabet: string, count: number, seed: number): Array<string> => {
  const random = rng(seed)
  const chars = Array.from(alphabet)
  const out: Array<string> = []
  for (let i = 0; i < count; i++) {
    const at = Math.floor(random() * (doc.length + 1))
    const c = chars[Math.floor(random() * chars.length)]!
    switch (i % 4) {
      case 0:
        out.push(doc.slice(0, at) + doc.slice(at + 1))
        break
      case 1:
        out.push(doc.slice(0, at) + c + doc.slice(at))
        break
      case 2:
        out.push(doc.slice(0, at) + c + doc.slice(at + 1))
        break
      default:
        out.push(doc.slice(0, at))
    }
  }
  return out
}

/** Every string over `alphabet` up to length `max`. */
const allStrings = (alphabet: ReadonlyArray<string>, max: number): Array<string> => {
  const out: Array<string> = [""]
  let layer = [""]
  for (let n = 1; n <= max; n++) {
    layer = layer.flatMap((s) => alphabet.map((c) => s + c))
    out.push(...layer)
  }
  return out
}

// -----------------------------------------------------------------------------
// Generators
// -----------------------------------------------------------------------------

const randomJson = (random: () => number, depth = 0): string => {
  const ws = () => [" ", "", "\n  ", "\t", ""][Math.floor(random() * 5)]!
  const pick = random()
  if (depth > 3 || pick < 0.45) {
    const atoms = [
      () => String(Math.floor(random() * 2000) - 1000),
      () => (random() * 100).toFixed(3),
      () => `${Math.floor(random() * 9)}e${Math.floor(random() * 20) - 10}`,
      () => "-0.5E+3",
      () => "true",
      () => "false",
      () => "null",
      () => JSON.stringify(["abc", "é", "😀 x", "\"q\"", "\\", "\n\t", "\u0001", ""][Math.floor(random() * 8)]),
      () => "\"\\u00e9\\ud83d\\ude00\\/\\b\""
    ]
    return atoms[Math.floor(random() * atoms.length)]!()
  }
  const n = Math.floor(random() * 4)
  if (pick < 0.75) {
    return `[${ws()}${Array.from({ length: n }, () => randomJson(random, depth + 1)).join(`${ws()},${ws()}`)}${ws()}]`
  }
  const members = Array.from({ length: n }, (_, i) => `${JSON.stringify(`k${i}é`)}${ws()}:${ws()}${randomJson(random, depth + 1)}`)
  return `{${ws()}${members.join(`${ws()},${ws()}`)}${ws()}}`
}

const jsonAlphabet = "{}[],:\"\\0123456789.eE+-tfnulrsa \n\tuéx😀"

const jsonDocs = (() => {
  const random = rng(42)
  const docs = Array.from({ length: 40 }, () => ` ${randomJson(random)} `)
  docs.push("[1,,2]", "{\"a\": \"unterminated}", "\"\\x\"", "\"\\ud800\"", "\"\\ud800\\u0041\"", "1e999", "-", "nan", "inf")
  docs.push("[\"a\\u00\"]", "{\"a\" 1}", "[1 2]", "{,}", "", " ", "[", "\"\u0000\"", "0x10", "01", ".5", "5.", "-inf")
  return docs
})()

const jsonInputs = [
  ...jsonDocs,
  ...jsonDocs.slice(0, 20).flatMap((doc, i) => mutations(doc, jsonAlphabet, 12, i)),
  // Every prefix of a document exercises end-of-input handling
  ...(() => {
    const doc = "{\"a\": [1, -2.5e3, true, null, \"x\\n\\u00e9😀\"], \"b\": {}}"
    return Array.from({ length: doc.length + 1 }, (_, i) => doc.slice(0, i))
  })()
]

// -----------------------------------------------------------------------------
// Example grammars
// -----------------------------------------------------------------------------

describe("compiled examples", () => {
  it("json (Token/Ascii)", () => {
    for (const input of jsonInputs) same(Json.json, input)
  })

  it.each([
    ["Text.string", Text.string, (s: string) => s],
    ["Text.utf8", Text.utf8, (s: string) => Encoding.utf8.encode(s)],
    ["Text.utf16le", Text.utf16le, (s: string) => Encoding.utf16le.encode(s)],
    ["Text.utf16be", Text.utf16be, (s: string) => Encoding.utf16be.encode(s)]
  ] as const)("json-text with %s", (_, T, encode) => {
    const p = makeJson(T as Text.TextParsers<any>)
    for (const input of jsonInputs) same(p, (encode as (s: string) => Input.Input)(input))
  })

  it("json-text on malformed bytes", () => {
    const p = makeJson(Text.utf8)
    const random = rng(7)
    const base = Encoding.utf8.encode("[\"aé😀\", {\"k\": \"v\"}, 12]")
    for (let i = 0; i < 300; i++) {
      const bytes = base.slice()
      const at = Math.floor(random() * bytes.length)
      bytes[at] = [0x80, 0xc0, 0xe0, 0xed, 0xf0, 0xf5, 0xff, 0x22, 0x5c][i % 9]!
      same(p, bytes.subarray(0, i % 3 === 0 ? bytes.length : at + 1))
    }
    const latin = makeJson(Text.latin1)
    for (let b = 0; b < 256; b++) same(latin, new Uint8Array([0x22, b, 0x22]))
  })

  it("arithmetic", () => {
    const docs = ["3", " 12", " 2* 3  *2 *2 / 3", "12 + 6 - 4+  3", " 2* (  3 + 4 ) ", "  2*2 / ( 5 - 1) + 3", "-1 + 2", "(1 + 2", "1 +", "1 ++ 2"]
    const inputs = [...docs, ...docs.flatMap((d, i) => mutations(d, "0123456789+-*/() x", 15, 100 + i))]
    for (const input of inputs) {
      same(Arithmetic.evaluate, input)
      same(Arithmetic.ast, input)
      same(Arithmetic.lex, input)
      const lexed = Parser.parse(Arithmetic.lex, input)
      if (Result.isSuccess(lexed)) same(Arithmetic.tokens, lexed.success)
    }
  })

  it("ini", () => {
    const doc = "[owner]\nname=John Doe\norganization=Acme\n\n[database]\nserver=192.0.2.62\nport=143\n"
    const inputs = [doc, ...mutations(doc, "[]=\n abc", 120, 5), ...Array.from({ length: doc.length + 1 }, (_, i) => doc.slice(0, i))]
    for (const input of inputs) same(Ini.ini, input)
  })

  it("sexpr", () => {
    const docs = ["(+ 1 2)", "(if (= 1 1) (* 2 3) 4)", "((lambda x) 1)", "(- 10 #t)", "(+ 1", "  (* (+ 1 2) (- 5 3) ) "]
    const inputs = [...docs, ...docs.flatMap((d, i) => mutations(d, "()+-*/=# 0123456789iftx", 20, 200 + i))]
    for (const input of inputs) {
      same(Sexpr.expr, input)
      same(Sexpr.program, input)
    }
  })

  it("http", () => {
    const doc = "GET /index.html HTTP/1.1\r\nHost: example.com\r\nAccept: */*\r\n continued\r\n\r\n"
    const inputs = [doc, ...mutations(doc, "\r\n :/GETHP1.x", 150, 9), ...Array.from({ length: doc.length + 1 }, (_, i) => doc.slice(0, i))]
    for (const input of inputs) same(Http.request, new TextEncoder().encode(input))
  })
})

// -----------------------------------------------------------------------------
// Combinators, exhaustively on short inputs
// -----------------------------------------------------------------------------

const a = Token.literal("a")
const b = Token.literal("b")
const ab = Token.literal("ab")
const digit = Token.oneOf(Token.range("0", "9"))

const grammars: ReadonlyArray<readonly [string, Parser.Parser<any, any, never, string>]> = [
  ["alt with pruning", Parser.alt(a, b, ab, Parser.succeed("none"))],
  ["alt of shared prefixes", Parser.alt(ab, a, Parser.seq(b, a))],
  ["alt with cut", Parser.alt(Parser.preceded(a, Parser.cut(b)), Parser.seq(a, a), Token.any)],
  ["alt with backtrack", Parser.alt(Parser.backtrack(Parser.preceded(a, Parser.cut(b))), Parser.seq(a, a))],
  ["alt of optional", Parser.alt(Parser.opt(a), b)],
  ["opt and optional", Parser.seq(Parser.opt(a), Parser.optional(b), Parser.orElseSucceed(ab, () => 0))],
  ["peek and not", Parser.seq(Parser.peek(a), Parser.not(ab), Token.any, Parser.opt(Parser.not(b)))],
  ["repeat", Parser.repeat(Parser.alt(a, b))],
  ["repeat ranges", Parser.seq(Parser.repeat(a, { min: 1, max: 2 }), Parser.repeat(b, 2), Parser.repeat(Parser.alt(a, b), { max: 1 }))],
  ["repeat of nothing", Parser.repeat(Parser.opt(a))],
  ["fold of nothing", Parser.fold(Parser.opt(a), { init: () => 0, f: (n) => n + 1 })],
  ["repeat until", Parser.repeatTill(Parser.alt(a, b), Token.literal("bb"), { min: 1, max: 3 })],
  ["fold", Parser.fold(Parser.alt(a, b), { init: () => "", f: (acc, x) => acc + x.toUpperCase(), range: { min: 1 } })],
  ["separated", Parser.separated(Parser.alt(ab, a), b)],
  ["separated ranges", Parser.terminated(Parser.separated(a, b, { min: 2, max: 3 }), Parser.opt(b))],
  ["separated of nothing", Parser.separated(Parser.opt(a), Parser.opt(b))],
  ["separatedFoldl1", Parser.separatedFoldl1<string, never, never, string, string, never, never, string>(Parser.alt(a, b), Token.oneOf("+-"), (l, op, r) => `(${l}${op}${r})`)],
  ["separatedFoldr1", Parser.separatedFoldr1<string, never, never, string, string, never, never, string>(Parser.alt(a, b), Token.oneOf("+-"), (l, op, r) => `(${l}${op}${r})`)],
  ["taken and spans", Parser.seq(Parser.taken(Parser.repeat(a)), Parser.span(Parser.opt(b)), Parser.withTaken(Parser.opt(ab)), Parser.withSpan(Token.any))],
  ["map, filter and friends", Parser.alt(
    digit.pipe(Parser.map(Number), Parser.filter((n) => n % 2 === 0)),
    digit.pipe(Parser.tryMap((d) => d === "5" ? Result.fail("five") : Result.succeed(d + d))),
    digit.pipe(Parser.filterMap((d) => d === "3" ? Option.none() : Option.some(-d))),
    Token.any.pipe(Parser.filterOrFail((c) => c !== "x", () => "x!"))
  )],
  ["as, asVoid, zipWith", Parser.seq(Parser.as(a, 1), Parser.asVoid(Parser.opt(b)), Parser.zipWith(Parser.opt(a), Parser.opt(b), (x, y) => [y, x]))],
  ["struct", Parser.struct({ x: Parser.opt(a), y: Parser.repeat(b, { max: 2 }), z: Token.rest })],
  ["delimited and pairs", Parser.alt(Parser.delimited(a, Parser.repeat(digit), b), Parser.separatedPair(digit, Token.oneOf(":="), digit))],
  ["dispatch", Parser.dispatch(Token.any, { a: Parser.succeed(1), b: Parser.repeat(digit, { min: 1 }), "😀": Parser.succeed("smile") }, Parser.preceded(Parser.not(Parser.eof), Token.any))],
  ["dispatch on peek", Parser.dispatch(Parser.peek(Token.any), { a: ab, b: Parser.taken(Parser.repeat(b)) })],
  ["dispatch with a function", Parser.dispatch(digit, (d) => d === "0" ? undefined : Token.take(Number(d)))],
  ["flatMap", digit.pipe(Parser.flatMap((d) => Token.take(Number(d))))],
  ["eof, location, rest", Parser.seq(Parser.location, Parser.opt(a), Parser.location, Token.restLen, Parser.alt(Parser.eof, Parser.asVoid(Token.rest)))],
  ["cut and context", Parser.preceded(a, Parser.cut(Parser.context(Parser.expected(digit, "a digit"), "number")))],
  ["errors only", Parser.alt(Parser.mapError(Parser.fail("e"), (e) => e + "!"), Parser.orFail(ab, () => "no ab"), Parser.failMessage("m"))],
  ["todo and reject", Parser.alt(Parser.preceded(b, Parser.todo), Parser.reject, a)],
  ["complete", Parser.complete(Parser.repeat(a))],
  ["recovery outside parseRecoverable", Parser.seq(Parser.resumeAfter(a, b), Parser.retryAfter(Parser.opt(b), a))],
  ["trace", Parser.trace(Parser.repeat(Parser.alt(a, b)), "t")],
  ["suspend", (() => {
    const nested: Parser.Parser<unknown> = Parser.alt(Parser.delimited(a, Parser.repeat(Parser.suspend(() => nested)), b), digit)
    return nested
  })()],
  ["orElse", Parser.orElse(ab, () => Parser.repeat(a, { min: 1 }))],
  ["make and gen", Parser.seq(Parser.make((s) => s.pos < s.end ? s.input[s.pos++] : s.backtrack("Token")), Parser.gen(function*() {
    const x = yield* Parser.opt(a)
    return Option.isSome(x) ? yield* b : "-"
  }))],
  ["permutation", Parser.permutation(a, b, digit)],
  ["mapParser", Token.take(2).pipe(Parser.mapParser(Parser.repeat(a)))],
  ["expression", Expression.make({ operand: digit, operators: [Expression.prefix(Token.literal("-"), 3, (_, x) => `-${x}`), Expression.infixLeft(Token.literal("+"), 1, (l, _, r) => `(${l}+${r})`)] })],
  ["Token tokens", Parser.seq(Token.oneOf(["a", Token.range("0", "2"), (c: string) => c === "😀"]), Token.noneOf("ab"), Parser.opt(Token.take(2)))],
  ["Token slices", Parser.seq(Token.takeWhile("ab", { min: 1, max: 2 }), Token.takeTill("0", { max: 3 }), Parser.opt(Token.takeUntil("0", { min: 1 })))],
  ["takeTill with surrogates", Parser.seq(Token.takeTill("0", { min: 2, max: 3 }), Token.rest)],
  ["takeWhile with a string predicate", Token.takeWhile((c: string) => c !== "b" && c < "😀")],
  ["takeUntil", Parser.seq(Token.takeUntil("ab"), Token.rest)],
  ["literal edge cases", Parser.seq(Token.literal(""), Parser.opt(Token.literal("a😀")), Parser.opt(Ascii.caseless("Ab")))],
  ["Ascii numbers", Parser.separated(Parser.alt(Ascii.float, Ascii.hexUint), Token.literal(","))],
  ["Ascii integers", Parser.seq(Ascii.decInt, Parser.opt(Parser.preceded(Token.literal(":"), Ascii.decUint)))],
  ["Ascii classes", Parser.seq(Ascii.alpha0, Ascii.digit0, Ascii.space0, Parser.opt(Ascii.alphanumeric1), Parser.opt(Ascii.lineEnding))],
  ["Ascii escapes", Parser.seq(Ascii.escaped(Token.takeTill("\\\""), "\\", Parser.alt(Token.literal("n").pipe(Parser.as("\n")), Token.literal("\\"))), Parser.opt(Ascii.takeEscaped(Ascii.alpha1, "\\", Token.oneOf("an"))))],
  ["tillLineEnding", Parser.terminated(Ascii.tillLineEnding, Parser.opt(Ascii.lineEnding))]
]

const alphabet = ["a", "b", "0", "1", "+", "\\", "\"", "😀", "\ud800", "\n", "e", "."]

describe("compiled combinators", () => {
  // Every input up to 3 characters, and a sample of longer ones
  const inputs = (() => {
    const random = rng(1)
    const longer = Array.from({ length: 1500 }, () =>
      Array.from({ length: 4 + Math.floor(random() * 3) }, () => alphabet[Math.floor(random() * alphabet.length)]).join(""))
    return [...allStrings(alphabet, 3), ...longer]
  })()

  it.each(grammars)("%s", (_, p) => {
    for (const input of inputs) same(p, input)
  })

  // In void position (output unused) parsers compile differently
  it.each(grammars)("%s, output unused", (_, p) => {
    const unused = Parser.seq(Parser.taken(p), Parser.asVoid(Parser.opt(p)))
    for (const input of allStrings(alphabet, 3)) same(unused, input)
  })

  const textGrammars = (T: Text.TextParsers<any>, x = "😀") => [
    Parser.seq(T.any, Parser.opt(T.oneOf(`a${x}`)), Parser.opt(T.noneOf(["b", Token.range("0", "9")]))),
    Parser.seq(T.alpha0, T.digit0, Parser.opt(T.takeWhile("ab+", { min: 1, max: 2 })), Parser.opt(T.take(2))),
    Parser.seq(T.caseless("aé"), Parser.opt(T.literal(`${x}b`)), T.rest),
    Parser.seq(T.takeTill("\\\"", { max: 3 }), Parser.opt(T.takeUntil("0"))),
    Parser.seq(T.taken(Parser.repeat(Parser.alt(T.literal("a"), T.any))), Parser.opt(T.identifier)),
    Parser.seq(Parser.opt(T.decInt), Parser.opt(T.float), Parser.opt(T.hexUint), T.multispace0),
    Parser.seq(T.escaped(T.takeTill("\\\""), "\\", Parser.alt(T.literal("n").pipe(Parser.as("\n")), T.literal("\\"))), Parser.opt(T.takeEscaped(T.alpha1, "\\", T.oneOf("an")))),
    Parser.dispatch(T.any, { a: Parser.succeed(1), é: T.alpha1, [x]: Parser.succeed(3) }, T.any),
    Parser.seq(T.bom, Parser.alt(T.tillLineEnding, T.lineEnding))
  ]
  const textAlphabet = ["a", "b", "0", "é", "😀", "\\", "\"", "+", "\n", "\r", "\ufeff", "Ä"]

  it.each([
    ["Text.string", Text.string],
    ["Text.utf8", Text.utf8],
    ["Text.utf16le", Text.utf16le],
    ["Text.latin1", Text.latin1]
  ] as const)("%s parsers", (name, T) => {
    const inputs = allStrings(textAlphabet, 3)
    for (const p of textGrammars(T as Text.TextParsers<any>, name === "Text.latin1" ? "þ" : "😀")) {
      for (const input of inputs) {
        if (name === "Text.latin1" && /[^\u0000-\u00ff]/.test(input)) continue
        same(p, (T.encoding as Encoding.Encoding<any>).encode(input))
      }
      if (name !== "Text.string") {
        const random = rng(3)
        for (let i = 0; i < 200; i++) {
          same(p, Uint8Array.from({ length: Math.floor(random() * 6) }, () => [0x61, 0x30, 0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80, 0xff, 0x00, 0x5c][Math.floor(random() * 11)]!))
        }
      }
    }
  })

  it("byte inputs", () => {
    const bytes = Token.literal(new Uint8Array([1, 2]))
    const p = Parser.seq(
      Parser.opt(bytes),
      Parser.opt(Token.literal("ab") as any),
      Token.takeWhile<Uint8Array>([Token.range(0x30, 0x39), 1], { max: 3 }),
      Parser.opt(Ascii.caseless(new Uint8Array([0x41]))),
      Parser.opt(Ascii.bytes.decUint),
      Parser.alt(Binary.u8, Parser.eof)
    )
    const random = rng(11)
    for (let i = 0; i < 2000; i++) {
      same(p as any, Uint8Array.from({ length: Math.floor(random() * 7) }, () => [1, 2, 0x30, 0x39, 0x41, 0x61, 0x62, 0xff][Math.floor(random() * 8)]!))
    }
  })

  it("Text.taken validates what lenient parsers consumed", () => {
    const str = Parser.seq(Text.string.taken(Token.take(2)), Token.rest)
    for (const input of allStrings(["a", "\ud800", "\udc00", "😀"], 3)) same(str, input)
    const bytes = Parser.seq(Text.utf8.taken(Token.take<Uint8Array>(2)), Token.restOf<Uint8Array>())
    for (const input of allStrings(["a", "\xff", "\xc3", "\xa9"], 3)) {
      same(bytes, Uint8Array.from(input, (c) => c.charCodeAt(0)))
    }
  })

  it("array inputs", () => {
    const p = Parser.separated(Token.oneOf<ReadonlyArray<string>>(["x", "y"]), Token.literal(["+"]))
    for (const input of allStrings(["x", "y", "+", "z"], 5)) same(p as any, Array.from(input))
  })

  it("services", () => {
    class Limit extends Context.Service<Limit, number>()("Limit") {}
    const p = Parser.service(Limit).pipe(Parser.flatMap((n) => Parser.repeat(a, { max: n })))
    const q = Parser.seq(p, Parser.provideService(p, Limit, 1))
    for (const input of allStrings(["a", "b"], 5)) same(q, input, Context.make(Limit, 2))
  })

  it("checked many inputs", () => {
    expect(checked).toBeGreaterThan(200_000)
  })
})

// -----------------------------------------------------------------------------
// Behaviour of Parser.compile
// -----------------------------------------------------------------------------

describe("Parser.compile", () => {
  it("returns the same parser, and is pipeable", () => {
    const p = Parser.repeat(a)
    expect(Parser.compile(p)).toBe(p)
    expect(p.pipe(Parser.compile({ backend: "closure" }))).toBe(p)
  })

  it("re-runs the interpreter for errors, so callbacks may run twice", () => {
    let calls = 0
    const p = Parser.compile(Parser.terminated(digit.pipe(Parser.tap(() => calls++)), b), { backend: "closure" })
    expect(Result.isSuccess(Parser.parse(p, "1b"))).toBe(true)
    expect(calls).toBe(1)
    calls = 0
    const err = Parser.parse(p, "1c")
    expect(Result.isFailure(err)).toBe(true)
    expect(calls).toBe(2)
  })

  it("stays interpreted with tracing and recovery", () => {
    const events: Array<string> = []
    const p = Parser.compile(Parser.trace(Parser.resumeAfter(a, Token.any), "t"), { backend: "closure" })
    Parser.parse(p, "a", { trace: (e) => events.push(e._tag) })
    expect(events).toEqual(["Enter", "Exit"])
    const r = Parser.parseRecoverable(p, "x")
    expect(r.errors.length).toBe(1)
  })

  it("is safe to re-enter from a callback", () => {
    const inner = Parser.compile(Parser.repeat(digit), { backend: "closure" })
    const outer = Parser.compile(
      Parser.separated(Token.takeWhile("0123456789", { min: 1 }).pipe(Parser.map((s) => Parser.parseSync(inner, s).length)), b),
      { backend: "closure" }
    )
    expect(Parser.parseSync(outer, "12b345")).toEqual([2, 3])
  })

  it("reports what runs interpreted in the JSON grammar", () => {
    const p = twin(Json.json, "closure")
    Parser.parse(p, "1")
    const fallbacks = Registry.compiled(p, 0)!.fallbacks
    expect(fallbacks.map((f) => f.tag)).toEqual(["FlatMap"])
  })
})

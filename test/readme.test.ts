import { Context, Data, Effect, Option, Result, Stream } from "effect"
import { expect, it } from "vitest"
import { Ascii, Parser, ParserStream, Token } from "../src/index.js"

it("README examples behave as documented", () => {
  const point = Parser.gen(function*() {
    yield* Token.literal("(")
    const x = yield* Ascii.decInt
    yield* Token.literal(",")
    const y = yield* Ascii.decInt
    yield* Token.literal(")")
    return { x, y }
  })
  expect(Parser.parse(point, "(1,-2)")).toEqual(Result.succeed({ x: 1, y: -2 }))
  const r = Parser.parse(point, "(1;-2)")
  expect(Result.isFailure(r) && r.failure.message).toBe([
    "Parse error at line 1, column 3:",
    "1 | (1;-2)",
    "  |   ^",
    "expected digit or \",\", found \";\""
  ].join("\n"))

  expect(Parser.parsePartial(Ascii.digit1, "123")).toEqual(Result.succeed({ _tag: "Incomplete", needed: Option.some(1) }))

  class Radix extends Context.Service<Radix, number>()("Radix") {}
  const number = Parser.service(Radix).pipe(
    Parser.flatMap((radix) => Ascii.alphanumeric1.pipe(Parser.map((s) => parseInt(s, radix))))
  )
  expect(Parser.parseSync(Parser.provideService(number, Radix, 16), "ff")).toBe(255)
  expect(Effect.runSync(Parser.parseEffect(number, "777").pipe(Effect.provideService(Radix, 8)))).toBe(511)

  class OutOfRange extends Data.TaggedError("OutOfRange")<{ value: number }> {}
  const port: Parser.Parser<number, string | OutOfRange> = Ascii.decUint.pipe(
    Parser.filterOrFail((n) => n < 65536, (value) => new OutOfRange({ value }))
  )
  const e = Parser.parse(port, "70000")
  expect(Result.isFailure(e) && e.failure.cause).toBeInstanceOf(OutOfRange)

  const line = Parser.terminated(Ascii.decInt, Token.literal("\n"))
  expect(Effect.runSync(Stream.make("1\n2", "3\n", "4\n").pipe(ParserStream.parseMany(line), Stream.runCollect))).toEqual([1, 23, 4])

  type Tree = ReadonlyArray<Tree>
  const tree: Parser.Parser<Tree> = Parser.delimited(
    Token.literal("["),
    Parser.separated(Parser.suspend(() => tree), Token.literal(",")),
    Token.literal("]")
  )
  expect(Parser.parseSync(tree, "[[],[[]]]")).toEqual([[], [[]]])
  const upper = Parser.make<string>((state) => {
    const c = state.input.charCodeAt(state.pos)
    if (c >= 65 && c <= 90) {
      state.pos++
      return String.fromCharCode(c)
    }
    return state.atEnd() ? state.eoi("Token", ["uppercase letter"], 1) : state.backtrack("Token", ["uppercase letter"])
  })
  expect(Parser.parseSync(Parser.repeat(upper), "AB")).toEqual(["A", "B"])
})

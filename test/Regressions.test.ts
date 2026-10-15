import { Effect, Option, Result, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { Ascii, Expression, Parser, ParserStream, Token } from "../src/index.js"
import { expectFailure, expectSuccess, peek } from "./utils.js"

describe("regressions", () => {
  it("separated and repeatTill work data-last", () => {
    expectSuccess(Ascii.decInt.pipe(Parser.separated(Token.literal(","))), "1,2", [1, 2])
    expectSuccess(Ascii.decInt.pipe(Parser.separated(Token.literal(","), { min: 1 })), "1", [1])
    expectSuccess(Token.literal("a").pipe(Parser.repeatTill(Token.literal("b"))), "aab", [["a", "a"], "b"])
  })

  it("Expression rejects zero-width prefix/postfix operators", () => {
    const p = Expression.make({
      operand: Ascii.decInt,
      operators: [Expression.postfix(Parser.opt(Token.literal("!")), 2, (x: number) => x + 1)]
    })
    expect(expectFailure(p, "1").kind).toBe("Assert")
    const q = Expression.make({
      operand: Ascii.decInt,
      operators: [Expression.prefix(Parser.empty, 2, (_, x: number) => x)]
    })
    expect(expectFailure(q, "1").kind).toBe("Assert")
  })

  it("tillLineEnding rejects a trailing lone carriage return", () => {
    expect(Result.isFailure(Parser.parsePeek(Ascii.tillLineEnding, "ab\r"))).toBe(true)
  })

  it("surrogate pairs split across partial chunks are incomplete", () => {
    const incomplete = Result.succeed({ _tag: "Incomplete", needed: Option.some(1) })
    expect(Parser.parsePartial(Token.any, "\uD83D")).toEqual(incomplete)
    expect(Parser.parsePartial(Token.take(1), "\uD83D")).toEqual(incomplete)
    expect(Parser.parsePartial(Token.oneOf("😀"), "\uD83D")).toEqual(incomplete)
    expect(Parser.parsePartial(Token.takeWhile(() => true), "a\uD83D")).toEqual(incomplete)
    const program = Stream.fromIterable(["a\uD83D", "\uDE00b"]).pipe(ParserStream.parseMany(Token.any), Stream.runCollect)
    expect(Effect.runSync(program)).toEqual(["a", "😀", "b"])
  })

  it("takeUntil checks the range of the first occurrence (winnow semantics)", () => {
    expectFailure(Parser.allConsuming(Token.takeUntil("x", { min: 2 })), "axbx")
    expect(peek(Token.takeUntil("x", { min: 2 }), "abx")).toEqual(Result.succeed(["x", "ab"]))
  })

  it("peek does not leak hints", () => {
    const p = Parser.seq(Parser.peek(Ascii.digit1), Ascii.digit1, Token.literal(";"))
    expect(expectFailure(p, "1x").expected).toEqual(["digit", "\";\""])
  })

  it("mapParser translates offsets for slices that start after skipped input", () => {
    const p = Parser.preceded(Ascii.space0, Token.take(3)).pipe(Parser.mapParser(Parser.allConsuming(Ascii.digit1)))
    expect(expectFailure(p, "  12x").offset).toBe(4)
  })

  it("byte digits of any length", () => {
    const digits = new TextEncoder().encode("1".repeat(200_000))
    expect(Parser.parseSync(Ascii.bytes.decBigUint, digits) > 0n).toBe(true)
  })
})

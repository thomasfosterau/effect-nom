import { Effect, Result, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { Ascii, Binary, Input, Parser, ParserStream, Text, Token } from "../src/index.js"

const encode = (s: string) => new TextEncoder().encode(s)

describe("binary inputs", () => {
  it("fromSource views binary data as bytes without copying", () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer
    const view = Input.fromSource(buffer)
    expect(view).toBeInstanceOf(Uint8Array)
    expect(view.buffer).toBe(buffer)
    expect(Array.from(Input.fromSource(new DataView(buffer, 1, 2)) as Uint8Array)).toEqual([2, 3])
    expect(Array.from(Input.fromSource(new Uint16Array([0x0201])) as Uint8Array)).toEqual([1, 2])
    expect(Input.fromSource(new SharedArrayBuffer(3))).toHaveLength(3)
    // A view of a resizable buffer keeps the length it had when parsing started
    // (`resize` is ES2024, newer than this project's `lib`)
    const resizable: any = new (ArrayBuffer as any)(2, { maxByteLength: 8 })
    const fixed = Input.fromSource(resizable as ArrayBuffer)
    resizable.resize(6)
    expect(fixed).toHaveLength(2)
    // Other inputs are returned as they are
    const bytes = new Uint8Array(1)
    const tokens = [1, 2]
    expect(Input.fromSource(bytes)).toBe(bytes)
    expect(Input.fromSource(tokens)).toBe(tokens)
    expect(Input.fromSource("abc")).toBe("abc")
  })

  it("runners accept ArrayBuffers, typed arrays and DataViews for byte parsers", () => {
    const buffer = new Uint8Array([0x12, 0x34]).buffer
    expect(Parser.parse(Binary.beU16, buffer)).toEqual(Result.succeed(0x1234))
    expect(Parser.parseSync(Binary.leU16, new DataView(buffer))).toBe(0x3412)
    expect(Parser.parse(Ascii.bytes.decUint, encode("42").buffer)).toEqual(Result.succeed(42))
    expect(Parser.parsePeek(Binary.u8, buffer)).toEqual(Result.succeed([new Uint8Array([0x34]), 0x12]))
    expect(Parser.parsePartial(Binary.beU32, buffer)).toEqual(
      Result.succeed({ _tag: "Incomplete", needed: expect.anything() })
    )
    expect(Effect.runSync(Parser.parseEffect(Binary.beU16, buffer))).toBe(0x1234)
    expect(Parser.parseRecoverable(Binary.beU16, buffer).errors).toEqual([])
    const err = Parser.parse(Token.literal(new Uint8Array([0x12, 0x99])), buffer)
    expect(Result.isFailure(err) && err.failure.input).toEqual(new Uint8Array([0x12, 0x34]))
  })

  it("text parsers read binary data", () => {
    const text = "naïve café, ünïcödé text long enough for TextDecoder"
    const shared = new SharedArrayBuffer(encode(text).length)
    new Uint8Array(shared).set(encode(text))
    expect(Parser.parse(Text.utf8.rest, shared)).toEqual(Result.succeed(text))
    expect(Parser.parse(Text.utf8.rest, encode(text).buffer)).toEqual(Result.succeed(text))

    // A Uint16Array of UTF-16 code units, in the platform's (little endian) byte order
    const s = "héllo 😀"
    const units = Uint16Array.from({ length: s.length }, (_, i) => s.charCodeAt(i))
    expect(Parser.parse(Text.utf16le.rest, units)).toEqual(Result.succeed(s))

    const r = Parser.parse(Text.utf8.alpha1, encode("abc!").buffer)
    expect(Result.isFailure(r) && r.failure.message).toContain("1 | abc!")
  })

  it("strings and token arrays are not binary inputs", () => {
    // @ts-expect-error: a string parser does not accept binary data
    Parser.parse(Text.string.alpha1, new ArrayBuffer(1))
    // @ts-expect-error: neither does a parser over token arrays
    Parser.parse(Token.anyToken<ReadonlyArray<number>>(), new ArrayBuffer(1))
  })

  it("streams of binary chunks", () => {
    const chunks = [encode("αβ").buffer, new DataView(encode("γ\nδ").buffer), encode("\n")]
    const line = Parser.terminated(Text.utf8.alpha1, Text.utf8.newline)
    expect(Effect.runSync(Stream.fromIterable(chunks).pipe(ParserStream.parseMany(line), Stream.runCollect)))
      .toEqual(["αβγ", "δ"])
    expect(Effect.runSync(Stream.fromIterable(chunks).pipe(ParserStream.parseAll(Parser.repeat(line)))))
      .toEqual(["αβγ", "δ"])
  })
})

/**
 * A rough throughput benchmark: the JSON example parsers vs `JSON.parse`.
 *
 * `json.ts` uses the `Token` and `Ascii` parsers on a string. `json-text.ts`
 * is the same grammar written once against `Text.TextParsers`, run on a
 * string and on UTF-8 and UTF-16 encodings of the same document.
 *
 * Run with `pnpm build && pnpm bench`.
 */
import { Encoding, Parser, Text } from "effect-nom"
import { json } from "../examples/json.ts"
import { makeJson } from "../examples/json-text.ts"

const doc = JSON.stringify(
  Array.from({ length: 2000 }, (_, i) => ({
    id: i,
    name: `item ${i}`,
    label: `élément nº${i} — 項目 😀`,
    tags: ["a", "b", "c"],
    price: i * 1.25,
    active: i % 2 === 0,
    nested: { x: i, y: [1, 2, 3], z: null }
  })),
  null,
  2
)
const utf8 = new TextEncoder().encode(doc)
const utf16 = Encoding.utf16le.encode(doc)

const time = (name: string, f: () => unknown) => {
  for (let i = 0; i < 5; i++) f()
  const runs = 30
  const start = performance.now()
  for (let i = 0; i < runs; i++) f()
  const ms = (performance.now() - start) / runs
  const mbps = doc.length / 1e6 / (ms / 1000)
  console.log(`${name.padEnd(28)} ${ms.toFixed(2).padStart(8)} ms/parse  ${mbps.toFixed(1).padStart(7)} M chars/s`)
}

const jsonString = makeJson(Text.string)
const jsonUtf8 = makeJson(Text.utf8)
const jsonUtf16 = makeJson(Text.utf16le)
const decoder = new TextDecoder()

console.log(`document: ${(doc.length / 1e6).toFixed(2)} M chars, ${(utf8.length / 1e6).toFixed(2)} MB as UTF-8`)
time("Token/Ascii, string", () => Parser.parseSync(json, doc))
time("Text.string", () => Parser.parseSync(jsonString, doc))
time("Text.utf8", () => Parser.parseSync(jsonUtf8, utf8))
time("TextDecoder + Text.string", () => Parser.parseSync(jsonString, decoder.decode(utf8)))
time("Text.utf16le", () => Parser.parseSync(jsonUtf16, utf16))
time("JSON.parse", () => JSON.parse(doc))

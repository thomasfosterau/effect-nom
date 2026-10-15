/**
 * A rough throughput benchmark: the JSON example parser vs `JSON.parse`.
 *
 * Run with `pnpm build && pnpm bench`.
 */
import { Parser } from "effect-nom"
import { json } from "../examples/json.ts"

const doc = JSON.stringify(
  Array.from({ length: 2000 }, (_, i) => ({
    id: i,
    name: `item ${i}`,
    tags: ["a", "b", "c"],
    price: i * 1.25,
    active: i % 2 === 0,
    nested: { x: i, y: [1, 2, 3], z: null }
  })),
  null,
  2
)

const time = (name: string, f: () => unknown) => {
  for (let i = 0; i < 5; i++) f()
  const runs = 30
  const start = performance.now()
  for (let i = 0; i < runs; i++) f()
  const ms = (performance.now() - start) / runs
  const mbps = doc.length / 1e6 / (ms / 1000)
  console.log(`${name.padEnd(12)} ${ms.toFixed(2).padStart(8)} ms/parse  ${mbps.toFixed(1).padStart(7)} MB/s`)
}

console.log(`document: ${(doc.length / 1e6).toFixed(2)} MB`)
time("effect-nom", () => Parser.parseSync(json, doc))
time("JSON.parse", () => JSON.parse(doc))

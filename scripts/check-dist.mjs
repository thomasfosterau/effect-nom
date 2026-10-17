// Imports every entry in `exports` from the built `dist/`, by package name
// (Node resolves a package's own name through its `exports`), the way a
// consumer does. Fails when an entry is missing from `dist/`, a module throws
// at import, or a subpath stops exporting what the root namespace does.
import { readFile } from "node:fs/promises"

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const root = await import(pkg.name)
let failures = 0

for (const subpath of Object.keys(pkg.exports)) {
  if (subpath === "./package.json") continue
  const specifier = subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`
  try {
    const mod = await import(specifier)
    const namespace = subpath === "." ? undefined : root[subpath.slice(2)]
    if (subpath !== "." && namespace === undefined) {
      throw new Error(`the root entry does not re-export ${subpath.slice(2)}`)
    }
    if (namespace !== undefined && Object.keys(namespace).sort().join() !== Object.keys(mod).sort().join()) {
      throw new Error(`${specifier} and the root namespace export different names`)
    }
    console.log(`ok: ${specifier} (${Object.keys(mod).length} exports)`)
  } catch (error) {
    failures++
    console.error(`fail: ${specifier}: ${error instanceof Error ? error.message : error}`)
  }
}

if (failures > 0) process.exit(1)

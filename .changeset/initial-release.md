---
"@thomasfosterau/effect-parse": minor
---

First release of `@thomasfosterau/effect-parse` (developed as `effect-nom`): parser combinators for Effect, ported from Rust's nom and winnow. Text, byte, bit and token-stream input; `Backtrack` / `Cut` / `Incomplete` error modes; streaming input through `ParserStream`; compiled parsers through `Parser.compile`; `Schema` integration through `ParserSchema`; and `ParseError` diagnostics with line and column. Requires `effect` 4.x as a peer.

/**
 * Text encodings for the `Text` module.
 *
 * An {@link Encoding} tells the `Text` parsers how to read Unicode code
 * points out of an input. JavaScript strings are read natively, without any
 * conversion. Byte inputs are decoded as they are parsed, so offsets stay
 * byte offsets, slices that are kept as bytes (`Parser.taken`) are
 * zero-copy views, and partial input that ends in the middle of a character
 * reports `Incomplete`.
 *
 * ```ts
 * import { Encoding, Text } from "effect-nom"
 *
 * Text.utf8.encoding === Encoding.utf8
 * Text.make(Encoding.latin1) // the Text parsers for any Encoding, including your own
 * ```
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option"
import * as internal from "./internal/text.js"

/**
 * A text encoding: how to read Unicode code points out of an input. The
 * `Text` module is generic over encodings, so one grammar can parse
 * JavaScript strings, UTF-8 bytes, UTF-16 bytes and so on.
 *
 * Decoding is strict: malformed sequences (invalid UTF-8, unpaired UTF-16
 * surrogates) are reported as invalid, never replaced.
 *
 * @since 0.1.0
 * @category models
 */
export interface Encoding<I extends string | Uint8Array = string | Uint8Array> {
  /** The name of the encoding, e.g. `"UTF-8"`. Used in error messages. */
  readonly name: string
  /**
   * The size of a code unit, in input units: 1 for strings, UTF-8 and
   * Latin-1, 2 for UTF-16 bytes. Code points start at multiples of it.
   */
  readonly unit: number
  /**
   * Whether every input unit below `0x80` encodes the ASCII character with
   * that value, and is never part of a longer sequence. Enables fast paths.
   */
  readonly asciiCompatible: boolean
  /**
   * Decodes the code point starting at `offset` (with `offset < end`).
   * Returns the code point, `-1` if the input is malformed there, or `-2` if
   * the input ends inside a sequence (more input could complete it).
   */
  readonly decode: (input: I, offset: number, end: number) => number
  /** The number of input units that encode a code point. */
  readonly width: (codePoint: number) => number
  /** Encodes a string. Throws if the string can't be represented. */
  readonly encode: (text: string) => I
  /**
   * Decodes the units `[start, end)` to a string. The parsers only call it
   * on ranges they have checked are well formed.
   */
  readonly text: (input: I, start: number, end: number) => string
}

/**
 * JavaScript strings, read as UTF-16 code units. Offsets are code-unit
 * indices and slices are plain `String.prototype.slice`s. Unpaired
 * surrogates are malformed.
 *
 * @since 0.1.0
 * @category encodings
 */
export const string: Encoding<string> = internal.string

/**
 * UTF-8 bytes. Overlong encodings, surrogates and code points above
 * U+10FFFF are malformed.
 *
 * @since 0.1.0
 * @category encodings
 */
export const utf8: Encoding<Uint8Array> = internal.utf8

/**
 * UTF-16 bytes, little endian. Unpaired surrogates are malformed.
 *
 * @since 0.1.0
 * @category encodings
 */
export const utf16le: Encoding<Uint8Array> = internal.utf16le

/**
 * UTF-16 bytes, big endian. Unpaired surrogates are malformed.
 *
 * @since 0.1.0
 * @category encodings
 */
export const utf16be: Encoding<Uint8Array> = internal.utf16be

/**
 * ISO-8859-1 (Latin-1) bytes: each byte is the code point U+0000 to U+00FF
 * of the same value.
 *
 * @since 0.1.0
 * @category encodings
 */
export const latin1: Encoding<Uint8Array> = internal.latin1

/**
 * Detects the encoding of bytes from a byte order mark: UTF-8
 * (`EF BB BF`), UTF-16LE (`FF FE`) or UTF-16BE (`FE FF`). The mark itself
 * is not skipped; parse it with `Text.bom`.
 *
 * @example
 * ```ts
 * import { Encoding } from "effect-nom"
 *
 * Encoding.sniff(new Uint8Array([0xff, 0xfe, 0x41, 0x00])) // Option.some(Encoding.utf16le)
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export const sniff = (bytes: Uint8Array): Option.Option<Encoding<Uint8Array>> => {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return Option.some(utf8)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return Option.some(utf16le)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Option.some(utf16be)
  return Option.none()
}

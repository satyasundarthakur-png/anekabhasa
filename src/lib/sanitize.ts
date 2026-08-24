// Strips invisible Unicode characters that occasionally show up in LLM output and can act
// as an unintentional "fingerprint" in a document that's otherwise supposed to read as
// plain, ordinary text — zero-width spaces, word joiners, byte-order marks, bidi control
// marks, and variation selectors.
//
// Deliberately does NOT touch ZWJ/ZWNJ (U+200D / U+200C): those are not tracking artifacts,
// they're load-bearing for correct conjunct/ligature rendering in several of our target
// scripts (Kannada, Malayalam, Telugu, and Devanagari-based Hindi/Marathi all use them).
// Stripping those would silently corrupt real text, not clean it.
// eslint-disable-next-line no-misleading-character-class -- matching individual invisible chars, not a combining sequence
const INVISIBLE_CHARS_REGEX = /[\u200B\u2060\uFEFF\u200E\u200F\uFE00-\uFE0F]/g;

export function stripInvisibleMarks(text: string): string {
  return text.replace(INVISIBLE_CHARS_REGEX, "");
}

export function stripInvisibleMarksFromAll(paragraphs: string[]): string[] {
  return paragraphs.map(stripInvisibleMarks);
}

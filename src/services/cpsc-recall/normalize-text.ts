/**
 * @fileoverview Converts the HTML residue CPSC stores in its recall text — character
 * references and stray tags — to plain text, once, before any record reaches a handler.
 * @module services/cpsc-recall/normalize-text
 */

import type { RawRecall } from './types.js';

/** The named references decoded: the five XML ones and `&nbsp;`. Anything else passes through. */
const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * One alternation, matched in a single left-to-right pass, so text a reference decodes to
 * is never read again as markup. Groups: 1 decimal, 2 hex, 3 named reference; 4 tag name.
 *
 * A tag needs a letter after `<` or `</` (`<5mW` is data). It ends at the next `>`, or — cut
 * off — at the end of the string after its name and an optional `/`. The lookahead stops
 * the name from backtracking, and `[^<>]*` stops at the next `<`, which keeps the scan
 * linear on unterminated input.
 */
const MARKUP =
  /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));|<\/?([A-Za-z][A-Za-z\d]*)(?![A-Za-z\d])(?:[^<>]*>|\/?$)/g;

/** Tags whose removal ends a line; any other tag becomes a space. */
const LINE_BREAK_TAGS = new Set(['br', 'p', 'tr', 'li', 'div']);

/**
 * The character a numeric reference names, or `undefined` for a code point no string can
 * hold or a control character other than tab, line feed, and carriage return. A control
 * character would be invisible, and HTML reads 128–159 as Windows-1252 punctuation rather
 * than C1 controls, so those references stay as written.
 */
function fromCodePoint(codePoint: number): string | undefined {
  const control =
    (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
    (codePoint >= 0x7f && codePoint <= 0x9f);
  const surrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  return control || surrogate || codePoint > 0x10ffff ? undefined : String.fromCodePoint(codePoint);
}

/**
 * Decodes character references and removes tags in one pass.
 *
 * A removed tag never joins its neighbours: it leaves one space, or one line break for
 * `br`/`p`/`tr`/`li`/`div`, in place of itself and the whitespace around it, and nothing
 * at either end of the string. An unknown or out-of-range reference (`C&T;`), a reference
 * to a control character, and a bare `&` stay as they are.
 */
export function normalizeText(text: string): string {
  if (!text.includes('&') && !text.includes('<')) return text;

  let out = '';
  let last = 0;
  /** Separator owed by tags removed since the last emitted text. */
  let owed: '' | ' ' | '\n' = '';

  const emit = (segment: string) => {
    if (owed) {
      segment = segment.trimStart();
      if (!segment) return;
      if (out) out += owed;
      owed = '';
    }
    out += segment;
  };

  for (const match of text.matchAll(MARKUP)) {
    const [whole, decimal, hex, named, tagName] = match;
    const before = text.slice(last, match.index);
    last = match.index + whole.length;

    if (tagName === undefined) {
      const codePoint = decimal ?? hex;
      const decoded =
        codePoint === undefined
          ? NAMED_REFERENCES[named as string]
          : fromCodePoint(Number.parseInt(codePoint, decimal === undefined ? 16 : 10));
      emit(before + (decoded ?? whole));
      continue;
    }

    emit(before.trimEnd());
    owed = owed === '\n' || LINE_BREAK_TAGS.has(tagName.toLowerCase()) ? '\n' : ' ';
  }

  emit(text.slice(last));
  return out;
}

/** Keys whose values are addresses, not text: carried unchanged. */
const ADDRESS_KEYS = new Set(['URL']);

/**
 * Normalizes every string in `value`, recursing through arrays and objects, except under
 * `ADDRESS_KEYS`. Builds each copy with `for…in` rather than `Object.entries`, which cost
 * over twice as much across a full-dataset fetch.
 */
function normalizeValue(value: unknown): unknown {
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value === null || typeof value !== 'object') return value;
  const copy: Record<string, unknown> = {};
  for (const key in value) {
    const field = (value as Record<string, unknown>)[key];
    copy[key] = ADDRESS_KEYS.has(key) ? field : normalizeValue(field);
  }
  return copy;
}

/** A copy of `record` with every text field — nested entries included — passed through {@link normalizeText}. */
export function normalizeRecall(record: RawRecall): RawRecall {
  return normalizeValue(record) as RawRecall;
}

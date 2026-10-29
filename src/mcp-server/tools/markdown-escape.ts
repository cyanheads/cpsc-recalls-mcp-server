/**
 * @fileoverview Markdown escaping for CPSC text interpolated into `content[]`, so a
 * renderer shows every character of the record instead of reading some as markup.
 * @module mcp-server/tools/markdown-escape
 */

import { markdownLink } from '@cyanheads/mcp-ts-core/utils';

/**
 * A character that changes the rendering of plain text wherever it sits — backslash, code
 * and emphasis delimiters, link brackets, strikethrough tildes, `<` opening a tag or
 * autolink, `&` opening a character reference, `_` unless both neighbours are letters or
 * digits (an intraword underscore such as `AMG005197_12_Q` never delimits emphasis), and
 * the first `#` of a run ending a line, which a heading would drop as its closing sequence.
 */
const SPECIAL =
  /[\\`*[\]~]|<(?=[A-Za-z/!?])|&(?=#?[A-Za-z\d]{1,32};)|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])|(?<=[ \t])#(?=#*[ \t]*(?:\n|$))/gu;

/** {@link SPECIAL} matched in place, at `lastIndex`. */
const SPECIAL_AT = new RegExp(SPECIAL.source, 'uy');

/**
 * A bare web address whose host starts with a letter or digit: an `http(s)://` address
 * after anything but an ASCII letter, as GFM links one, or a `www.` address after anything
 * but a letter or digit (GFM's narrower rule for `www.` is {@link autolinks}).
 */
const ADDRESS = /(?:(?<![A-Za-z])https?:\/\/|(?<![\p{L}\p{N}])www\.)(?=[\p{L}\p{N}])[^\s<]*/u;

/**
 * One pass over the text: group 1 is an {@link ADDRESS} with the `!` before it, if any;
 * every other match is a {@link SPECIAL} character. Each alternative is anchored on one
 * character and scans at most a bounded or disjoint run, so the pass is linear.
 */
const INLINE = new RegExp(`(!?${ADDRESS.source})|${SPECIAL.source}`, 'gu');

/** Characters GFM always leaves off the end of an autolink. */
const TRAILING = new Set(['?', '!', '.', ',', ':', '*', '_', '~', '"', "'"]);

/**
 * A line start — the string's first character or one after a newline, past any
 * indentation — carrying a block marker: a heading, quote, list bullet, setext underline,
 * table pipe, or the `:` that opens a table delimiter row, or an ordered-list number
 * followed by `.` or `)` and whitespace. Anchored at `^` or `\n`, so each whitespace run is
 * scanned once.
 */
const LINE_START = /(^|\n)([ \t]*)(?:([#>+=|:-])|(\d{1,9})([.)])(?=\s|$))/g;

/** `text` with every {@link SPECIAL} character backslash-escaped. */
function escapeText(text: string): string {
  return text.replace(SPECIAL, '\\$&');
}

/**
 * Whether GFM — cmark-gfm and micromark alike — autolinks `address` where it sits after
 * `before`: a `www.` address only at the start of the text or after whitespace, `(`, `*`,
 * `_`, or `~`, and any address only when the last two labels of its host hold no `_`.
 */
function autolinks(address: string, before: string | undefined): boolean {
  if (address.startsWith('www.') && before !== undefined && !/[\s(*_~]/u.test(before)) {
    return false;
  }
  const host = address.replace(/^https?:\/\//, '').replace(/[^\p{L}\p{N}_.-][\s\S]*/u, '');
  return !host
    .split('.')
    .slice(-2)
    .some((label) => label.includes('_'));
}

/**
 * Where GFM ends the autolink over `address`, by cmark-gfm's rule: it drops trailing
 * {@link TRAILING} characters, a `)` while the address holds more `)` than `(`, an
 * entity-shaped `&name;`, and any other `;`. The parentheses are counted once and each
 * entity scan stops at the first character that is not a letter, so the trim is linear.
 */
function autolinkEnd(address: string): number {
  let opening = 0;
  let closing = 0;
  for (const char of address) {
    if (char === '(') opening++;
    else if (char === ')') closing++;
  }
  let end = address.length;
  while (end > 0) {
    const last = address.charAt(end - 1);
    if (TRAILING.has(last)) {
      end--;
    } else if (last === ')' && closing > opening) {
      closing--;
      end--;
    } else if (last === ';') {
      let start = end - 2;
      while (start > 0 && /[A-Za-z]/.test(address.charAt(start))) start--;
      end = start < end - 2 && address[start] === '&' ? start : end - 1;
    } else {
      break;
    }
  }
  return end;
}

/**
 * Encodes a web address found after `before`; `escapedNext` says an escaped `<` directly
 * follows it. An address GFM does not autolink is plain text, escaped like the text around
 * it. An address GFM links stays bare when it holds nothing to escape and no escaped `<` follows,
 * since a backslash shows inside an autolink. Otherwise it becomes an explicit link over
 * the span GFM links, to the href GFM gives it (`http://` before a `www.` address), with
 * the characters GFM leaves off the end escaped after it as text. An href that is not an
 * `http:`/`https:` URL escapes the address as text instead, so `markdownLink` never shows
 * it twice as `label (url)`.
 */
function encodeAddress(address: string, before: string | undefined, escapedNext: boolean): string {
  const escaped = escapeText(address);
  if (!autolinks(address, before) || (escaped === address && !escapedNext)) return escaped;
  const end = autolinkEnd(address);
  const span = address.slice(0, end);
  const href = span.startsWith('www.') ? `http://${span}` : span;
  const protocol = URL.parse(href)?.protocol;
  if (protocol !== 'http:' && protocol !== 'https:') return escaped;
  return `${markdownLink(span, href)}${escapeText(address.slice(end))}`;
}

/**
 * Backslash-escapes `text` so CommonMark and GFM render it as the literal characters.
 * A carriage return, which CommonMark reads as a line ending, becomes a line feed first,
 * so every line start is escaped and callers that split on `\n` see every line. A web
 * address goes through {@link encodeAddress}: escaped text where GFM does not autolink it,
 * bare where it holds nothing to escape and no escaped `<` follows it, and otherwise an
 * explicit link over GFM's own link span, since a backslash inside an autolink shows
 * literally. A `!` before that link is escaped so it does not become an image. Applied
 * where upstream text is interpolated into `content[]`, never to `structuredContent`.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(INLINE, (match: string, found: string | undefined, offset: number, whole: string) => {
      if (found === undefined) return `\\${match}`;
      const bang = found.startsWith('!') ? '!' : '';
      SPECIAL_AT.lastIndex = offset + found.length;
      const encoded = encodeAddress(
        found.slice(bang.length),
        bang || whole[offset - 1],
        SPECIAL_AT.test(whole),
      );
      // Before a link, a bare `!` would make it an image.
      return `${bang && encoded.startsWith('[') ? '\\!' : bang}${encoded}`;
    })
    .replace(
      LINE_START,
      (
        _line,
        lead: string,
        indent: string,
        marker?: string,
        digits?: string,
        delimiter?: string,
      ) =>
        marker === undefined
          ? `${lead}${indent}${digits}\\${delimiter}`
          : `${lead}${indent}\\${marker}`,
    );
}

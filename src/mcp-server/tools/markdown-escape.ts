/**
 * @fileoverview Markdown escaping for CPSC text interpolated into `content[]`, so a
 * renderer shows every character of the record instead of reading some as markup.
 * @module mcp-server/tools/markdown-escape
 */

/**
 * A character that changes the rendering of plain text wherever it sits — backslash, code
 * and emphasis delimiters, link brackets, strikethrough tildes, `<` opening a tag or
 * autolink, `&` opening a character reference, `_` unless both neighbours are letters or
 * digits (an intraword underscore such as `AMG005197_12_Q` never delimits emphasis), and
 * the first `#` of a run ending a line, which a heading would drop as its closing sequence.
 */
const SPECIAL =
  /[\\`*[\]~]|<(?=[A-Za-z/!?])|&(?=#?[A-Za-z\d]{1,32};)|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])|(?<=[ \t])#(?=#*[ \t]*(?:\n|$))/gu;

/** A bare web address whose host starts with a letter or digit. */
const ADDRESS = /(?<![\p{L}\p{N}])(?:https?:\/\/|www\.)(?=[\p{L}\p{N}])[^\s<]*/u;

/**
 * One pass over the text: group 1 is an {@link ADDRESS}, every other match a
 * {@link SPECIAL} character. Each alternative is anchored on one character and scans at
 * most a bounded or disjoint run, so the pass is linear.
 */
const INLINE = new RegExp(`(${ADDRESS.source})|${SPECIAL.source}`, 'gu');

/**
 * A line start — the string's first character or one after a newline, past any
 * indentation — carrying a block marker: a heading, quote, list bullet, setext underline,
 * table pipe, or the `:` that opens a table delimiter row, or an ordered-list number
 * followed by `.` or `)` and whitespace. Anchored at `^` or `\n`, so each whitespace run is
 * scanned once.
 */
const LINE_START = /(^|\n)([ \t]*)(?:([#>+=|:-])|(\d{1,9})([.)])(?=\s|$))/g;

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
 * Backslash-escapes `text` so CommonMark and GFM render it as the literal characters.
 * A carriage return, which CommonMark reads as a line ending, becomes a line feed first,
 * so every line start is escaped and callers that split on `\n` see every line. A web
 * address GFM autolinks is left as it is, since the autolink would show a backslash inside
 * it literally; any other address is plain text and escaped like the text around it.
 * Applied where upstream text is interpolated into `content[]`, never to `structuredContent`.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(INLINE, (char: string, address: string | undefined, offset: number, whole: string) =>
      address === undefined
        ? `\\${char}`
        : autolinks(address, whole[offset - 1])
          ? address
          : address.replace(SPECIAL, '\\$&'),
    )
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

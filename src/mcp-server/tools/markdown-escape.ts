/**
 * @fileoverview Markdown escaping for CPSC text interpolated into `content[]`, so a
 * renderer shows every character of the record instead of reading some as markup.
 * @module mcp-server/tools/markdown-escape
 */

/**
 * One pass over the text. Group 1 is a bare web address whose host starts with a letter or
 * digit, left as it is: GFM links it and shows a backslash inside it literally. Every other
 * alternative is a character that changes the rendering of plain text wherever it sits —
 * backslash, code and emphasis delimiters, link brackets, strikethrough tildes, `<` opening
 * a tag or autolink, `&` opening a character reference, `_` unless both neighbours are
 * letters or digits (an intraword underscore such as `AMG005197_12_Q` never delimits
 * emphasis), and the first `#` of a run ending a line, which a heading would drop as its
 * closing sequence. Each alternative is anchored on one character and scans at most a
 * bounded or disjoint run, so the pass is linear.
 */
const INLINE =
  /((?<![\p{L}\p{N}])(?:https?:\/\/|www\.)(?=[\p{L}\p{N}])[^\s<]*)|[\\`*[\]~]|<(?=[A-Za-z/!?])|&(?=#?[A-Za-z\d]{1,32};)|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])|(?<=[ \t])#(?=#*[ \t]*(?:\n|$))/gu;

/**
 * A line start — the string's first character or one after a newline, past any
 * indentation — carrying a block marker: a heading, quote, list bullet, setext underline,
 * table pipe, or the `:` that opens a table delimiter row, or an ordered-list number
 * followed by `.` or `)` and whitespace. Anchored at `^` or `\n`, so each whitespace run is
 * scanned once.
 */
const LINE_START = /(^|\n)([ \t]*)(?:([#>+=|:-])|(\d{1,9})([.)])(?=\s|$))/g;

/**
 * Backslash-escapes `text` so CommonMark and GFM render it as the literal characters.
 * A carriage return, which CommonMark reads as a line ending, becomes a line feed first,
 * so every line start is escaped and callers that split on `\n` see every line.
 * Applied where upstream text is interpolated into `content[]`, never to `structuredContent`.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(INLINE, (char: string, address?: string) => address ?? `\\${char}`)
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

/**
 * `url` as a Markdown link destination. A bare destination ends at the first space and
 * cannot hold `<`, `>`, or an unbalanced parenthesis, so those are percent-encoded as
 * UTF-8; the address they name is the same.
 */
export function linkDestination(url: string): string {
  return url.replace(/[\s<>()]/gu, (char) =>
    char === '(' ? '%28' : char === ')' ? '%29' : encodeURIComponent(char),
  );
}

/**
 * `url` shown as a bare address. A web address is encoded as a link destination, and a
 * trailing `.`, `_`, or `~` — which GFM leaves out of an autolink — is percent-encoded too,
 * so the autolink covers the whole address; encoding those unreserved characters names the
 * same address. A value that is not a web address is escaped as text.
 */
export function bareAddress(url: string): string {
  if (!/^https?:\/\//.test(url)) return escapeMarkdown(url);
  const destination = linkDestination(url).replace(/[._~]+$/, (run) =>
    run.replace(/./g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`),
  );
  return escapeMarkdown(destination);
}

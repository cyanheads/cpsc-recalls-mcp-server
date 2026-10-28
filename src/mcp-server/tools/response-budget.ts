/**
 * @fileoverview Response size budget shared by the list tools. A page keeps the leading
 * records whose charges fit under one byte cap, applied to the serialized
 * `structuredContent` and to the `content[]` text alike.
 * @module mcp-server/tools/response-budget
 */

/**
 * UTF-8 byte cap on each response surface: the serialized `structuredContent`, and all
 * `content[]` text including the enrichment trailer.
 */
export const RESPONSE_BUDGET_BYTES = 64_000;

/** UTF-8 byte length of `text`. */
function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Counts how many leading `records` fit in the budget after `overheadBytes`.
 *
 * Each record is charged the larger of its JSON and its rendered text, plus one byte for
 * the separator that joins it on either surface (`,` in the JSON array, `\n` in the text).
 * Charging the larger of the two bounds both surfaces with one running total. Returns at
 * least 1 whenever `records` is non-empty, so a record larger than the whole budget comes
 * back alone rather than as an empty page.
 */
export function countWithinBudget<T>(
  records: readonly T[],
  render: (record: T) => string,
  overheadBytes: number,
): number {
  let used = overheadBytes;
  let count = 0;
  for (const record of records) {
    used += Math.max(utf8Bytes(JSON.stringify(record)), utf8Bytes(render(record))) + 1;
    if (count > 0 && used > RESPONSE_BUDGET_BYTES) break;
    count++;
  }
  return count;
}

/** Length of the longest backtick run in `value`; 0 when it holds none. */
function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const [run] of value.matchAll(/`+/g)) longest = Math.max(longest, run.length);
  return longest;
}

/**
 * Upper bound on the bytes the framework renders for `value` as a code literal: nothing
 * for the empty string; for one line, a code span delimited by a backtick run one longer
 * than the value's longest, plus a padding space on each side; for a value holding a line
 * break, a fenced block on lines of its own — a line break before and after, and a fence
 * at least three backticks long (one longer than the value's longest run) on each side of
 * the value's own line.
 */
function codeLiteralBytes(value: string): number {
  if (value === '') return 0;
  const run = longestBacktickRun(value);
  return /[\r\n]/.test(value)
    ? utf8Bytes(value) + 2 * Math.max(3, run + 1) + 4
    : utf8Bytes(value) + 2 * (run + 1) + 2;
}

/**
 * Upper bound on the bytes the framework's enrichment trailer renders for one field,
 * separator included: the larger of its renderings as a `notice` (every line behind `> `)
 * and as an `echo` (`Query: `) or generic (`**key:** `) line carrying the value as a code
 * literal, plus the two-byte line break or blank line set before it.
 */
function trailerFieldBytes(key: string, value: string): number {
  const lines = 1 + (value.match(/\r\n|\r|\n/g)?.length ?? 0);
  const label = Math.max(utf8Bytes('Query: '), utf8Bytes(`**${key}:** `));
  return 2 + Math.max(utf8Bytes(value) + 2 * lines, label + codeLiteralBytes(value));
}

/**
 * Bytes a page spends outside its records: the larger of the `structuredContent` skeleton
 * (records emptied, enrichment merged in) and the rendered non-record text plus the
 * enrichment trailer the framework appends to `content[]`.
 *
 * The trailer is its own text block: a leading blank line, then one field per enrichment
 * value. A `notice` renders every line behind `> `; an `echo` renders `Query: ` and a
 * generic field `**key:** ` before the value as a code literal — a code span, sized past
 * the value's longest backtick run, or a fenced block on lines of its own when the value
 * holds a line break, and nothing when it is empty. Fields after a quote are set off by a
 * blank line, the rest by a line break. Each field is reserved its largest rendering, so
 * the reservation holds whichever helper set it and whatever the value holds.
 */
export function pageOverheadBytes(
  skeleton: object,
  text: string,
  enrichment: Readonly<Record<string, string>>,
): number {
  const trailer = Object.entries(enrichment).reduce(
    (sum, [key, value]) => sum + trailerFieldBytes(key, value),
    0,
  );
  return Math.max(
    utf8Bytes(JSON.stringify({ ...skeleton, ...enrichment })),
    utf8Bytes(text) + trailer,
  );
}

/** The notice for a page the budget ended before `requested` records. */
export function budgetCutNotice(returned: number, requested: number, nextOffset: number): string {
  return `Returned ${returned} of the ${requested} requested recalls: this page reached the ${RESPONSE_BUDGET_BYTES.toLocaleString('en-US')}-byte response size budget. Continue with offset ${nextOffset} for the rest.`;
}

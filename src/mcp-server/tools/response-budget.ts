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

/**
 * Bytes a page spends outside its records: the larger of the `structuredContent` skeleton
 * (records emptied, enrichment merged in) and the rendered non-record text plus the
 * enrichment trailer the framework appends to `content[]`.
 *
 * The trailer is a leading blank line, then each field behind a label of at most seven
 * bytes (`Query: `, `> `), separated from the next by at most a blank line — so each field
 * is reserved nine bytes beyond its value.
 */
export function pageOverheadBytes(
  skeleton: object,
  text: string,
  enrichment: Readonly<Record<string, string>>,
): number {
  const trailer = Object.values(enrichment).reduce((sum, value) => sum + utf8Bytes(value) + 9, 2);
  return Math.max(
    utf8Bytes(JSON.stringify({ ...skeleton, ...enrichment })),
    utf8Bytes(text) + trailer,
  );
}

/** The notice for a page the budget ended before `requested` records. */
export function budgetCutNotice(returned: number, requested: number, nextOffset: number): string {
  return `Returned ${returned} of the ${requested} requested recalls: this page reached the ${RESPONSE_BUDGET_BYTES.toLocaleString('en-US')}-byte response size budget. Continue with offset ${nextOffset} for the rest.`;
}

/**
 * @fileoverview Search CPSC consumer product recalls by product name, brand, retailer,
 * hazard keyword, or date range.
 * @module mcp-server/tools/definitions/cpsc-search-recalls
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  bareAddress,
  linkDestination,
  escapeMarkdown as md,
} from '@/mcp-server/tools/markdown-escape.js';
import {
  budgetCutNotice,
  countWithinBudget,
  pageOverheadBytes,
} from '@/mcp-server/tools/response-budget.js';
import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';
import type { CpscSearchParams, RawRecall } from '@/services/cpsc-recall/types.js';

/**
 * Static jurisdiction note included in every response — the text the other two tools
 * carry, plus a routing sentence.
 */
const JURISDICTION =
  'CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF). For those categories, use the appropriate server.';

/** Static provenance caveat included in every response. */
const SOURCE_NOTE =
  'Recall fields are CPSC record text, with HTML markup and character codes converted to plain text; this server does not otherwise edit or verify them. CPSC records occasionally carry missing or inconsistent text. Check cpsc_url before acting on a recall for a consumer-facing decision.';

/**
 * Sent as `RecallDateStart` when a search would otherwise send no upstream parameter.
 * The unfiltered collection has been observed to lag the filtered responses, omitting the
 * newest recalls that any filtered request returns. The floor precedes the oldest CPSC
 * recall date (1973-06-08), so it never excludes a record.
 */
const RECALL_DATE_FLOOR = '1970-01-01';

type TextFilterKey =
  | 'product_name'
  | 'manufacturer'
  | 'retailer'
  | 'importer'
  | 'distributor'
  | 'title_search'
  | 'description_search'
  | 'remedy'
  | 'hazard_search';

interface TextFilter {
  key: TextFilterKey;
  /** The upstream parameter that narrows the fetch. */
  param?: keyof CpscSearchParams;
  /** The record text every word of the filter must appear in — the field CPSC matches for `param`. */
  text: (recall: RawRecall) => ReadonlyArray<string | null>;
}

/** A text filter the caller set, with its value trimmed and whitespace collapsed. */
interface AppliedFilter extends TextFilter {
  value: string;
  /** Case-folded words of `value`, each required somewhere in `text`. */
  words: string[];
}

const names = (entries: ReadonlyArray<{ Name: string }>) => entries.map((entry) => entry.Name);

/** Every free-text filter, in the order the effective query lists them. */
const TEXT_FILTERS: readonly TextFilter[] = [
  { key: 'product_name', param: 'ProductName', text: (r) => names(r.Products) },
  { key: 'manufacturer', param: 'Manufacturer', text: (r) => names(r.Manufacturers) },
  { key: 'retailer', param: 'Retailer', text: (r) => names(r.Retailers) },
  { key: 'importer', param: 'Importer', text: (r) => names(r.Importers) },
  { key: 'distributor', param: 'Distributor', text: (r) => names(r.Distributors) },
  { key: 'title_search', param: 'RecallTitle', text: (r) => [r.Title] },
  { key: 'description_search', param: 'RecallDescription', text: (r) => [r.Description] },
  { key: 'remedy', param: 'Remedy', text: (r) => names(r.Remedies) },
  /** No upstream parameter: CPSC recognizes `Hazard` but never matches it. */
  {
    key: 'hazard_search',
    text: (r) => [...names(r.Hazards), ...names(r.Products), ...names(r.Remedies)],
  },
];

const DATE_BOUNDS = ['date_start', 'date_end', 'updated_start', 'updated_end'] as const;

/** Lowercases and maps curly apostrophes to `'`, so `'`, `’`, and `‘` match each other. */
function fold(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'");
}

/**
 * Cap on a forwarded word's URL-encoded length. CPSC refuses a query string over 2,048
 * bytes; eight words at this cap plus every date bound come to about 1,830.
 */
const MAX_UPSTREAM_WORD_BYTES = 200;

/**
 * The one word a filter sends upstream: its longest fragment free of apostrophes and
 * brackets, the first on a tie, cut to the code points that fit `MAX_UPSTREAM_WORD_BYTES`
 * once URL-encoded. CPSC matches a parameter as one contiguous substring and reads `%`,
 * `_`, and `[…]` as wildcards, so every word — this one included, in full — is also
 * checked locally. `%`, `_`, and a shortened word can only widen the fetch; a bracket
 * class can exclude the record that holds the brackets literally, so no bracket is sent.
 */
function upstreamWord(value: string): string | undefined {
  let longest = '';
  for (const fragment of value.split(/[\s'‘’[\]]+/)) {
    if (fragment.length > longest.length) longest = fragment;
  }
  let word = '';
  let bytes = 0;
  for (const char of longest) {
    bytes += new URLSearchParams({ w: char }).toString().length - 2;
    if (bytes > MAX_UPSTREAM_WORD_BYTES) break;
    word += char;
  }
  return word || undefined;
}

/** True when every word of `filter` appears in its field; words may land in different entries. */
function matchesEveryWord(recall: RawRecall, filter: AppliedFilter): boolean {
  const haystack = fold(filter.text(recall).join('\n'));
  return filter.words.every((word) => haystack.includes(word));
}

const recallSchema = z
  .object({
    recall_number: z
      .string()
      .describe(
        'Recall identifier (5-digit numeric for 2002+ records, e.g. "25043"; 6-char with letter suffix for 1998–2001 records, e.g. "99003a"). Pass to cpsc_get_recall for full detail.',
      ),
    recall_date: z.string().describe('Date the recall was issued, ISO 8601.'),
    title: z.string().describe('Official recall title.'),
    hazards: z
      .array(z.string().describe('Hazard description — what is dangerous.'))
      .describe('Hazard descriptions — what is dangerous about this product.'),
    remedy_options: z
      .array(z.string().describe('Remedy type.'))
      .describe(
        'Remedy types: Refund, Repair, Replace, New Instructions, Dispose, Label, No Remedy Available, Inspect. Multiple may apply. Often empty — CPSC classified the remedy on fewer than half its records; read remedy_summary when this is empty, and cpsc_url when that is empty too.',
      ),
    remedy_summary: z
      .string()
      .describe('Full remedy instructions — what the consumer should do and how to claim.'),
    products: z
      .array(
        z
          .object({
            name: z.string().describe('Product name.'),
            units_recalled: z
              .string()
              .describe('Estimated number of units recalled, e.g. "About 2,500".'),
          })
          .describe('A product covered by this recall.'),
      )
      .describe('Products covered by this recall. A recall may cover multiple products.'),
    upcs: z
      .array(z.string().describe('UPC code.'))
      .describe(
        'UPC codes for this recall (sparse — ~4% of records have UPCs). CPSC lists UPCs for the recall as a whole, not per product, so on a recall covering several products a UPC cannot be tied to one of them.',
      ),
    manufacturers: z
      .array(z.string().describe('Manufacturer name.'))
      .describe('Manufacturer names. Often empty — importer or retailer may be listed instead.'),
    importers: z.array(z.string().describe('Importer name.')).describe('Importer company names.'),
    retailers: z
      .array(z.string().describe('Retailer name and sale details.'))
      .describe(
        'Retailer names and sale details (narrative text including stores, dates, price range).',
      ),
    cpsc_url: z.string().describe('Official CPSC recall page URL for human verification.'),
    images: z
      .array(
        z
          .object({
            url: z.string().describe('Image URL.'),
            caption: z.string().describe('Image caption.'),
          })
          .describe('An image from the recall notice.'),
      )
      .describe('Product images from the recall notice.'),
    data_quality_notes: z
      .array(z.string().describe('One gap found in the CPSC record.'))
      .describe(
        'Gaps this server observed in the CPSC record — absent hazard text, absent product entries. Derived from which fields CPSC left empty, not from any judgement about the recall itself. Empty when nothing is missing.',
      ),
  })
  .describe('A CPSC recall record.');

type SearchRecall = z.infer<typeof recallSchema>;

/** Shapes one upstream record for the response. */
function toSearchRecall(r: RawRecall): SearchRecall {
  const hazards = r.Hazards.map((h) => h.Name).filter(Boolean);
  const products = r.Products.map((p) => ({
    name: p.Name,
    units_recalled: p.NumberOfUnits ?? '',
  }));

  const data_quality_notes: string[] = [];
  if (hazards.length === 0) {
    data_quality_notes.push('CPSC listed no hazard description for this recall.');
  }
  if (products.length === 0) {
    data_quality_notes.push('CPSC listed no product entries for this recall.');
  }

  return {
    recall_number: r.RecallNumber,
    recall_date: r.RecallDate.slice(0, 10),
    title: r.Title,
    hazards,
    remedy_options: r.RemedyOptions.map((o) => o.Option).filter(Boolean),
    remedy_summary: r.Remedies.map((rem) => rem.Name)
      .filter(Boolean)
      .join(' '),
    products,
    upcs: r.ProductUPCs.map((u) => u.UPC).filter(Boolean),
    manufacturers: r.Manufacturers.map((m) => m.Name).filter(Boolean),
    importers: r.Importers.map((i) => i.Name).filter(Boolean),
    retailers: r.Retailers.map((ret) => ret.Name).filter(Boolean),
    cpsc_url: r.URL,
    images: r.Images.map((img) => ({ url: img.URL, caption: img.Caption })),
    data_quality_notes,
  };
}

/**
 * One recall's `content[]` block. `format()` and the response budget both call it, so the
 * bytes charged for a record are the bytes rendered for it — Markdown escaping included,
 * which is why the escaping happens here rather than in `format()`.
 */
function renderRecallBlock(r: SearchRecall): string {
  const lines: string[] = [];
  lines.push(`## [${r.recall_number}] — ${md(r.title)} (${r.recall_date})`);
  lines.push('CPSC source fields:');

  const hazardText = r.hazards.length > 0 ? md(r.hazards.join('; ')) : 'Not specified';
  lines.push(`**Hazard:** ${hazardText}`);

  const remedyTypes =
    r.remedy_options.length > 0 ? md(r.remedy_options.join(', ')) : 'Not specified';
  const remedyText = r.remedy_summary ? md(r.remedy_summary) : 'See CPSC recall page.';
  lines.push(`**Remedy:** ${remedyTypes} — ${remedyText}`);

  const productNames = r.products
    .map(
      (p) => `${md(p.name)} (${p.units_recalled ? md(p.units_recalled) : 'units not specified'})`,
    )
    .join('; ');
  lines.push(`**Products:** ${productNames || 'Not specified'}`);

  if (r.upcs.length > 0) {
    lines.push(`**UPCs:** ${md(r.upcs.join(', '))}`);
  }

  const soldBy = r.retailers.length > 0 ? md(r.retailers.join('; ')) : 'Not specified';
  lines.push(`**Sold by:** ${soldBy}`);

  /**
   * Manufacturer and importer are distinct roles and CPSC org names contain commas,
   * so each role gets its own line and entries are separated with '; '.
   */
  if (r.manufacturers.length > 0) {
    lines.push(`**Manufacturer:** ${md(r.manufacturers.join('; '))}`);
  }
  if (r.importers.length > 0) {
    lines.push(`**Importer:** ${md(r.importers.join('; '))}`);
  }
  if (r.manufacturers.length === 0 && r.importers.length === 0) {
    lines.push('**Manufacturer/Importer:** Not specified');
  }

  if (r.images.length > 0) {
    const imgList = r.images.map((img) => `${md(img.caption)}: ${bareAddress(img.url)}`).join('; ');
    lines.push(`**Images (${r.images.length}):** ${imgList}`);
  } else {
    lines.push(`**Images:** None`);
  }
  lines.push(`[View recall](${linkDestination(r.cpsc_url)})`);
  if (r.data_quality_notes.length > 0) {
    lines.push(`**Data quality (server-assessed):** ${r.data_quality_notes.join(' ')}`);
  }
  lines.push('---');
  return lines.join('\n');
}

interface PageState {
  cpsc_jurisdiction: string;
  has_more: boolean;
  offset: number;
  source_note: string;
  total_found: number;
  truncated: boolean;
}

/** The text after the record blocks, for a page that returned `returned` records. */
function renderFooter(page: PageState, returned: number): string {
  const truncNote = page.truncated ? ' (truncated)' : '';
  const paging = page.has_more
    ? ` More available — repeat with offset ${page.offset + returned}.`
    : '';
  const window =
    page.total_found === 0
      ? 'No recalls matched the search criteria.'
      : `Showing ${returned} of ${page.total_found} recalls${truncNote}, starting at offset ${page.offset}.${paging}`;
  return [
    window,
    `Source: ${page.source_note}`,
    `CPSC jurisdiction: ${page.cpsc_jurisdiction}`,
  ].join('\n');
}

/**
 * Why nothing matched, and which criterion to relax first. A suggestion never drops the
 * only criterion, since a search with none fails `missing_criteria`.
 */
function zeroMatchNotice(
  filters: readonly AppliedFilter[],
  matchedBeforeHazard: number,
  hasDateBound: boolean,
): string {
  const parts = ['No recalls matched every search criterion.'];
  const hazardOnly = filters.length === 1 && filters[0]?.key === 'hazard_search' && !hasDateBound;
  if (hazardOnly) {
    parts.push(
      "No recall's hazard descriptions, product names, or remedy instructions contain every hazard_search word — try another hazard term.",
    );
  } else if (filters.some((f) => f.key === 'hazard_search') && matchedBeforeHazard > 0) {
    parts.push(
      `${matchedBeforeHazard} recall${matchedBeforeHazard === 1 ? '' : 's'} matched before hazard_search was applied, and hazard_search removed all of them — try another hazard term or drop hazard_search.`,
    );
  }
  if (filters.some((f) => f.words.length > 1)) {
    parts.push(
      'A text filter with several words matches only records that contain every word — try fewer words.',
    );
  }
  if (filters.some((f) => f.key === 'manufacturer')) {
    parts.push(
      'Many recalls name the importer, retailer, or distributor rather than the manufacturer — try the same name in importer, retailer, or distributor.',
    );
  }
  if (hasDateBound) {
    parts.push(filters.length > 0 ? 'Widen or drop the date bounds.' : 'Widen the date bounds.');
  }
  parts.push(JURISDICTION);
  return parts.join(' ');
}

export const cpscSearchRecalls = tool('cpsc_search_recalls', {
  title: 'Search CPSC Recalls',
  description:
    'Search consumer product recalls from the CPSC (Consumer Product Safety Commission) — toys, electronics, furniture, appliances, children\'s products, tools, and clothing. Give at least one text filter or date bound; to browse the latest recalls without one, use cpsc_get_recent. Filters combine with AND, and a text filter matches records whose field contains every one of its words, in any order and case-insensitively. Start with title_search when you have a product in hand — CPSC titles carry the brand, product, and hazard phrasing. For hazard types ("fire", "choking", "burn"), use hazard_search, which matches hazard descriptions, product names, and remedy instructions. When manufacturer finds nothing, try importer, retailer, or distributor: many recalls name one of those as the responsible company. Page past limit with offset — total_found counts every match and has_more says whether more remain; a page returns fewer than limit recalls when it reaches the 64,000-byte response size budget. Pass a recall_number to cpsc_get_recall for the full record, including the complete description, all images, and incident reports. CPSC jurisdiction: consumer products only — food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), and firearms (ATF) are covered by other agencies.',
  annotations: { readOnlyHint: true, idempotentHint: true },

  /**
   * `Hazard` is the upstream CPSC query parameter, so a caller working from the
   * saferproducts.gov API docs reaches for that spelling. It maps one-to-one onto
   * `hazard_search`, the working replacement for a parameter CPSC never matches.
   */
  inputAliases: { hazard: 'hazard_search' },

  input: z.object({
    product_name: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Product name to search for, e.g. "crib", "space heater", "bicycle". Matches recalls whose product names contain every word, in any order — partial words work.',
      ),
    manufacturer: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Manufacturer name, e.g. "Samsung", "LEGO". Matches recalls whose manufacturer names contain every word, in any order. Many recalls name the importer, retailer, or distributor rather than the manufacturer — try those filters when this finds nothing.',
      ),
    retailer: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Retailer name, e.g. "Walmart", "Target", "Amazon". Matches recalls whose retailer text (store name, dates sold, and price) contains every word, in any order.',
      ),
    importer: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Importer company name. Matches recalls whose importer names contain every word, in any order. Use when searching for recalls by the company that brought the product into the US.',
      ),
    distributor: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Distributor company name, e.g. "Walmart", "Costco". Matches recalls whose distributor names contain every word, in any order — a role distinct from retailer and importer, and listed on far fewer recalls.',
      ),
    title_search: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Keyword search within the recall title, e.g. "chandelier", "space heater", "Graco crib". Matches titles containing every word, in any order. CPSC titles name the brand, the product, and the hazard, which makes this the highest-signal single filter for most searches.',
      ),
    description_search: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Keyword search within the recall description only — not the title, hazard text, or remedy instructions; matches descriptions containing every word, in any order. Use for product details not captured in product_name — model numbers, colors, sale channels. For hazard concepts, prefer hazard_search; for the recall headline, prefer title_search.',
      ),
    remedy: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Keyword search within the free-text remedy instructions, e.g. "repair", "refund", "firmware update"; matches instructions containing every word, in any order. This searches the remedy text, not the remedy_options categories — "repair" matches records whose remedy_options list only "Refund" but whose instructions describe a free repair kit. Combines with the other filters using AND; use hazard_search instead to match remedy text as one of several fields.',
      ),
    hazard_search: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Hazard or safety-concept keyword, e.g. "fire", "choking", "burn", "tip-over dresser". Matches when every word appears in the hazard descriptions, product names, or remedy instructions — each word in any of the three, in any order, case-insensitive. The filter to use for hazard types; combine it with another filter to narrow a broad hazard.',
      ),
    date_start: z
      .union([z.literal(''), z.iso.date().describe('ISO 8601 date: "YYYY-MM-DD".')])
      .optional()
      .describe(
        'Include only recalls on or after this date. ISO 8601 format: "YYYY-MM-DD". Must be a real calendar date — "2026-02-31" and "2026-99-99" are rejected.',
      ),
    date_end: z
      .union([z.literal(''), z.iso.date().describe('ISO 8601 date: "YYYY-MM-DD".')])
      .optional()
      .describe(
        'Include only recalls on or before this date. ISO 8601 format: "YYYY-MM-DD". Must be a real calendar date, and on or after date_start.',
      ),
    updated_start: z
      .union([z.literal(''), z.iso.date().describe('ISO 8601 date: "YYYY-MM-DD".')])
      .optional()
      .describe(
        'Include only recalls last published by CPSC on or after this date. ISO 8601 format: "YYYY-MM-DD". A separate axis from date_start: a 2003 recall re-published in 2025 matches updated_start "2025-01-01". Use to answer "what has CPSC updated recently". Must be a real calendar date.',
      ),
    updated_end: z
      .union([z.literal(''), z.iso.date().describe('ISO 8601 date: "YYYY-MM-DD".')])
      .optional()
      .describe(
        'Include only recalls last published by CPSC on or before this date. ISO 8601 format: "YYYY-MM-DD". Must be a real calendar date, and on or after updated_start.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(20)
      .describe(
        'Maximum number of recalls to return on this page. Defaults to 20. A page returns fewer when it reaches the 64,000-byte response size budget; has_more then says more remain.',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Skip this many matching records before returning results. To page through total_found, raise offset by the number of recalls the previous page returned — limit, unless that page reached the response size budget. An offset at or past total_found returns an empty result set rather than an error.',
      ),
  }),

  output: z.object({
    recalls: z.array(recallSchema).describe('Matching recalls, ordered newest-first.'),
    total_found: z
      .number()
      .describe(
        'Total matching records, counted after every filter is applied and before offset, limit, and the response size budget narrow the window.',
      ),
    truncated: z
      .boolean()
      .describe('True when matching records remain past this page — always equal to has_more.'),
    offset: z.number().describe('Number of matching records skipped before this window.'),
    has_more: z
      .boolean()
      .describe(
        'True when records remain past this window — call again with offset raised by the number of recalls returned.',
      ),
    cpsc_jurisdiction: z
      .string()
      .describe(
        'Which products CPSC covers and which agencies cover the rest — food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF).',
      ),
    source_note: z
      .string()
      .describe(
        'Provenance caveat: recall fields are CPSC record text with HTML markup and character codes converted to plain text, not otherwise edited or verified; check cpsc_url before a consumer-facing decision.',
      ),
  }),

  enrichment: {
    effectiveQuery: z
      .string()
      .describe(
        'The search criteria as applied, joined with AND: each non-blank text filter trimmed, the hazard alias resolved to hazard_search, and blank date bounds dropped.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Present when the page needs explaining: zero matches (with which criterion to relax), an offset past the last match, or a page cut short by the response size budget (with the offset to continue from).',
      ),
  },

  errors: [
    {
      reason: 'missing_criteria',
      code: JsonRpcErrorCode.ValidationError,
      when: 'No search criterion was given: every text filter was omitted or blank and no date bound was set',
      recovery:
        'Set at least one criterion — title_search, product_name, manufacturer, importer, retailer, distributor, description_search, remedy, hazard_search, or a date bound (date_start, date_end, updated_start, updated_end). To browse the latest recalls without a filter, call cpsc_get_recent instead.',
    },
    {
      reason: 'invalid_date_range',
      code: JsonRpcErrorCode.ValidationError,
      when: 'date_start is later than date_end, or updated_start is later than updated_end, so the range can never match',
      recovery:
        'Swap the two dates, or drop one of them. date_start and date_end bound the recall issue date; updated_start and updated_end bound the date CPSC last published the record.',
    },
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The CPSC recall service (saferproducts.gov) was unavailable, timed out, reported a temporary failure reading its recall data, or sent an unreadable response',
      recovery: 'The CPSC recall service is occasionally unavailable. Retry in a few seconds.',
      retryable: true,
    },
    {
      reason: 'upstream_rejected',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'CPSC rejected the request instead of returning recalls, and it rejects the same request every time',
      recovery:
        'Do not retry this request unchanged — it fails deterministically. Read the message for what CPSC rejected, then change a filter value and call again.',
      retryable: false,
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Searching CPSC recalls', {
      product_name: input.product_name,
      manufacturer: input.manufacturer,
      retailer: input.retailer,
      importer: input.importer,
      distributor: input.distributor,
      title_search: input.title_search,
      description_search: input.description_search,
      remedy: input.remedy,
      hazard_search: input.hazard_search,
      date_start: input.date_start,
      date_end: input.date_end,
      updated_start: input.updated_start,
      updated_end: input.updated_end,
      limit: input.limit,
      offset: input.offset,
    });

    /** A blank or whitespace-only text filter is omitted, as the date fields already treat "". */
    const filters = TEXT_FILTERS.flatMap((filter): AppliedFilter[] => {
      const value = input[filter.key]?.trim().split(/\s+/).join(' ');
      return value ? [{ ...filter, value, words: fold(value).split(' ') }] : [];
    });
    const dateBounds = DATE_BOUNDS.flatMap((key) => {
      const value = input[key];
      return value ? [{ key, value }] : [];
    });

    if (filters.length === 0 && dateBounds.length === 0) {
      throw ctx.fail(
        'missing_criteria',
        'cpsc_search_recalls needs at least one criterion — a non-blank text filter or a date bound. limit and offset alone do not narrow a search.',
        { ...ctx.recoveryFor('missing_criteria') },
      );
    }

    if (input.date_start && input.date_end && input.date_start > input.date_end) {
      throw ctx.fail(
        'invalid_date_range',
        `date_start "${input.date_start}" is later than date_end "${input.date_end}".`,
        { ...ctx.recoveryFor('invalid_date_range') },
      );
    }

    if (input.updated_start && input.updated_end && input.updated_start > input.updated_end) {
      throw ctx.fail(
        'invalid_date_range',
        `updated_start "${input.updated_start}" is later than updated_end "${input.updated_end}".`,
        { ...ctx.recoveryFor('invalid_date_range') },
      );
    }

    const params: CpscSearchParams = {
      ...(input.date_start && { RecallDateStart: input.date_start }),
      ...(input.date_end && { RecallDateEnd: input.date_end }),
      ...(input.updated_start && { LastPublishDateStart: input.updated_start }),
      ...(input.updated_end && { LastPublishDateEnd: input.updated_end }),
    };
    for (const filter of filters) {
      if (!filter.param) continue;
      const word = upstreamWord(filter.value);
      if (word) params[filter.param] = word;
    }
    if (Object.keys(params).length === 0) params.RecallDateStart = RECALL_DATE_FLOOR;

    const svc = getCpscRecallService();
    let raw: RawRecall[];
    try {
      raw = await svc.search(params, ctx);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (err instanceof McpError && err.data?.retryable === false) {
        throw ctx.fail(
          'upstream_rejected',
          detail,
          { ...ctx.recoveryFor('upstream_rejected') },
          { cause: err },
        );
      }
      throw ctx.fail(
        'upstream_error',
        `CPSC API request failed: ${detail}`,
        { ...ctx.recoveryFor('upstream_error') },
        { cause: err },
      );
    }

    /**
     * Word checks run over the full upstream array: total_found counts post-filter but
     * pre-window, so the offset/limit slice comes last. hazard_search runs after the others
     * so a zero-match notice can say how many records it removed.
     */
    const hazardFilter = filters.find((f) => f.key === 'hazard_search');
    const otherFilters = filters.filter((f) => f !== hazardFilter);
    const matchedBeforeHazard = raw.filter((r) =>
      otherFilters.every((f) => matchesEveryWord(r, f)),
    );
    const matched = hazardFilter
      ? matchedBeforeHazard.filter((r) => matchesEveryWord(r, hazardFilter))
      : matchedBeforeHazard;

    const total_found = matched.length;
    const window = matched.slice(input.offset, input.offset + input.limit).map(toSearchRecall);
    const effectiveQuery = [
      ...filters.map((f) => `${f.key}=${JSON.stringify(f.value)}`),
      ...dateBounds.map((d) => `${d.key}=${d.value}`),
    ].join(' AND ');

    const page = {
      total_found,
      offset: input.offset,
      cpsc_jurisdiction: JURISDICTION,
      source_note: SOURCE_NOTE,
    };

    /**
     * The overhead reserves the page's worst case: the longest footer (truncated, with a
     * next-page offset for a full limit of records) and a budget notice at the same counts.
     */
    const overhead = pageOverheadBytes(
      { ...page, recalls: [], truncated: false, has_more: false },
      renderFooter({ ...page, truncated: true, has_more: true }, input.limit),
      {
        effectiveQuery,
        notice: budgetCutNotice(input.limit, input.limit, input.offset + input.limit),
      },
    );
    const returned = countWithinBudget(window, renderRecallBlock, overhead);
    const recalls = window.slice(0, returned);
    const has_more = input.offset + returned < total_found;

    /** One notice slot, last-wins: the three page states are mutually exclusive. */
    const notice =
      total_found === 0
        ? zeroMatchNotice(filters, matchedBeforeHazard.length, dateBounds.length > 0)
        : input.offset >= total_found
          ? `Offset ${input.offset} is past the last of the ${total_found} matching recall${total_found === 1 ? '' : 's'}, so this page is empty. Use an offset below ${total_found}.`
          : returned < window.length
            ? budgetCutNotice(returned, input.limit, input.offset + returned)
            : undefined;

    ctx.enrich.echo(effectiveQuery);
    if (notice) ctx.enrich.notice(notice);

    ctx.log.info('Search complete', {
      total_found,
      returned,
      offset: input.offset,
      has_more,
    });

    return { ...page, recalls, truncated: has_more, has_more };
  },

  format(result) {
    const text = [
      ...result.recalls.map(renderRecallBlock),
      renderFooter(result, result.recalls.length),
    ].join('\n');
    return [{ type: 'text', text }];
  },
});

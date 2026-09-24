/**
 * @fileoverview Fetch the most recent CPSC recalls ordered newest-first, scoped to a
 * configurable date window.
 * @module mcp-server/tools/definitions/cpsc-get-recent
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  budgetCutNotice,
  countWithinBudget,
  pageOverheadBytes,
} from '@/mcp-server/tools/response-budget.js';
import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';
import type { RawRecall } from '@/services/cpsc-recall/types.js';

/** Static jurisdiction note included in every response. */
const JURISDICTION =
  'CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF).';

/** Static provenance caveat included in every response. */
const SOURCE_NOTE =
  'Recall fields are relayed verbatim from the CPSC record and are neither edited nor verified by this server. CPSC records occasionally carry missing or inconsistent text. Check cpsc_url before acting on a recall for a consumer-facing decision.';

/** The longest window `days` accepts. */
const MAX_DAYS = 365;

/** Format a Date as "YYYY-MM-DD". */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const recentRecallSchema = z
  .object({
    recall_number: z
      .string()
      .describe('Recall identifier. Pass to cpsc_get_recall for full detail.'),
    recall_date: z.string().describe('Date issued, ISO 8601.'),
    title: z.string().describe('Recall title.'),
    hazards: z.array(z.string().describe('Hazard description.')).describe('What is dangerous.'),
    remedy_options: z
      .array(z.string().describe('Remedy type.'))
      .describe(
        'Remedy types: Refund, Repair, Replace, New Instructions, Dispose, Label, No Remedy Available, Inspect. Multiple may apply. Often empty — CPSC classified the remedy on fewer than half its records; call cpsc_get_recall for the remedy instructions when this is empty.',
      ),
    products: z.array(z.string().describe('Product name.')).describe('Product names recalled.'),
    cpsc_url: z.string().describe('Official CPSC recall page URL.'),
    data_quality_notes: z
      .array(z.string().describe('One gap found in the CPSC record.'))
      .describe(
        'Gaps this server observed in the CPSC record — absent hazard text, absent product entries. Derived from which fields CPSC left empty, not from any judgement about the recall itself. Empty when nothing is missing.',
      ),
  })
  .describe('A recent CPSC recall.');

type RecentRecall = z.infer<typeof recentRecallSchema>;

/** Shapes one upstream record for the response. */
function toRecentRecall(r: RawRecall): RecentRecall {
  const hazards = r.Hazards.map((h) => h.Name).filter(Boolean);
  const products = r.Products.map((p) => p.Name).filter(Boolean);

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
    products,
    cpsc_url: r.URL,
    data_quality_notes,
  };
}

/**
 * One recall's `content[]` block. `format()` and the response budget both call it, so the
 * bytes charged for a record are the bytes rendered for it.
 */
function renderRecallBlock(r: RecentRecall): string {
  const hazardText = r.hazards.length > 0 ? r.hazards.join('; ') : 'Not specified';
  const remedyText = r.remedy_options.length > 0 ? r.remedy_options.join(', ') : 'Not specified';
  const productText = r.products.length > 0 ? r.products.join(', ') : 'Not specified';

  const lines = [
    `**${r.recall_date}** — [${r.recall_number}] ${r.title}`,
    'CPSC source fields:',
    `Hazard: ${hazardText}  |  Remedy: ${remedyText}`,
    `Products: ${productText}`,
    `[CPSC page](${r.cpsc_url})`,
  ];
  if (r.data_quality_notes.length > 0) {
    lines.push(`**Data quality (server-assessed):** ${r.data_quality_notes.join(' ')}`);
  }
  lines.push('---');
  return lines.join('\n');
}

interface PageState {
  has_more: boolean;
  offset: number;
  period: { start: string; end: string; days: number };
  total_found: number;
  truncated: boolean;
}

/** The text before the record blocks, for a page that returned `returned` records. */
function renderHeader(page: PageState, returned: number): string {
  const { start, end, days } = page.period;
  const truncNote = page.truncated ? ' (truncated)' : '';
  const windowNote =
    page.truncated || page.offset > 0
      ? `, showing ${returned} from offset ${page.offset}${truncNote}`
      : '';
  const lines = [
    `# Recent CPSC Recalls — ${start} to ${end} (${days} day${days === 1 ? '' : 's'})`,
    '',
    `Found ${page.total_found} recall${page.total_found !== 1 ? 's' : ''}${windowNote}.`,
  ];
  if (page.has_more) {
    lines.push(`More available — repeat with offset ${page.offset + returned}.`);
  }
  lines.push('', '---');
  return lines.join('\n');
}

/** The text after the record blocks. */
function renderFooter(page: { source_note: string; cpsc_jurisdiction: string }): string {
  return `Source: ${page.source_note}\nCPSC jurisdiction: ${page.cpsc_jurisdiction}`;
}

export const cpscGetRecent = tool('cpsc_get_recent', {
  title: 'Get Recent CPSC Recalls',
  description:
    'Fetch the most recent CPSC consumer product recalls, newest-first, from a window of the last N days (default 30, up to 365). Use for "what\'s been recalled lately?" or a product safety feed; to find recalls by product, brand, hazard, or an older date range, use cpsc_search_recalls. Page past limit with offset: narrowing days cannot page, because the window is anchored to today and shrinking it drops the oldest recalls rather than advancing past the newest. A page returns fewer than limit recalls when it reaches the 64,000-byte response size budget; has_more and the notice give the offset to continue from. Pass a recall_number to cpsc_get_recall for the full record. CPSC jurisdiction: consumer products only — food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), and firearms (ATF) are covered by other agencies.',
  annotations: { readOnlyHint: true },

  input: z.object({
    days: z
      .number()
      .int()
      .min(1)
      .max(MAX_DAYS)
      .default(30)
      .describe(
        'Look back this many days from today. Defaults to 30. Use 7 for a weekly digest, 90 for a quarterly review.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe(
        'Maximum number of recalls to return. Defaults to 20. A page returns fewer when it reaches the 64,000-byte response size budget.',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Skip this many recalls in the window before returning results. To page through total_found, raise offset by the number of recalls the previous page returned — limit, unless that page reached the response size budget. An offset at or past total_found returns an empty result set rather than an error.',
      ),
  }),

  output: z.object({
    recalls: z.array(recentRecallSchema).describe('Recent recalls, newest-first.'),
    period: z
      .object({
        start: z.string().describe('Start date of the query window, ISO 8601.'),
        end: z.string().describe('End date (today), ISO 8601.'),
        days: z.number().describe('Window length in days.'),
      })
      .describe('Date range queried.'),
    total_found: z
      .number()
      .describe(
        'Total recalls in this period, counted before offset, limit, and the response size budget narrow the window.',
      ),
    truncated: z
      .boolean()
      .describe(
        'True when recalls in the window remain past this page — always equal to has_more.',
      ),
    offset: z.number().describe('Number of recalls skipped before this window.'),
    has_more: z
      .boolean()
      .describe(
        'True when recalls remain past this window — call again with offset raised by the number of recalls returned.',
      ),
    cpsc_jurisdiction: z
      .string()
      .describe(
        'Which products CPSC covers and which agencies cover the rest — food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF).',
      ),
    source_note: z
      .string()
      .describe(
        'Provenance caveat: recall fields are relayed from CPSC unedited and unverified; check cpsc_url before a consumer-facing decision.',
      ),
  }),

  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        'Present when the page needs explaining: a window with no recalls (with a larger days to try), an offset past the last recall, or a page cut short by the response size budget (with the offset to continue from).',
      ),
  },

  errors: [
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The CPSC recall service (saferproducts.gov) was unavailable, timed out, or sent an unreadable response',
      recovery: 'The CPSC recall service is occasionally unavailable. Retry in a few seconds.',
      retryable: true,
    },
    {
      reason: 'upstream_rejected',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'CPSC rejected the request instead of returning recalls, and it rejects the same request every time',
      recovery:
        'Do not retry this request unchanged — it fails deterministically. Read the message for what CPSC rejected, then try a different days window.',
      retryable: false,
    },
  ],

  async handler(input, ctx) {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - input.days);

    const dateStart = toIsoDate(startDate);
    const dateEnd = toIsoDate(endDate);
    const period = { start: dateStart, end: dateEnd, days: input.days };

    ctx.log.info('Fetching recent CPSC recalls', {
      days: input.days,
      date_start: dateStart,
      date_end: dateEnd,
      limit: input.limit,
      offset: input.offset,
    });

    const svc = getCpscRecallService();
    let raw: RawRecall[];
    try {
      raw = await svc.getRecent(dateStart, dateEnd, ctx);
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

    const total_found = raw.length;
    const window = raw.slice(input.offset, input.offset + input.limit).map(toRecentRecall);
    const page = {
      period,
      total_found,
      offset: input.offset,
      cpsc_jurisdiction: JURISDICTION,
      source_note: SOURCE_NOTE,
    };

    /**
     * The overhead reserves the page's worst case: the longest header (truncated, with a
     * next-page offset for a full limit of records) and a budget notice at the same counts.
     */
    const overhead = pageOverheadBytes(
      { ...page, recalls: [], truncated: false, has_more: false },
      `${renderHeader({ ...page, truncated: true, has_more: true }, input.limit)}\n${renderFooter(page)}`,
      { notice: budgetCutNotice(input.limit, input.limit, input.offset + input.limit) },
    );
    const returned = countWithinBudget(window, renderRecallBlock, overhead);
    const recalls = window.slice(0, returned);
    const has_more = input.offset + returned < total_found;

    /** One notice slot, last-wins: the three page states are mutually exclusive. */
    const notice =
      total_found === 0
        ? `No CPSC recalls were issued between ${dateStart} and ${dateEnd}.${
            input.days < MAX_DAYS
              ? ` Raise days (up to ${MAX_DAYS}) for a longer window.`
              : ` ${MAX_DAYS} days is the longest window this tool covers — use cpsc_search_recalls with date_start and date_end to reach older recalls.`
          }`
        : input.offset >= total_found
          ? `Offset ${input.offset} is past the last of the ${total_found} recall${total_found === 1 ? '' : 's'} in this window, so this page is empty. Use an offset below ${total_found}.`
          : returned < window.length
            ? budgetCutNotice(returned, input.limit, input.offset + returned)
            : undefined;
    if (notice) ctx.enrich.notice(notice);

    ctx.log.info('Recent recalls fetched', {
      total_found,
      returned,
      offset: input.offset,
      has_more,
    });

    return { ...page, recalls, truncated: has_more, has_more };
  },

  format(result) {
    const text = [
      renderHeader(result, result.recalls.length),
      ...result.recalls.map(renderRecallBlock),
      renderFooter(result),
    ].join('\n');
    return [{ type: 'text', text }];
  },
});

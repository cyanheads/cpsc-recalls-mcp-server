/**
 * @fileoverview Fetch the most recent CPSC recalls ordered newest-first, scoped to a
 * configurable date window.
 * @module mcp-server/tools/definitions/cpsc-get-recent
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { createCountPaging } from '@/mcp-server/tools/count-paging.js';
import { escapeMarkdown as md } from '@/mcp-server/tools/markdown-escape.js';
import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';
import { REMEDY_OPTIONS_DESCRIPTION } from '@/services/cpsc-recall/remedy-options.js';
import type { RawRecall } from '@/services/cpsc-recall/types.js';

/** Static jurisdiction note included in every response. */
const JURISDICTION =
  'CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing — including child-resistant packaging for drugs and supplements, ATVs and snowmobiles, bicycle tires, and gun safes and locks. Food and drugs (FDA), on-road vehicles and their tires (NHTSA), boats (USCG), pesticides (EPA), and firearms (ATF) belong to other agencies.';

/** Static provenance caveat included in every response. */
const SOURCE_NOTE =
  'Recall fields are CPSC record text, with HTML markup and character codes converted to plain text; this server does not otherwise edit or verify them. CPSC records occasionally carry missing or inconsistent text. Check cpsc_url before acting on a recall for a consumer-facing decision.';

/** The longest window `days` accepts. */
const MAX_DAYS = 365;

/** Most recalls one page holds. */
const PAGE_CEILING = 1_000;

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
        `${REMEDY_OPTIONS_DESCRIPTION} Open cpsc_get_recall for remedy instructions when the list is empty.`,
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

/** One recall's `content[]` block. */
function renderRecallBlock(r: RecentRecall): string {
  const hazardText = r.hazards.length > 0 ? md(r.hazards.join('; ')) : 'Not specified';
  const remedyText =
    r.remedy_options.length > 0 ? md(r.remedy_options.join(', ')) : 'Not specified';
  const productText = r.products.length > 0 ? md(r.products.join(', ')) : 'Not specified';

  const lines = [
    `**${r.recall_date}** — [${r.recall_number}] ${md(r.title)}`,
    'CPSC source fields:',
    `Hazard: ${hazardText}  |  Remedy: ${remedyText}`,
    `Products: ${productText}`,
    markdownLink('CPSC page', r.cpsc_url),
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

/** Creates the list definition for the configured limit policy. */
export function createCpscGetRecent(clampLimits: boolean) {
  const paging = createCountPaging('cpsc_get_recent', PAGE_CEILING, clampLimits);
  return tool('cpsc_get_recent', {
    title: 'Get Recent CPSC Recalls',
    description: `Fetch the most recent CPSC consumer product recalls, newest-first, from a window of the last N days (default 30, up to 365). Use for "what's been recalled lately?" or a product safety feed; to find recalls by product, brand, hazard, or an older date range, use cpsc_search_recalls. A page holds up to ${PAGE_CEILING.toLocaleString('en-US')} recalls. Continue by adding the number returned to offset. Narrowing days drops the oldest recalls because the window is anchored to today. Pass a recall_number to cpsc_get_recall for the full record. CPSC jurisdiction: consumer products, including child-resistant packaging for drugs and supplements, ATVs and snowmobiles, bicycle tires, and gun safes and locks; food and drugs (FDA), on-road vehicles and their tires (NHTSA), boats (USCG), pesticides (EPA), and firearms (ATF) belong to other agencies.`,
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
      limit: paging.limit,
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe(
          'Skip this many recalls in the window before returning results. To page through total_found, raise offset by the number of recalls the previous page returned. An offset at or past total_found returns an empty result set rather than an error.',
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
        .describe('Total recalls in this period, counted before offset and limit are applied.'),
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
          'Which products CPSC covers, including those near the lines of other agencies, and which agencies own food and drugs (FDA), on-road vehicles and their tires (NHTSA), boats (USCG), pesticides (EPA), and firearms (ATF).',
        ),
      source_note: z
        .string()
        .describe(
          'Provenance caveat: recall fields are CPSC record text with HTML markup and character codes converted to plain text, not otherwise edited or verified; check cpsc_url before a consumer-facing decision.',
        ),
    }),

    enrichment: {
      notice: z
        .string()
        .optional()
        .describe(
          `Present when the page needs explaining: a window with no recalls (with a larger days to try), an offset past the last recall, or a page capped at ${PAGE_CEILING} recalls under a larger limit with more recalls remaining (with the offset to continue from).`,
        ),
    },

    errors: [
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
          throw ctx.fail('upstream_rejected', detail, undefined, { cause: err });
        }
        throw ctx.fail('upstream_error', `CPSC API request failed: ${detail}`, undefined, {
          cause: err,
        });
      }

      const total_found = raw.length;
      const { rows, hasMore: has_more, capNotice } = paging.slice(raw, input, ctx);
      const recalls = rows.map(toRecentRecall);
      const returned = recalls.length;
      const page = {
        period,
        total_found,
        offset: input.offset,
        cpsc_jurisdiction: JURISDICTION,
        source_note: SOURCE_NOTE,
      };
      /**
       * One notice slot: an empty window and an offset past the end return no records, and a
       * short page returns some, so at most one state applies.
       */
      const notice =
        total_found === 0
          ? `No CPSC recalls were issued between ${dateStart} and ${dateEnd}.${
              input.days < MAX_DAYS
                ? ` Raise days (up to ${MAX_DAYS}) for a longer window.`
                : ` ${MAX_DAYS} days is the longest window this tool covers — use cpsc_search_recalls with date_start and date_end to reach older recalls.`
            }`
          : input.offset >= total_found
            ? `Offset ${input.offset} is past the last of the ${total_found} recall${total_found === 1 ? '' : 's'} in this window, so this page is empty. Use an offset below ${total_found}.`
            : capNotice;
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
}

/** Default definition used for discovery. */
export const cpscGetRecent = createCpscGetRecent(true);

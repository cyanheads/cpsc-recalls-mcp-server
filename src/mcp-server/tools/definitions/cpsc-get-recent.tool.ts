/**
 * @fileoverview Fetch the most recent CPSC recalls ordered newest-first, scoped to a
 * configurable date window.
 * @module mcp-server/tools/definitions/cpsc-get-recent
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';

/** Static jurisdiction note included in every response. */
const JURISDICTION =
  'CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. ' +
  'Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF).';

/** Static provenance caveat included in every response. */
const SOURCE_NOTE =
  'Recall fields are relayed verbatim from the CPSC record and are neither edited nor verified by this server. ' +
  'CPSC records occasionally carry missing or inconsistent text. ' +
  'Check cpsc_url before acting on a recall for a consumer-facing decision.';

/** Format a Date as "YYYY-MM-DD". */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const cpscGetRecent = tool('cpsc_get_recent', {
  title: 'Get Recent CPSC Recalls',
  description:
    'Fetch the most recent CPSC consumer product recalls, ordered newest-first. ' +
    'Use for "what\'s been recalled lately?" or a product safety feed. ' +
    'Always applies a date window (default: last 30 days) — without a date filter the API returns all 9,800+ records. ' +
    'Page past limit with offset: narrowing days cannot page, because the window is anchored to today and shrinking it drops the oldest records rather than advancing past the newest. ' +
    'CPSC jurisdiction: consumer products only — food, vehicles, drugs, and pesticides are covered by other agencies.',
  annotations: { readOnlyHint: true },

  input: z.object({
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
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
      .describe('Maximum number of recalls to return. Defaults to 20.'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Skip this many recalls in the window before returning results. Combine with limit to page through total_found — e.g. limit 20 with offset 0, 20, 40. ' +
          'An offset at or past total_found returns an empty result set rather than an error.',
      ),
  }),

  output: z.object({
    recalls: z
      .array(
        z
          .object({
            recall_number: z
              .string()
              .describe('Recall identifier. Pass to cpsc_get_recall for full detail.'),
            recall_date: z.string().describe('Date issued, ISO 8601.'),
            title: z.string().describe('Recall title.'),
            hazards: z
              .array(z.string().describe('Hazard description.'))
              .describe('What is dangerous.'),
            remedy_options: z
              .array(z.string().describe('Remedy type.'))
              .describe(
                'Remedy types: Refund, Repair, Replace, New Instructions, Dispose, Label, No Remedy Available, Inspect. ' +
                  'Multiple may apply. Often empty — CPSC classified the remedy on fewer than half its records; ' +
                  'call cpsc_get_recall for the remedy narrative when this is empty.',
              ),
            products: z
              .array(z.string().describe('Product name.'))
              .describe('Product names recalled.'),
            cpsc_url: z.string().describe('Official CPSC recall page URL.'),
            data_quality_notes: z
              .array(z.string().describe('One gap found in the upstream record.'))
              .describe(
                'Gaps this server observed in the upstream CPSC record — absent hazard text, absent product entries. ' +
                  'Derived from which fields CPSC left empty, not from any judgement about the recall itself. Empty when nothing is missing.',
              ),
          })
          .describe('A recent CPSC recall.'),
      )
      .describe('Recent recalls, newest-first.'),
    period: z
      .object({
        start: z.string().describe('Start date of the query window, ISO 8601.'),
        end: z.string().describe('End date (today), ISO 8601.'),
        days: z.number().describe('Window length in days.'),
      })
      .describe('Date range queried.'),
    total_found: z
      .number()
      .describe('Total recalls in this period, counted before offset and limit narrow the window.'),
    truncated: z
      .boolean()
      .describe('True when total_found exceeds the limit. Independent of offset.'),
    offset: z.number().describe('Number of recalls skipped before this window.'),
    has_more: z
      .boolean()
      .describe(
        'True when recalls remain past this window — call again with offset raised by the number of recalls returned.',
      ),
    cpsc_jurisdiction: z
      .string()
      .describe(
        'CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. ' +
          'Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF).',
      ),
    source_note: z
      .string()
      .describe(
        'Provenance caveat: recall fields are relayed from CPSC unedited and unverified; check cpsc_url before a consumer-facing decision.',
      ),
  }),

  errors: [
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The saferproducts.gov API returned a transient error or timed out',
      recovery: 'The CPSC API is occasionally unavailable. Retry in a few seconds.',
      retryable: true,
    },
    {
      reason: 'upstream_rejected',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The saferproducts.gov API answered with an error row instead of recall records, which the same request will always produce',
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

    ctx.log.info('Fetching recent CPSC recalls', {
      days: input.days,
      date_start: dateStart,
      date_end: dateEnd,
      limit: input.limit,
      offset: input.offset,
    });

    const svc = getCpscRecallService();
    let raw: Awaited<ReturnType<typeof svc.getRecent>>;
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
    const truncated = total_found > input.limit;
    // An offset at or past total_found is a valid empty page, not an error.
    const slice = raw.slice(input.offset, input.offset + input.limit);
    const has_more = input.offset + slice.length < total_found;

    const recalls = slice.map((r) => {
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
    });

    ctx.log.info('Recent recalls fetched', {
      total_found,
      returned: recalls.length,
      offset: input.offset,
      truncated,
      has_more,
    });

    return {
      recalls,
      period: { start: dateStart, end: dateEnd, days: input.days },
      total_found,
      truncated,
      offset: input.offset,
      has_more,
      cpsc_jurisdiction: JURISDICTION,
      source_note: SOURCE_NOTE,
    };
  },

  format(result) {
    const lines: string[] = [];

    lines.push(
      `# Recent CPSC Recalls — ${result.period.start} to ${result.period.end} (${result.period.days} days)`,
    );
    lines.push('');
    const truncNote = result.truncated ? ' (truncated by limit)' : '';
    const windowNote =
      result.truncated || result.offset > 0
        ? `, showing ${result.recalls.length} from offset ${result.offset}${truncNote}`
        : '';
    lines.push(
      `Found ${result.total_found} recall${result.total_found !== 1 ? 's' : ''}${windowNote}.`,
    );
    if (result.has_more) {
      lines.push(`More available — repeat with offset ${result.offset + result.recalls.length}.`);
    }
    lines.push('');
    lines.push('---');

    for (const r of result.recalls) {
      const hazardText = r.hazards.length > 0 ? r.hazards.join('; ') : 'Not specified';
      const remedyText =
        r.remedy_options.length > 0 ? r.remedy_options.join(', ') : 'Not specified';
      const productText = r.products.length > 0 ? r.products.join(', ') : 'Not specified';

      lines.push(`**${r.recall_date}** — [${r.recall_number}] ${r.title}`);
      lines.push('CPSC source fields:');
      lines.push(`Hazard: ${hazardText}  |  Remedy: ${remedyText}`);
      lines.push(`Products: ${productText}`);
      lines.push(`[CPSC page](${r.cpsc_url})`);
      if (r.data_quality_notes.length > 0) {
        lines.push(`**Data quality (server-assessed):** ${r.data_quality_notes.join(' ')}`);
      }
      lines.push('---');
    }

    lines.push(`Source: ${result.source_note}`);
    lines.push(`CPSC jurisdiction: ${result.cpsc_jurisdiction}`);

    return [{ type: 'text', text: lines.join('\n') }];
  },
});

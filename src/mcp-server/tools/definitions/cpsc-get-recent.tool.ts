/**
 * @fileoverview Fetch the most recent CPSC recalls ordered newest-first, scoped to a
 * configurable date window.
 * @module mcp-server/tools/definitions/cpsc-get-recent
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';

/** Static jurisdiction note included in every response. */
const JURISDICTION =
  'CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. ' +
  'Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF).';

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
            remedy_options: z.array(z.string().describe('Remedy type.')).describe('Remedy types.'),
            products: z
              .array(z.string().describe('Product name.'))
              .describe('Product names recalled.'),
            cpsc_url: z.string().describe('Official CPSC recall page URL.'),
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
    total_found: z.number().describe('Total recalls in this period before the limit was applied.'),
    truncated: z.boolean().describe('True when total_found exceeds the limit.'),
    cpsc_jurisdiction: z
      .string()
      .describe(
        'CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. ' +
          'Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF).',
      ),
  }),

  errors: [
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The saferproducts.gov API returned an error or timed out',
      recovery: 'The CPSC API is occasionally unavailable. Retry in a few seconds.',
      retryable: true,
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
    });

    const svc = getCpscRecallService();
    let raw: Awaited<ReturnType<typeof svc.getRecent>>;
    try {
      raw = await svc.getRecent(dateStart, dateEnd, ctx);
    } catch (err) {
      throw ctx.fail('upstream_error', 'CPSC API request failed.', {
        ...ctx.recoveryFor('upstream_error'),
        cause: err,
      });
    }

    const total_found = raw.length;
    const slice = raw.slice(0, input.limit);
    const truncated = total_found > input.limit;

    const recalls = slice.map((r) => ({
      recall_number: r.RecallNumber,
      recall_date: r.RecallDate.slice(0, 10),
      title: r.Title,
      hazards: r.Hazards.map((h) => h.Name).filter(Boolean),
      remedy_options: r.RemedyOptions.map((o) => o.Option).filter(Boolean),
      products: r.Products.map((p) => p.Name).filter(Boolean),
      cpsc_url: r.URL,
    }));

    ctx.log.info('Recent recalls fetched', { total_found, returned: recalls.length, truncated });

    return {
      recalls,
      period: { start: dateStart, end: dateEnd, days: input.days },
      total_found,
      truncated,
      cpsc_jurisdiction: JURISDICTION,
    };
  },

  format(result) {
    const lines: string[] = [];

    lines.push(
      `# Recent CPSC Recalls — ${result.period.start} to ${result.period.end} (${result.period.days} days)`,
    );
    lines.push('');
    const truncNote = result.truncated
      ? `, showing first ${result.recalls.length} (truncated)`
      : '';
    lines.push(
      `Found ${result.total_found} recall${result.total_found !== 1 ? 's' : ''}${truncNote}.`,
    );
    lines.push('');
    lines.push('---');

    for (const r of result.recalls) {
      const hazardText = r.hazards.length > 0 ? r.hazards.join('; ') : 'Not specified';
      const remedyText =
        r.remedy_options.length > 0 ? r.remedy_options.join(', ') : 'Not specified';
      const productText = r.products.length > 0 ? r.products.join(', ') : 'Not specified';

      lines.push(`**${r.recall_date}** — [${r.recall_number}] ${r.title}`);
      lines.push(`Hazard: ${hazardText}  |  Remedy: ${remedyText}`);
      lines.push(`Products: ${productText}`);
      lines.push(`[CPSC page](${r.cpsc_url})`);
      lines.push('---');
    }

    lines.push(`CPSC jurisdiction: ${result.cpsc_jurisdiction}`);

    return [{ type: 'text', text: lines.join('\n') }];
  },
});

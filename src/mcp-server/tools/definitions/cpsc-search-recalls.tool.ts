/**
 * @fileoverview Search CPSC consumer product recalls by product name, brand, retailer,
 * hazard keyword, or date range.
 * @module mcp-server/tools/definitions/cpsc-search-recalls
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';

/** Static jurisdiction note included in every response. */
const JURISDICTION =
  'CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. ' +
  'Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF). ' +
  'For those categories, use the appropriate server.';

/** Static provenance caveat included in every response. */
const SOURCE_NOTE =
  'Recall fields are relayed verbatim from the CPSC record and are neither edited nor verified by this server. ' +
  'CPSC records occasionally carry missing or inconsistent text. ' +
  'Check cpsc_url before acting on a recall for a consumer-facing decision.';

export const cpscSearchRecalls = tool('cpsc_search_recalls', {
  title: 'Search CPSC Recalls',
  description:
    'Search consumer product recalls from the CPSC (Consumer Product Safety Commission) database. ' +
    "Covers toys, electronics, furniture, appliances, children's products, tools, and clothing — everything under CPSC jurisdiction. " +
    'Does NOT cover food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), or pesticides (EPA). ' +
    'All filter fields are optional substring matches that combine with AND. ' +
    'Start with title_search when you have a product in hand — CPSC titles carry the brand, product, and hazard phrasing. ' +
    'For hazard-type filtering ("fire", "choking", "burn"), use hazard_search, which matches hazard text, product names, and remedy instructions in one pass. ' +
    'When manufacturer returns no results, try importer, retailer, or distributor: many recalls list one of those as the primary responsible org. ' +
    'Page past limit with offset — total_found and has_more say where the window sits in the full result set. ' +
    'Use cpsc_get_recall with a recall_number from results to retrieve the full record including complete description, all images, and incident reports.',
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
      .optional()
      .describe(
        'Product name to search for, e.g. "crib", "space heater", "bicycle". Substring match — partial names work.',
      ),
    manufacturer: z
      .string()
      .optional()
      .describe(
        'Manufacturer name, e.g. "Samsung", "LEGO". Substring match against the Manufacturers array. ' +
          'Note: many recalls list the importer or retailer as the primary org rather than the manufacturer — try importer or retailer if this returns no results.',
      ),
    retailer: z
      .string()
      .optional()
      .describe(
        'Retailer name, e.g. "Walmart", "Target", "Amazon". Substring match against the retailer narrative (which includes store name, dates sold, and price).',
      ),
    importer: z
      .string()
      .optional()
      .describe(
        'Importer company name. Use when searching for recalls by the company that brought the product into the US.',
      ),
    distributor: z
      .string()
      .optional()
      .describe(
        'Distributor company name, e.g. "Walmart", "Costco". Substring match against the Distributors array — a role distinct from retailer and importer, and populated on far fewer records.',
      ),
    title_search: z
      .string()
      .optional()
      .describe(
        'Keyword search within the recall Title, e.g. "chandelier", "space heater", "inclined sleeper". Substring match. ' +
          'CPSC titles name the brand, the product, and the hazard, which makes this the highest-signal single filter for most searches.',
      ),
    description_search: z
      .string()
      .optional()
      .describe(
        'Keyword search within the recall Description field only (does not search Title, Hazards, or remedy text). ' +
          'Use for product details not captured in product_name — model numbers, colors, sale channels. ' +
          'For hazard concepts, prefer hazard_search; for the recall headline, prefer title_search.',
      ),
    remedy: z
      .string()
      .optional()
      .describe(
        'Keyword search within the free-text remedy instructions, e.g. "repair", "refund", "firmware update". Substring match, applied upstream. ' +
          'This searches the remedy narrative, not the structured remedy_options enum — "repair" matches records whose remedy_options list only "Refund" but whose instructions describe a free repair kit. ' +
          'Combines with the other filters using AND; use hazard_search instead to match remedy text as one of several fields.',
      ),
    hazard_search: z
      .string()
      .optional()
      .describe(
        'Hazard or safety-concept keyword, e.g. "fire", "choking", "burn", "laceration". Applied client-side after the upstream fetch. ' +
          'Matches when the term appears in any of: hazard descriptions, product names, or remedy instructions (OR across the three, case-insensitive substring). ' +
          'Use this rather than the upstream Hazard parameter, which CPSC recognizes but never matches.',
      ),
    date_start: z
      .union([z.literal(''), z.iso.date().describe('ISO 8601 date: "YYYY-MM-DD".')])
      .optional()
      .describe(
        'Include only recalls on or after this date. ISO 8601 format: "YYYY-MM-DD". ' +
          'Must be a real calendar date — "2026-02-31" and "2026-99-99" are rejected.',
      ),
    date_end: z
      .union([z.literal(''), z.iso.date().describe('ISO 8601 date: "YYYY-MM-DD".')])
      .optional()
      .describe(
        'Include only recalls on or before this date. ISO 8601 format: "YYYY-MM-DD". ' +
          'Must be a real calendar date, and on or after date_start.',
      ),
    updated_start: z
      .union([z.literal(''), z.iso.date().describe('ISO 8601 date: "YYYY-MM-DD".')])
      .optional()
      .describe(
        'Include only recalls last published by CPSC on or after this date. ISO 8601 format: "YYYY-MM-DD". ' +
          'A separate axis from date_start: a 2003 recall re-published in 2025 matches updated_start "2025-01-01". ' +
          'Use to answer "what has CPSC updated recently". Must be a real calendar date.',
      ),
    updated_end: z
      .union([z.literal(''), z.iso.date().describe('ISO 8601 date: "YYYY-MM-DD".')])
      .optional()
      .describe(
        'Include only recalls last published by CPSC on or before this date. ISO 8601 format: "YYYY-MM-DD". ' +
          'Must be a real calendar date, and on or after updated_start.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(20)
      .describe(
        'Maximum number of results to return (applied client-side — the API returns all matches). Defaults to 20.',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Skip this many matching records before returning results. Combine with limit to page through total_found — e.g. limit 20 with offset 0, 20, 40. ' +
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
                'Remedy types: Refund, Repair, Replace, New Instructions, Dispose, Label, No Remedy Available, Inspect. ' +
                  'Multiple may apply. Often empty — CPSC classified the remedy on fewer than half its records; ' +
                  'read remedy_summary when this is empty, and cpsc_url when that is empty too.',
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
                'UPC codes for this recall (sparse — ~4% of records have UPCs). ' +
                  'UPCs are stored at the recall level in the API, not per-product; ' +
                  'when a recall covers multiple products, all UPCs apply to the recall as a whole.',
              ),
            manufacturers: z
              .array(z.string().describe('Manufacturer name.'))
              .describe(
                'Manufacturer names. Often empty — importer or retailer may be listed instead.',
              ),
            importers: z
              .array(z.string().describe('Importer name.'))
              .describe('Importer company names.'),
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
              .array(z.string().describe('One gap found in the upstream record.'))
              .describe(
                'Gaps this server observed in the upstream CPSC record — absent hazard text, absent product entries. ' +
                  'Derived from which fields CPSC left empty, not from any judgement about the recall itself. Empty when nothing is missing.',
              ),
          })
          .describe('A CPSC recall record.'),
      )
      .describe('Matching recalls, ordered newest-first.'),
    total_found: z
      .number()
      .describe(
        'Total matching records, counted after hazard_search is applied and before offset and limit narrow the window.',
      ),
    truncated: z
      .boolean()
      .describe('True when total_found exceeds the limit. Independent of offset.'),
    offset: z.number().describe('Number of matching records skipped before this window.'),
    has_more: z
      .boolean()
      .describe(
        'True when records remain past this window — call again with offset raised by the number of recalls returned.',
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
      reason: 'invalid_date_range',
      code: JsonRpcErrorCode.ValidationError,
      when: 'date_start is later than date_end, or updated_start is later than updated_end, so the range can never match',
      recovery:
        'Swap the two dates, or drop one of them. date_start and date_end bound the recall issue date; updated_start and updated_end bound the date CPSC last published the record.',
    },
    {
      reason: 'no_results',
      code: JsonRpcErrorCode.NotFound,
      when: 'No recalls matched the search filters, including hazard_search',
      recovery:
        'Broaden the search — try a shorter product name, fewer filters, or remove the date range. If hazard_search was set, drop it: it narrows the upstream results further, client-side. Check CPSC jurisdiction: food, vehicle, and drug recalls are not in this database.',
    },
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

    const svc = getCpscRecallService();
    let raw: Awaited<ReturnType<typeof svc.search>>;
    try {
      raw = await svc.search(
        {
          ...(input.product_name && { ProductName: input.product_name }),
          ...(input.manufacturer && { Manufacturer: input.manufacturer }),
          ...(input.retailer && { Retailer: input.retailer }),
          ...(input.importer && { Importer: input.importer }),
          ...(input.distributor && { Distributor: input.distributor }),
          ...(input.title_search && { RecallTitle: input.title_search }),
          ...(input.description_search && { RecallDescription: input.description_search }),
          ...(input.remedy && { Remedy: input.remedy }),
          ...(input.date_start && { RecallDateStart: input.date_start }),
          ...(input.date_end && { RecallDateEnd: input.date_end }),
          ...(input.updated_start && { LastPublishDateStart: input.updated_start }),
          ...(input.updated_end && { LastPublishDateEnd: input.updated_end }),
        },
        ctx,
      );
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
     * Normalize the full upstream array before anything narrows it: hazard_search filters
     * on normalized fields, and total_found must count post-filter but pre-window, so the
     * offset/limit slice is the last step.
     */
    const normalized = raw.map((r) => {
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
    });

    const needle = input.hazard_search?.trim().toLowerCase();
    const filtered = needle
      ? normalized.filter(
          (r) =>
            r.hazards.some((h) => h.toLowerCase().includes(needle)) ||
            r.products.some((p) => p.name.toLowerCase().includes(needle)) ||
            r.remedy_summary.toLowerCase().includes(needle),
        )
      : normalized;

    if (filtered.length === 0) {
      throw ctx.fail('no_results', 'No recalls matched the search filters.', {
        ...ctx.recoveryFor('no_results'),
      });
    }

    const total_found = filtered.length;
    const truncated = total_found > input.limit;
    // An offset at or past total_found is a valid empty page, not a no_results error.
    const recalls = filtered.slice(input.offset, input.offset + input.limit);
    const has_more = input.offset + recalls.length < total_found;

    ctx.log.info('Search complete', {
      total_found,
      returned: recalls.length,
      offset: input.offset,
      truncated,
      has_more,
    });

    return {
      recalls,
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

    for (const r of result.recalls) {
      lines.push(`## [${r.recall_number}] — ${r.title} (${r.recall_date})`);
      lines.push('CPSC source fields:');

      const hazardText = r.hazards.length > 0 ? r.hazards.join('; ') : 'Not specified';
      lines.push(`**Hazard:** ${hazardText}`);

      const remedyTypes =
        r.remedy_options.length > 0 ? r.remedy_options.join(', ') : 'Not specified';
      const remedyText = r.remedy_summary || 'See CPSC recall page.';
      lines.push(`**Remedy:** ${remedyTypes} — ${remedyText}`);

      const productNames = r.products
        .map((p) => `${p.name} (${p.units_recalled || 'units not specified'})`)
        .join('; ');
      lines.push(`**Products:** ${productNames || 'Not specified'}`);

      if (r.upcs.length > 0) {
        lines.push(`**UPCs:** ${r.upcs.join(', ')}`);
      }

      const soldBy = r.retailers.length > 0 ? r.retailers.join('; ') : 'Not specified';
      lines.push(`**Sold by:** ${soldBy}`);

      /**
       * Manufacturer and importer are distinct roles and CPSC org names contain commas,
       * so each role gets its own line and entries are separated with '; '.
       */
      if (r.manufacturers.length > 0) {
        lines.push(`**Manufacturer:** ${r.manufacturers.join('; ')}`);
      }
      if (r.importers.length > 0) {
        lines.push(`**Importer:** ${r.importers.join('; ')}`);
      }
      if (r.manufacturers.length === 0 && r.importers.length === 0) {
        lines.push('**Manufacturer/Importer:** Not specified');
      }

      if (r.images.length > 0) {
        const imgList = r.images.map((img) => `${img.caption}: ${img.url}`).join('; ');
        lines.push(`**Images (${r.images.length}):** ${imgList}`);
      } else {
        lines.push(`**Images:** None`);
      }
      lines.push(`[View recall](${r.cpsc_url})`);
      if (r.data_quality_notes.length > 0) {
        lines.push(`**Data quality (server-assessed):** ${r.data_quality_notes.join(' ')}`);
      }
      lines.push('---');
    }

    const truncNote = result.truncated ? ' (truncated by limit)' : '';
    const paging = result.has_more
      ? ` More available — repeat with offset ${result.offset + result.recalls.length}.`
      : '';
    lines.push(
      `Showing ${result.recalls.length} of ${result.total_found} recalls${truncNote}, starting at offset ${result.offset}.${paging}`,
    );
    lines.push(`Source: ${result.source_note}`);
    lines.push(`CPSC covers: ${result.cpsc_jurisdiction}`);

    return [{ type: 'text', text: lines.join('\n') }];
  },
});

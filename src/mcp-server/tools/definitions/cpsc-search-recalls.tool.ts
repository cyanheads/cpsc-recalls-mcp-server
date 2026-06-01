/**
 * @fileoverview Search CPSC consumer product recalls by product name, brand, retailer,
 * hazard keyword, or date range.
 * @module mcp-server/tools/definitions/cpsc-search-recalls
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';

/** Static jurisdiction note included in every response. */
const JURISDICTION =
  'CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. ' +
  'Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF). ' +
  'For those categories, use the appropriate server.';

export const cpscSearchRecalls = tool('cpsc_search_recalls', {
  title: 'Search CPSC Recalls',
  description:
    'Search consumer product recalls from the CPSC (Consumer Product Safety Commission) database. ' +
    "Covers toys, electronics, furniture, appliances, children's products, tools, and clothing — everything under CPSC jurisdiction. " +
    'Does NOT cover food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), or pesticides (EPA). ' +
    'All filter fields are optional substring matches that combine with AND. ' +
    'For hazard-type filtering ("fire", "choking", "burn"), use description_search — the dedicated Hazard filter is non-functional in the upstream API. ' +
    'When manufacturer returns no results, try importer or retailer: many recalls list the importer or retailer as the primary responsible org. ' +
    'Use cpsc_get_recall with a recall_number from results to retrieve the full record including complete description, all images, and incident reports.',
  annotations: { readOnlyHint: true, idempotentHint: true },

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
    description_search: z
      .string()
      .optional()
      .describe(
        'Keyword search within the recall Description field only (does not search Title or Hazards text). ' +
          'Use for hazard types like "fire", "choking", "burn", or to find product details not captured in product_name. ' +
          'Note: hazard keywords often appear in the Description field — this is the correct filter for hazard-type searching since the Hazard filter param is non-functional upstream.',
      ),
    date_start: z
      .string()
      .optional()
      .describe('Include only recalls on or after this date. ISO 8601 format: "YYYY-MM-DD".'),
    date_end: z
      .string()
      .optional()
      .describe('Include only recalls on or before this date. ISO 8601 format: "YYYY-MM-DD".'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(20)
      .describe(
        'Maximum number of results to return (applied client-side — the API returns all matches). Defaults to 20.',
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
                'Remedy types: Refund, Repair, Replace, Dispose, Label, New Instructions. Multiple may apply.',
              ),
            remedy_summary: z
              .string()
              .describe('Full remedy instructions — what the consumer should do and how to claim.'),
            products: z
              .array(
                z
                  .object({
                    name: z.string().describe('Product name.'),
                    units: z.string().describe('Number of units recalled, e.g. "About 2,500".'),
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
          })
          .describe('A CPSC recall record.'),
      )
      .describe('Matching recalls, ordered newest-first.'),
    total_found: z.number().describe('Total matching records before the limit was applied.'),
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
      reason: 'no_results',
      code: JsonRpcErrorCode.NotFound,
      when: 'No recalls matched the search filters',
      recovery:
        'Broaden the search — try a shorter product name, fewer filters, or remove the date range. Check CPSC jurisdiction: food, vehicle, and drug recalls are not in this database.',
    },
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The saferproducts.gov API returned an error or timed out',
      recovery: 'The CPSC API is occasionally unavailable. Retry in a few seconds.',
      retryable: true,
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Searching CPSC recalls', {
      product_name: input.product_name,
      manufacturer: input.manufacturer,
      retailer: input.retailer,
      importer: input.importer,
      description_search: input.description_search,
      date_start: input.date_start,
      date_end: input.date_end,
      limit: input.limit,
    });

    const svc = getCpscRecallService();
    let raw: Awaited<ReturnType<typeof svc.search>>;
    try {
      raw = await svc.search(
        {
          ...(input.product_name && { ProductName: input.product_name }),
          ...(input.manufacturer && { Manufacturer: input.manufacturer }),
          ...(input.retailer && { Retailer: input.retailer }),
          ...(input.importer && { Importer: input.importer }),
          ...(input.description_search && { RecallDescription: input.description_search }),
          ...(input.date_start && { RecallDateStart: input.date_start }),
          ...(input.date_end && { RecallDateEnd: input.date_end }),
        },
        ctx,
      );
    } catch (err) {
      throw ctx.fail('upstream_error', 'CPSC API request failed.', {
        ...ctx.recoveryFor('upstream_error'),
        cause: err,
      });
    }

    if (raw.length === 0) {
      throw ctx.fail('no_results', 'No recalls matched the search filters.', {
        ...ctx.recoveryFor('no_results'),
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
      remedy_summary: r.Remedies.map((rem) => rem.Name)
        .filter(Boolean)
        .join(' '),
      products: r.Products.map((p) => ({
        name: p.Name,
        units: p.NumberOfUnits ?? '',
      })),
      upcs: r.ProductUPCs.map((u) => u.UPC).filter(Boolean),
      manufacturers: r.Manufacturers.map((m) => m.Name).filter(Boolean),
      importers: r.Importers.map((i) => i.Name).filter(Boolean),
      retailers: r.Retailers.map((ret) => ret.Name).filter(Boolean),
      cpsc_url: r.URL,
      images: r.Images.map((img) => ({ url: img.URL, caption: img.Caption })),
    }));

    ctx.log.info('Search complete', { total_found, returned: recalls.length, truncated });

    return { recalls, total_found, truncated, cpsc_jurisdiction: JURISDICTION };
  },

  format(result) {
    const lines: string[] = [];

    for (const r of result.recalls) {
      lines.push(`## [${r.recall_number}] — ${r.title} (${r.recall_date})`);

      const hazardText = r.hazards.length > 0 ? r.hazards.join('; ') : 'Not specified';
      lines.push(`**Hazard:** ${hazardText}`);

      const remedyTypes =
        r.remedy_options.length > 0 ? r.remedy_options.join(', ') : 'Not specified';
      const remedyText = r.remedy_summary || 'See CPSC recall page.';
      lines.push(`**Remedy:** ${remedyTypes} — ${remedyText}`);

      const productNames = r.products
        .map((p) => `${p.name} (${p.units || 'units not specified'})`)
        .join(', ');
      lines.push(`**Products:** ${productNames || 'Not specified'}`);

      if (r.upcs.length > 0) {
        lines.push(`**UPCs:** ${r.upcs.join(', ')}`);
      }

      const soldBy = r.retailers.length > 0 ? r.retailers.join('; ') : 'Not specified';
      lines.push(`**Sold by:** ${soldBy}`);

      const orgs = [...r.manufacturers, ...r.importers];
      const orgText = orgs.length > 0 ? orgs.join(', ') : 'Not specified';
      lines.push(`**Manufacturer/Importer:** ${orgText}`);

      if (r.images.length > 0) {
        const imgList = r.images.map((img) => `${img.caption}: ${img.url}`).join('; ');
        lines.push(`**Images (${r.images.length}):** ${imgList}`);
      } else {
        lines.push(`**Images:** None`);
      }
      lines.push(`[View recall](${r.cpsc_url})`);
      lines.push('---');
    }

    lines.push(
      `Showing ${result.recalls.length} of ${result.total_found} recalls.${result.truncated ? ' Results truncated — narrow by date or filter to see more.' : ''}`,
    );
    lines.push(`CPSC covers: ${result.cpsc_jurisdiction}`);

    return [{ type: 'text', text: lines.join('\n') }];
  },
});

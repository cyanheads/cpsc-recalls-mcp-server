/**
 * @fileoverview Full detail for a single CPSC recall by recall number.
 * @module mcp-server/tools/definitions/cpsc-get-recall
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';

/** Static jurisdiction note included in every response. */
const JURISDICTION =
  'CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. ' +
  'Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF).';

export const cpscGetRecall = tool('cpsc_get_recall', {
  title: 'Get CPSC Recall Detail',
  description:
    'Full detail for a single CPSC recall by recall number. ' +
    'Returns the complete record: hazard description, remedy instructions, all product variants, ' +
    'incident/injury reports, images, and the official CPSC recall page URL. ' +
    'Use after cpsc_search_recalls or cpsc_get_recent to get the full picture on a specific recall. ' +
    'CPSC jurisdiction: consumer products only — food, vehicles, drugs, and pesticides are covered by other agencies.',
  annotations: { readOnlyHint: true, idempotentHint: true },

  input: z.object({
    recall_number: z
      .string()
      .regex(/^\d{5}([a-d])?$/)
      .describe(
        'CPSC recall number. Modern records (2002–present) are 5-digit numeric, e.g. "25043". ' +
          'Historical records from 1998–2001 may have a letter suffix a–d, e.g. "99003a". ' +
          'Obtain from cpsc_search_recalls results.',
      ),
  }),

  output: z.object({
    recall_number: z.string().describe('Recall identifier.'),
    recall_date: z.string().describe('Date issued, ISO 8601.'),
    last_updated: z.string().describe('Date last published, ISO 8601.'),
    title: z.string().describe('Official recall title.'),
    description: z
      .string()
      .describe(
        'Full recall description including product identification details. ' +
          'Model numbers are typically embedded here, not in a structured field.',
      ),
    cpsc_url: z
      .string()
      .describe('Official CPSC recall page — authoritative source for consumers.'),
    consumer_contact: z
      .string()
      .nullable()
      .describe('Contact information for claiming the remedy. Null when not provided.'),

    hazards: z
      .array(
        z
          .object({ description: z.string().describe('What is dangerous about this product.') })
          .describe('A hazard associated with this recall.'),
      )
      .describe('Hazards — read this first.'),

    remedy_options: z
      .array(z.string().describe('Remedy type.'))
      .describe(
        'Remedy types available: Refund, Repair, Replace, Dispose, Label, New Instructions.',
      ),
    remedy_instructions: z
      .string()
      .describe('Full remedy instructions — exactly what a consumer should do and how to claim.'),

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
      .describe(
        'Products covered. A recall may include multiple products. ' +
          'Note: model numbers are often in the description text, not a structured field.',
      ),

    upcs: z
      .array(z.string().describe('UPC code.'))
      .describe(
        'UPC codes for this recall (sparse — ~4% of records have UPCs). ' +
          'UPCs are stored at the recall level in the API, not per-product; ' +
          'when the recall covers multiple products, UPC-to-product attribution is ambiguous.',
      ),

    injuries: z
      .string()
      .describe('Injury and incident report narrative, e.g. "None reported" or incident count.'),

    manufacturers: z
      .array(z.string().describe('Manufacturer name.'))
      .describe('Manufacturer names (often empty — see importers).'),
    importers: z.array(z.string().describe('Importer name.')).describe('Importer company names.'),
    retailers: z
      .array(z.string().describe('Retailer name with sale date range and price.'))
      .describe('Retailer names with sale date ranges and price.'),
    distributors: z
      .array(z.string().describe('Distributor name.'))
      .describe('Distributor company names.'),
    manufacturer_countries: z
      .array(z.string().describe('Country of manufacture.'))
      .describe('Countries of manufacture.'),

    images: z
      .array(
        z
          .object({
            url: z.string().describe('Image URL.'),
            caption: z.string().describe('Caption describing what the image shows.'),
          })
          .describe('An image from the recall notice.'),
      )
      .describe('Product and identification images from the recall notice.'),

    coordinated_recalls: z
      .array(z.string().describe('URL of coordinated recall by another agency.'))
      .describe('URLs of coordinated recalls by other agencies (e.g., Canada Health).'),

    cpsc_jurisdiction: z
      .string()
      .describe(
        'CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. ' +
          'Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF).',
      ),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No recall exists with the given recall number',
      recovery:
        'Verify the recall number (e.g. "25043" for modern records, "99003a" for 1998–2001 historical records). Use cpsc_search_recalls or cpsc_get_recent to find the correct number.',
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
    ctx.log.info('Fetching CPSC recall detail', { recall_number: input.recall_number });

    const svc = getCpscRecallService();
    let raw: Awaited<ReturnType<typeof svc.getByNumber>>;
    try {
      raw = await svc.getByNumber(input.recall_number, ctx);
    } catch (err) {
      throw ctx.fail(
        'upstream_error',
        'CPSC API request failed.',
        { ...ctx.recoveryFor('upstream_error') },
        { cause: err },
      );
    }

    if (!raw) {
      throw ctx.fail('not_found', `No CPSC recall found with number "${input.recall_number}".`, {
        ...ctx.recoveryFor('not_found'),
      });
    }

    return {
      recall_number: raw.RecallNumber,
      recall_date: raw.RecallDate.slice(0, 10),
      last_updated: raw.LastPublishDate.slice(0, 10),
      title: raw.Title,
      description: raw.Description,
      cpsc_url: raw.URL,
      consumer_contact: raw.ConsumerContact,
      hazards: raw.Hazards.filter((h) => h.Name).map((h) => ({ description: h.Name })),
      remedy_options: raw.RemedyOptions.map((o) => o.Option).filter(Boolean),
      remedy_instructions: raw.Remedies.map((r) => r.Name)
        .filter(Boolean)
        .join(' '),
      products: raw.Products.map((p) => ({
        name: p.Name,
        units_recalled: p.NumberOfUnits ?? '',
      })),
      upcs: raw.ProductUPCs.map((u) => u.UPC).filter(Boolean),
      injuries: raw.Injuries.map((i) => i.Name)
        .filter(Boolean)
        .join(' '),
      manufacturers: raw.Manufacturers.map((m) => m.Name).filter(Boolean),
      importers: raw.Importers.map((i) => i.Name).filter(Boolean),
      retailers: raw.Retailers.map((r) => r.Name).filter(Boolean),
      distributors: raw.Distributors.map((d) => d.Name).filter(Boolean),
      manufacturer_countries: raw.ManufacturerCountries.map((c) => c.Country).filter(Boolean),
      images: raw.Images.map((img) => ({ url: img.URL, caption: img.Caption })),
      coordinated_recalls: raw.Inconjunctions.map((inj) => inj.URL).filter(Boolean),
      cpsc_jurisdiction: JURISDICTION,
    };
  },

  format(result) {
    const lines: string[] = [];

    lines.push(`# [${result.recall_number}] — ${result.title}`);
    lines.push(`Issued: ${result.recall_date} | Last updated: ${result.last_updated}`);
    lines.push('');

    const hazardText =
      result.hazards.length > 0
        ? result.hazards.map((h) => h.description).join('; ')
        : 'Not specified';
    lines.push(`**⚠️ Hazard:** ${hazardText}`);

    const remedyTypes =
      result.remedy_options.length > 0 ? result.remedy_options.join(', ') : 'Not specified';
    const remedyText = result.remedy_instructions || 'See CPSC recall page.';
    lines.push(`**✅ Remedy:** ${remedyTypes} — ${remedyText}`);

    const contact = result.consumer_contact ?? 'See CPSC recall page.';
    lines.push(`**Contact:** ${contact}`);
    lines.push('');

    lines.push('## Products Affected');
    for (const p of result.products) {
      lines.push(`- ${p.name} — ${p.units_recalled || 'units not specified'}`);
    }
    lines.push('**Note:** Model numbers are in the description text below if not listed here.');
    if (result.upcs.length > 0) {
      lines.push(
        `**UPCs (recall-level):** ${result.upcs.join(', ')} — applies to this recall as a whole`,
      );
    }
    lines.push('');

    lines.push('## Description');
    lines.push(result.description);
    lines.push('');

    lines.push('## Incidents / Injuries');
    lines.push(result.injuries || 'None reported');
    lines.push('');

    if (result.retailers.length > 0) {
      lines.push('## Sold By');
      for (const r of result.retailers) {
        lines.push(`- ${r}`);
      }
      lines.push('');
    }

    const orgs = [...result.manufacturers, ...result.importers];
    if (orgs.length > 0) {
      lines.push('## Manufactured By / Imported By');
      for (const org of orgs) {
        lines.push(`- ${org}`);
      }
    }
    if (result.manufacturer_countries.length > 0) {
      lines.push(`Country of origin: ${result.manufacturer_countries.join(', ')}`);
    }
    if (orgs.length > 0 || result.manufacturer_countries.length > 0) {
      lines.push('');
    }

    if (result.distributors.length > 0) {
      lines.push('## Distributors');
      for (const d of result.distributors) {
        lines.push(`- ${d}`);
      }
      lines.push('');
    }

    if (result.images.length > 0) {
      lines.push(`## Images (${result.images.length})`);
      for (const img of result.images) {
        lines.push(`- ${img.caption} — ${img.url}`);
      }
      lines.push('');
    }

    if (result.coordinated_recalls.length > 0) {
      lines.push('## Coordinated Recalls');
      for (const url of result.coordinated_recalls) {
        lines.push(`- ${url}`);
      }
      lines.push('');
    }

    lines.push(`[View official CPSC recall page](${result.cpsc_url})`);
    lines.push(`CPSC jurisdiction: ${result.cpsc_jurisdiction}`);

    return [{ type: 'text', text: lines.join('\n') }];
  },
});

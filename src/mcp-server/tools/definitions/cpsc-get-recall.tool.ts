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

/** Static provenance caveat included in every response. */
const SOURCE_NOTE =
  'Recall fields are relayed verbatim from the CPSC record and are neither edited nor verified by this server. ' +
  'CPSC records occasionally carry missing or inconsistent text. ' +
  'Check cpsc_url before acting on a recall for a consumer-facing decision.';

/** Rendered in place of an upstream narrative field CPSC left null or empty. */
const ABSENT_TEXT = '_Not provided by CPSC._';
/** Absence placeholder for fields a consumer can still resolve on the CPSC page. */
const ABSENT_TEXT_SEE_PAGE = '_Not provided by CPSC. See the CPSC recall page._';

/**
 * Renders relayed CPSC text as a markdown blockquote, so upstream narrative is visually
 * distinct from the server's own guidance. Prefixes every line — CPSC descriptions and
 * remedy instructions are frequently multi-line.
 *
 * Callers must leave a blank line after the returned block. Markdown lazy continuation
 * pulls an unseparated following line into the quote, which would render server-authored
 * guidance as CPSC source text — the exact opposite of the framing.
 */
function asSourceText(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

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
      .nullable()
      .describe(
        'Full recall description including product identification details. ' +
          'Model numbers are typically embedded here, not in a structured field. ' +
          'Null when CPSC published the record without a description — rare, but a genuine record can still be complete otherwise.',
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

    data_quality_notes: z
      .array(z.string().describe('One gap found in the upstream record.'))
      .describe(
        'Gaps this server observed in the upstream CPSC record — absent description, absent hazard text, absent product entries. ' +
          'Derived from which fields CPSC left empty, not from any judgement about the recall itself. Empty when nothing is missing.',
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

    const hazards = raw.Hazards.filter((h) => h.Name).map((h) => ({ description: h.Name }));
    const products = raw.Products.map((p) => ({
      name: p.Name,
      units_recalled: p.NumberOfUnits ?? '',
    }));

    const data_quality_notes: string[] = [];
    if (!raw.Description?.trim()) {
      data_quality_notes.push(
        'CPSC published no description text for this recall, so product identification details (including model numbers) are unavailable here.',
      );
    }
    if (hazards.length === 0) {
      data_quality_notes.push('CPSC listed no hazard description for this recall.');
    }
    if (products.length === 0) {
      data_quality_notes.push('CPSC listed no product entries for this recall.');
    }

    return {
      recall_number: raw.RecallNumber,
      recall_date: raw.RecallDate.slice(0, 10),
      last_updated: raw.LastPublishDate.slice(0, 10),
      title: raw.Title,
      description: raw.Description,
      cpsc_url: raw.URL,
      consumer_contact: raw.ConsumerContact,
      hazards,
      remedy_options: raw.RemedyOptions.map((o) => o.Option).filter(Boolean),
      remedy_instructions: raw.Remedies.map((r) => r.Name)
        .filter(Boolean)
        .join(' '),
      products,
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
      data_quality_notes,
      cpsc_jurisdiction: JURISDICTION,
      source_note: SOURCE_NOTE,
    };
  },

  /**
   * Relayed CPSC text is rendered as blockquotes under "(CPSC source text)" headings;
   * everything outside a blockquote is this server's own guidance.
   */
  format(result) {
    const lines: string[] = [];

    lines.push(`# [${result.recall_number}] — ${result.title}`);
    lines.push(`Issued: ${result.recall_date} | Last updated: ${result.last_updated}`);
    lines.push('Quoted blocks below are CPSC source text, relayed unedited.');
    lines.push('');

    lines.push('**⚠️ Hazard (CPSC source text):**');
    lines.push(
      result.hazards.length > 0
        ? asSourceText(result.hazards.map((h) => h.description).join('; '))
        : ABSENT_TEXT,
    );
    lines.push('');

    const remedyTypes =
      result.remedy_options.length > 0 ? result.remedy_options.join(', ') : 'Not specified';
    lines.push(`**✅ Remedy:** ${remedyTypes} — instructions from CPSC:`);
    lines.push(
      result.remedy_instructions ? asSourceText(result.remedy_instructions) : ABSENT_TEXT_SEE_PAGE,
    );
    lines.push('');

    lines.push('**Contact (CPSC source text):**');
    lines.push(
      result.consumer_contact ? asSourceText(result.consumer_contact) : ABSENT_TEXT_SEE_PAGE,
    );
    lines.push('');

    lines.push('## Products Affected (CPSC source text)');
    for (const p of result.products) {
      lines.push(`> - ${p.name} — ${p.units_recalled || 'units not specified'}`);
    }
    if (result.products.length === 0) {
      lines.push(ABSENT_TEXT);
    }
    if (result.upcs.length > 0) {
      // A bare '>' keeps the UPC line a sibling block inside the quote, not a list continuation.
      if (result.products.length > 0) {
        lines.push('>');
      }
      lines.push(`> UPCs (recall-level): ${result.upcs.join(', ')}`);
    }
    lines.push('');
    lines.push('Model numbers are in the description below if not listed here.');
    lines.push(
      'UPCs are recorded per recall, not per product, and apply to the recall as a whole.',
    );
    lines.push('');

    lines.push('## Description (CPSC source text)');
    lines.push(result.description?.trim() ? asSourceText(result.description) : ABSENT_TEXT);
    lines.push('');

    lines.push('## Incidents / Injuries (CPSC source text)');
    lines.push(result.injuries ? asSourceText(result.injuries) : ABSENT_TEXT);
    lines.push('');

    if (result.retailers.length > 0) {
      lines.push('## Sold By (CPSC source text)');
      for (const r of result.retailers) {
        lines.push(`> - ${r}`);
      }
      lines.push('');
    }

    /** Manufacturer and importer are distinct roles — each gets its own heading. */
    if (result.manufacturers.length > 0) {
      lines.push('## Manufactured By');
      for (const org of result.manufacturers) {
        lines.push(`- ${org}`);
      }
    }
    if (result.importers.length > 0) {
      lines.push('## Imported By');
      for (const org of result.importers) {
        lines.push(`- ${org}`);
      }
    }
    if (result.manufacturer_countries.length > 0) {
      lines.push(`Country of origin: ${result.manufacturer_countries.join(', ')}`);
    }
    if (
      result.manufacturers.length > 0 ||
      result.importers.length > 0 ||
      result.manufacturer_countries.length > 0
    ) {
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
      lines.push(`## Images (${result.images.length}) — captions are CPSC source text`);
      for (const img of result.images) {
        lines.push(`- ${img.url}`);
        lines.push(asSourceText(img.caption));
        lines.push('');
      }
    }

    if (result.coordinated_recalls.length > 0) {
      lines.push('## Coordinated Recalls');
      for (const url of result.coordinated_recalls) {
        lines.push(`- ${url}`);
      }
      lines.push('');
    }

    if (result.data_quality_notes.length > 0) {
      lines.push('## Data quality (server-assessed)');
      for (const note of result.data_quality_notes) {
        lines.push(`- ${note}`);
      }
      lines.push('');
    }

    lines.push(`[View official CPSC recall page](${result.cpsc_url})`);
    lines.push(`Source: ${result.source_note}`);
    lines.push(`CPSC jurisdiction: ${result.cpsc_jurisdiction}`);

    return [{ type: 'text', text: lines.join('\n') }];
  },
});

/**
 * @fileoverview Tests for the cpsc_get_recall tool.
 * @module tests/tools/cpsc-get-recall.tool.test
 */

import type { HandlerContext, ReasonOf } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cpscGetRecall } from '@/mcp-server/tools/definitions/cpsc-get-recall.tool.js';

const makeRaw = (overrides?: Record<string, unknown>) => ({
  RecallID: 1,
  RecallNumber: '25043',
  RecallDate: '2025-03-15T00:00:00',
  LastPublishDate: '2025-03-20T00:00:00',
  Title: 'ACME Widget Recall',
  Description: 'Fire hazard. Model: ACM-1234.',
  URL: 'https://www.cpsc.gov/Recalls/2025/acme-widget',
  ConsumerContact: 'Call 1-800-555-1234',
  SoldAtLabel: null,
  Products: [
    {
      Name: 'ACME Widget',
      Description: '',
      Model: '',
      Type: '',
      CategoryID: '',
      NumberOfUnits: 'About 5,000',
    },
  ],
  Inconjunctions: [{ URL: 'https://healthcanada.gc.ca/recalls/2025/123' }],
  Images: [{ URL: 'https://example.com/img.jpg', Caption: 'Product photo' }],
  Injuries: [{ Name: 'None reported' }],
  Manufacturers: [{ Name: 'ACME Corp', CompanyID: '' }],
  Retailers: [{ Name: 'Target (Feb 2024 – Mar 2025, $45)', CompanyID: '' }],
  Importers: [],
  Distributors: [],
  ManufacturerCountries: [{ Country: 'China' }],
  ProductUPCs: [{ UPC: '012345678901' }],
  Hazards: [{ Name: 'Fire hazard', HazardType: '', HazardTypeID: '' }],
  Remedies: [
    { Name: 'Consumers should stop using immediately and contact ACME for a full refund.' },
  ],
  RemedyOptions: [{ Option: 'Refund' }],
  ...overrides,
});

/** A full result matching the output schema, for exercising format() directly. */
const makeFormatResult = (overrides?: Record<string, unknown>) => ({
  recall_number: '25043',
  recall_date: '2025-03-15',
  last_updated: '2025-03-20',
  title: 'ACME Widget Recall',
  description: 'Fire hazard. Model: ACM-1234.',
  cpsc_url: 'https://www.cpsc.gov/Recalls/2025/acme-widget',
  consumer_contact: 'Call 1-800-555-1234',
  hazards: [{ description: 'Fire hazard' }],
  remedy_options: ['Refund'],
  remedy_instructions: 'Contact ACME for a full refund.',
  products: [{ name: 'ACME Widget', units_recalled: 'About 5,000' }],
  upcs: ['012345678901'],
  injuries: 'None reported',
  manufacturers: ['ACME Corp'],
  importers: [],
  retailers: ['Target (Feb 2024 – Mar 2025, $45)'],
  distributors: [],
  manufacturer_countries: ['China'],
  images: [{ url: 'https://example.com/img.jpg', caption: 'Product photo' }],
  coordinated_recalls: [],
  data_quality_notes: [],
  cpsc_jurisdiction: 'CPSC covers consumer products.',
  source_note:
    'Recall fields are relayed verbatim from the CPSC record and are neither edited nor verified by this server. Check cpsc_url before acting on a recall for a consumer-facing decision.',
  ...overrides,
});

vi.mock('@/services/cpsc-recall/cpsc-recall-service.js', () => ({
  getCpscRecallService: vi.fn(),
  initCpscRecallService: vi.fn(),
}));

import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';

/** The tool's declared error contract types the `ctx` its handler receives. */
type GetRecallContext = HandlerContext<ReasonOf<typeof cpscGetRecall.errors>>;

/** Content blocks are a union; narrow to the text channel before asserting on it. */
const textOf = (blocks: ReadonlyArray<{ type: string; text?: string }>): string =>
  blocks.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('');

/** The text channel `format()` alone produces. */
const formatText = (result: Parameters<NonNullable<typeof cpscGetRecall.format>>[0]): string =>
  textOf(cpscGetRecall.format!(result));

/** The text channel of a full wire result. */
const wireText = (result: { content?: ReadonlyArray<{ type: string; text?: string }> }): string =>
  textOf(result.content ?? []);

describe('cpsc_get_recall', () => {
  let ctx: GetRecallContext;
  const mockGetByNumber = vi.fn();

  beforeEach(() => {
    ctx = createMockContext({ errors: cpscGetRecall.errors });
    vi.mocked(getCpscRecallService).mockReturnValue({ getByNumber: mockGetByNumber } as never);
    mockGetByNumber.mockReset();
  });

  it('returns full normalized recall', async () => {
    mockGetByNumber.mockResolvedValueOnce(makeRaw());
    const input = cpscGetRecall.input.parse({ recall_number: '25043' });
    const result = await cpscGetRecall.handler(input, ctx);

    expect(result.recall_number).toBe('25043');
    expect(result.recall_date).toBe('2025-03-15');
    expect(result.last_updated).toBe('2025-03-20');
    expect(result.title).toBe('ACME Widget Recall');
    expect(result.description).toContain('Fire hazard');
    expect(result.hazards).toEqual([{ description: 'Fire hazard' }]);
    expect(result.remedy_options).toEqual(['Refund']);
    expect(result.remedy_instructions).toContain('refund');
    expect(result.products).toEqual([{ name: 'ACME Widget', units_recalled: 'About 5,000' }]);
    expect(result.upcs).toEqual(['012345678901']);
    expect(result.injuries).toBe('None reported');
    expect(result.manufacturers).toEqual(['ACME Corp']);
    expect(result.coordinated_recalls).toEqual(['https://healthcanada.gc.ca/recalls/2025/123']);
    expect(result.images).toHaveLength(1);
  });

  it('throws not_found when API returns null', async () => {
    mockGetByNumber.mockResolvedValueOnce(null);
    const input = cpscGetRecall.input.parse({ recall_number: '99999' });
    await expect(cpscGetRecall.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('throws upstream_error on service failure and carries the upstream message', async () => {
    mockGetByNumber.mockRejectedValueOnce(new Error('timeout'));
    const input = cpscGetRecall.input.parse({ recall_number: '25043' });
    await expect(cpscGetRecall.handler(input, ctx)).rejects.toMatchObject({
      message: 'CPSC API request failed: timeout',
      data: { reason: 'upstream_error', retryable: true },
    });
  });

  it('routes a non-retryable service error to upstream_rejected', async () => {
    mockGetByNumber.mockRejectedValueOnce(
      new McpError(
        JsonRpcErrorCode.ServiceUnavailable,
        'CPSC rejected the request: Invalid recall number.',
        { retryable: false },
      ),
    );
    const input = cpscGetRecall.input.parse({ recall_number: '25043' });
    await expect(cpscGetRecall.handler(input, ctx)).rejects.toMatchObject({
      message: 'CPSC rejected the request: Invalid recall number.',
      data: { reason: 'upstream_rejected', retryable: false },
    });
  });

  it('validates historical recall number format (letter suffix)', () => {
    // Historical format e.g. "99003a" — must pass regex
    expect(() => cpscGetRecall.input.parse({ recall_number: '99003a' })).not.toThrow();
    expect(() => cpscGetRecall.input.parse({ recall_number: '01160c' })).not.toThrow();
    // Must reject purely 6-digit numeric (doesn't exist in CPSC data)
    expect(() => cpscGetRecall.input.parse({ recall_number: '990032' })).toThrow();
    // Must reject letters beyond a-d
    expect(() => cpscGetRecall.input.parse({ recall_number: '99003e' })).toThrow();
  });

  it('includes cpsc_jurisdiction in result', async () => {
    mockGetByNumber.mockResolvedValueOnce(makeRaw());
    const input = cpscGetRecall.input.parse({ recall_number: '25043' });
    const result = await cpscGetRecall.handler(input, ctx);
    expect(result.cpsc_jurisdiction).toContain('CPSC covers');
    expect(result.cpsc_jurisdiction).toContain('NHTSA');
  });

  it('format renders hazard, remedy, products, images', () => {
    const text = formatText(makeFormatResult());
    expect(text).toContain('⚠️ Hazard');
    expect(text).toContain('Fire hazard');
    expect(text).toContain('✅ Remedy');
    expect(text).toContain('Refund');
    expect(text).toContain('ACME Widget');
    expect(text).toContain('012345678901');
    expect(text).toContain('None reported');
    expect(text).toContain('Product photo');
    expect(text).toContain('CPSC covers');
  });

  it('sparse payload — null consumer_contact surfaced as null', async () => {
    const raw = makeRaw({ ConsumerContact: null, ProductUPCs: [], Inconjunctions: [] });
    mockGetByNumber.mockResolvedValueOnce(raw);
    const input = cpscGetRecall.input.parse({ recall_number: '25043' });
    const result = await cpscGetRecall.handler(input, ctx);
    expect(result.consumer_contact).toBeNull();
    expect(result.upcs).toEqual([]);
    expect(result.coordinated_recalls).toEqual([]);
  });

  describe('absent upstream description', () => {
    it('returns an otherwise-complete record whose Description is null', async () => {
      mockGetByNumber.mockResolvedValueOnce(makeRaw({ RecallNumber: '04084', Description: null }));
      const input = cpscGetRecall.input.parse({ recall_number: '04084' });
      const result = await cpscGetRecall.handler(input, ctx);

      expect(result.description).toBeNull();
      expect(result.title).toBe('ACME Widget Recall');
      // The output schema is what rejected this record before — assert it now validates.
      expect(() => cpscGetRecall.output.parse(result)).not.toThrow();
    });

    it('notes the absence for both the null and empty-string forms', async () => {
      for (const Description of [null, '']) {
        mockGetByNumber.mockResolvedValueOnce(makeRaw({ Description }));
        const input = cpscGetRecall.input.parse({ recall_number: '25043' });
        const result = await cpscGetRecall.handler(input, ctx);

        expect(result.data_quality_notes).toContain(
          'CPSC published no description text for this recall, so product identification details (including model numbers) are unavailable here.',
        );
      }
    });

    it('renders a visible placeholder instead of a blank Description section', () => {
      for (const description of [null, '', '   ']) {
        const text = formatText(makeFormatResult({ description }));
        const section = text.slice(text.indexOf('## Description'));

        expect(section).toContain('_Not provided by CPSC._');
      }
    });

    it('renders the description as quoted CPSC source text when present', () => {
      const text = formatText(makeFormatResult({ description: 'Line one.\nLine two.' }));

      expect(text).toContain('## Description (CPSC source text)');
      expect(text).toContain('> Line one.\n> Line two.');
    });
  });

  describe('manufacturer / importer role attribution', () => {
    /** A real CPSC org name — commas inside the name made the merged list unreadable. */
    const importerWithCommas = 'Baituo Innovation Technology Co. Ltd., dba Romorgniz, of China';

    it('gives each role its own heading when both are populated', () => {
      const text = formatText(
        makeFormatResult({ manufacturers: ['ACME Corp'], importers: [importerWithCommas] }),
      );

      expect(text).toContain('## Manufactured By\n- ACME Corp');
      expect(text).toContain(`## Imported By\n- ${importerWithCommas}`);
      expect(text).not.toContain('## Manufactured By / Imported By');
    });

    it('renders only the manufacturer heading when there is no importer', () => {
      const text = formatText(makeFormatResult({ manufacturers: ['ACME Corp'], importers: [] }));

      expect(text).toContain('## Manufactured By');
      expect(text).not.toContain('## Imported By');
    });

    it('renders only the importer heading when there is no manufacturer', () => {
      const text = formatText(
        makeFormatResult({ manufacturers: [], importers: [importerWithCommas] }),
      );

      expect(text).toContain('## Imported By');
      expect(text).not.toContain('## Manufactured By');
    });

    it('still renders country of origin when neither role is populated', () => {
      const text = formatText(
        makeFormatResult({ manufacturers: [], importers: [], manufacturer_countries: ['China'] }),
      );

      expect(text).toContain('Country of origin: China');
    });
  });

  describe('data quality notes and source caveat', () => {
    it('populates a note per absent upstream field', async () => {
      mockGetByNumber.mockResolvedValueOnce(
        makeRaw({ Description: null, Hazards: [], Products: [] }),
      );
      const input = cpscGetRecall.input.parse({ recall_number: '25043' });
      const result = await cpscGetRecall.handler(input, ctx);

      expect(result.data_quality_notes).toHaveLength(3);
      expect(result.data_quality_notes[1]).toBe(
        'CPSC listed no hazard description for this recall.',
      );
      expect(result.data_quality_notes[2]).toBe('CPSC listed no product entries for this recall.');
    });

    it('leaves notes empty for a complete record', async () => {
      mockGetByNumber.mockResolvedValueOnce(makeRaw());
      const input = cpscGetRecall.input.parse({ recall_number: '25043' });
      const result = await cpscGetRecall.handler(input, ctx);

      expect(result.data_quality_notes).toEqual([]);
      expect(result.source_note).toContain('relayed verbatim from the CPSC record');
    });

    it('renders the notes section only when notes exist, and always the source caveat', () => {
      const withNotes = formatText(
        makeFormatResult({ data_quality_notes: ['CPSC listed no hazard description.'] }),
      );
      const withoutNotes = formatText(makeFormatResult());

      expect(withNotes).toContain('## Data quality (server-assessed)');
      expect(withNotes).toContain('- CPSC listed no hazard description.');
      expect(withoutNotes).not.toContain('## Data quality');
      expect(withoutNotes).toContain('relayed verbatim from the CPSC record');
      expect(withoutNotes).toContain('cpsc_url');
    });

    it('marks relayed narrative fields as CPSC source text', () => {
      const text = formatText(makeFormatResult());

      expect(text).toContain('Quoted blocks below are CPSC source text, relayed unedited.');
      expect(text).toContain('**⚠️ Hazard (CPSC source text):**\n> Fire hazard');
      expect(text).toContain('## Incidents / Injuries (CPSC source text)\n> None reported');
      expect(text).toContain('**Contact (CPSC source text):**\n> Call 1-800-555-1234');
      // Server-authored guidance stays outside the quoted blocks.
      expect(text).toContain('Model numbers are in the description below if not listed here.');
    });

    it('separates every quoted block from the guidance that follows it', () => {
      const text = formatText(makeFormatResult());
      const lines = text.split('\n');

      /**
       * Markdown lazy continuation folds an unseparated following line into the
       * preceding blockquote, which would render server guidance as CPSC source text.
       */
      for (const [i, line] of lines.entries()) {
        const next = lines[i + 1];
        if (!line.startsWith('>') || next === undefined) continue;
        expect(next.startsWith('>') || next === '').toBe(true);
      }
    });
  });
  /**
   * The wire envelope both client families read: `structuredContent` and the
   * `content[]` text channel must carry the same facts on success, and the same
   * reason plus recovery hint on failure.
   */
  describe('wire contract', () => {
    it('carries the record on structuredContent and in the text channel', async () => {
      mockGetByNumber.mockResolvedValueOnce(makeRaw());
      const result = await runToolContract(cpscGetRecall, { recall_number: '25043' });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        recall_number: '25043',
        title: 'ACME Widget Recall',
        remedy_options: ['Refund'],
      });
      expect(() => cpscGetRecall.output.parse(result.structuredContent)).not.toThrow();

      const text = wireText(result);
      expect(text).toContain('ACME Widget Recall');
      expect(text).toContain('Fire hazard');
      expect(text).toContain('012345678901');
    });

    it('reports not_found with its recovery hint on both surfaces', async () => {
      mockGetByNumber.mockResolvedValueOnce(null);
      const result = await runToolContract(cpscGetRecall, { recall_number: '99999' });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.NotFound,
          data: { reason: 'not_found', recovery: { hint: expect.stringContaining('25043') } },
        },
      });
      expect(wireText(result)).toContain('cpsc_search_recalls');
    });

    it('rejects an argument key the input schema does not declare', async () => {
      const result = await runToolContract(cpscGetRecall, {
        recall_number: '25043',
        recallNumber: '25043',
      } as never);

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.InvalidParams,
          message: expect.stringContaining('recallNumber'),
        },
      });
      expect(wireText(result)).toContain('recallNumber');
      expect(mockGetByNumber).not.toHaveBeenCalled();
    });
  });
});

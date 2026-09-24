/**
 * @fileoverview Tests for the cpsc_search_recalls tool.
 * @module tests/tools/cpsc-search-recalls.tool.test
 */

import { type HandlerContext, type ReasonOf, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cpscSearchRecalls } from '@/mcp-server/tools/definitions/cpsc-search-recalls.tool.js';

/** Minimal raw recall fixture matching the RawRecall shape the tool normalizes. */
const makeRaw = (overrides?: Record<string, unknown>) => ({
  RecallID: 1,
  RecallNumber: '25043',
  RecallDate: '2025-03-15T00:00:00',
  LastPublishDate: '2025-03-15T00:00:00',
  Title: 'ACME Widget Recall',
  Description: 'Fire hazard due to overheating.',
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
  Inconjunctions: [],
  Images: [{ URL: 'https://example.com/img.jpg', Caption: 'Product photo' }],
  Injuries: [{ Name: 'None reported' }],
  Manufacturers: [{ Name: 'ACME Corp', CompanyID: '' }],
  Retailers: [{ Name: 'Target', CompanyID: '' }],
  Importers: [],
  Distributors: [],
  ManufacturerCountries: [{ Country: 'China' }],
  ProductUPCs: [],
  Hazards: [{ Name: 'Fire hazard', HazardType: '', HazardTypeID: '' }],
  Remedies: [{ Name: 'Contact ACME for a refund.' }],
  RemedyOptions: [{ Option: 'Refund' }],
  ...overrides,
});

/** A single-recall result matching the output schema, for exercising format() directly. */
const makeFormatResult = (
  recallOverrides?: Record<string, unknown>,
  resultOverrides?: Record<string, unknown>,
) => ({
  recalls: [
    {
      recall_number: '25043',
      recall_date: '2025-03-15',
      title: 'ACME Widget Recall',
      hazards: ['Fire hazard'],
      remedy_options: ['Refund'],
      remedy_summary: 'Contact ACME for a refund.',
      products: [{ name: 'ACME Widget', units_recalled: 'About 5,000' }],
      upcs: ['012345678901'],
      manufacturers: ['ACME Corp'],
      importers: [],
      retailers: ['Target'],
      cpsc_url: 'https://www.cpsc.gov/Recalls/2025/acme-widget',
      images: [{ url: 'https://example.com/img.jpg', caption: 'Product photo' }],
      data_quality_notes: [],
      ...recallOverrides,
    },
  ],
  total_found: 1,
  truncated: false,
  offset: 0,
  has_more: false,
  cpsc_jurisdiction: 'CPSC covers consumer products.',
  source_note:
    'Recall fields are relayed verbatim from the CPSC record and are neither edited nor verified by this server. Check cpsc_url before acting on a recall for a consumer-facing decision.',
  ...resultOverrides,
});

vi.mock('@/services/cpsc-recall/cpsc-recall-service.js', () => ({
  getCpscRecallService: vi.fn(),
  initCpscRecallService: vi.fn(),
}));

import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';

/** The tool's declared error contract types the `ctx` its handler receives. */
type SearchRecallsContext = HandlerContext<ReasonOf<typeof cpscSearchRecalls.errors>>;

/** Content blocks are a union; narrow to the text channel before asserting on it. */
const textOf = (blocks: ReadonlyArray<{ type: string; text?: string }>): string =>
  blocks.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('');

/** The text channel `format()` alone produces. */
const formatText = (result: Parameters<NonNullable<typeof cpscSearchRecalls.format>>[0]): string =>
  textOf(cpscSearchRecalls.format!(result));

/** The text channel of a full wire result. */
const wireText = (result: { content?: ReadonlyArray<{ type: string; text?: string }> }): string =>
  textOf(result.content ?? []);

describe('cpsc_search_recalls', () => {
  let ctx: SearchRecallsContext;
  const mockSearch = vi.fn();

  beforeEach(() => {
    ctx = createMockContext({ errors: cpscSearchRecalls.errors });
    vi.mocked(getCpscRecallService).mockReturnValue({ search: mockSearch } as never);
    mockSearch.mockReset();
  });

  it('returns normalized recalls for a match', async () => {
    mockSearch.mockResolvedValueOnce([makeRaw()]);
    const input = cpscSearchRecalls.input.parse({ product_name: 'widget' });
    const result = await cpscSearchRecalls.handler(input, ctx);

    expect(result.total_found).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.recalls).toHaveLength(1);
    const r = result.recalls[0]!;
    expect(r.recall_number).toBe('25043');
    expect(r.recall_date).toBe('2025-03-15');
    expect(r.title).toBe('ACME Widget Recall');
    expect(r.hazards).toEqual(['Fire hazard']);
    expect(r.remedy_options).toEqual(['Refund']);
    expect(r.remedy_summary).toBe('Contact ACME for a refund.');
    expect(r.manufacturers).toEqual(['ACME Corp']);
    expect(r.retailers).toEqual(['Target']);
  });

  it('truncates when results exceed limit', async () => {
    const raws = Array.from({ length: 5 }, (_, i) => makeRaw({ RecallNumber: `2500${i}` }));
    mockSearch.mockResolvedValueOnce(raws);
    const input = cpscSearchRecalls.input.parse({ title_search: 'widget', limit: 3 });
    const result = await cpscSearchRecalls.handler(input, ctx);

    expect(result.total_found).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.recalls).toHaveLength(3);
  });

  it('returns an empty success with a zero-match notice when nothing matches', async () => {
    mockSearch.mockResolvedValueOnce([]);
    const input = cpscSearchRecalls.input.parse({ product_name: 'xyzzy' });
    const result = await cpscSearchRecalls.handler(input, ctx);

    expect(result).toMatchObject({
      recalls: [],
      total_found: 0,
      truncated: false,
      has_more: false,
    });
    const enrichment = getEnrichment(ctx);
    expect(enrichment.effectiveQuery).toBe('product_name="xyzzy"');
    expect(enrichment.notice).toContain('No recalls matched');
    expect(enrichment.notice).toContain('CPSC covers consumer products');
  });

  it('throws upstream_error on service failure', async () => {
    mockSearch.mockRejectedValueOnce(new Error('network error'));
    const input = cpscSearchRecalls.input.parse({ product_name: 'widget' });
    await expect(cpscSearchRecalls.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'upstream_error' },
    });
  });

  it('includes cpsc_jurisdiction in every result', async () => {
    mockSearch.mockResolvedValueOnce([makeRaw()]);
    const input = cpscSearchRecalls.input.parse({ title_search: 'widget' });
    const result = await cpscSearchRecalls.handler(input, ctx);
    expect(result.cpsc_jurisdiction).toContain('CPSC covers');
    expect(result.cpsc_jurisdiction).toContain('FDA');
  });

  it('handles multi-product recalls with recall-level UPCs', async () => {
    const raw = makeRaw({
      Products: [
        {
          Name: 'Widget A',
          Description: '',
          Model: '',
          Type: '',
          CategoryID: '',
          NumberOfUnits: 'About 1,000',
        },
        {
          Name: 'Widget B',
          Description: '',
          Model: '',
          Type: '',
          CategoryID: '',
          NumberOfUnits: 'About 500',
        },
      ],
      ProductUPCs: [{ UPC: '012345678901' }, { UPC: '012345678902' }],
    });
    mockSearch.mockResolvedValueOnce([raw]);
    const input = cpscSearchRecalls.input.parse({ title_search: 'widget' });
    const result = await cpscSearchRecalls.handler(input, ctx);

    expect(result.recalls[0]!.products).toHaveLength(2);
    // UPCs are recall-level — top-level field on the recall, not per-product
    expect(result.recalls[0]!.upcs).toEqual(['012345678901', '012345678902']);
    // Products themselves have no upcs field
    expect(result.recalls[0]!.products[0]).not.toHaveProperty('upcs');
  });

  it('format renders hazard, remedy, and products', () => {
    const text = formatText(makeFormatResult());
    expect(text).toContain('Fire hazard');
    expect(text).toContain('Refund');
    expect(text).toContain('ACME Widget');
    expect(text).toContain('012345678901');
    expect(text).toContain('ACME Corp');
    expect(text).toContain('CPSC covers');
  });

  it('sparse payload — handles empty Hazards, Remedies, RemedyOptions', async () => {
    const raw = makeRaw({ Hazards: [], Remedies: [], RemedyOptions: [], Manufacturers: [] });
    mockSearch.mockResolvedValueOnce([raw]);
    const input = cpscSearchRecalls.input.parse({ title_search: 'widget' });
    const result = await cpscSearchRecalls.handler(input, ctx);
    expect(result.recalls[0]!.hazards).toEqual([]);
    expect(result.recalls[0]!.remedy_options).toEqual([]);
    expect(result.recalls[0]!.remedy_summary).toBe('');
    expect(result.recalls[0]!.manufacturers).toEqual([]);
  });

  it('format renders each record block, then the paging footer, in order', () => {
    const sourceNote = makeFormatResult().source_note;
    const text = formatText(
      makeFormatResult(undefined, {
        recalls: [
          makeFormatResult().recalls[0],
          {
            recall_number: '25044',
            recall_date: '2024-01-02',
            title: 'Sparse Recall',
            hazards: [],
            remedy_options: [],
            remedy_summary: '',
            products: [],
            upcs: [],
            manufacturers: [],
            importers: [],
            retailers: [],
            cpsc_url: 'https://www.cpsc.gov/Recalls/2024/sparse',
            images: [],
            data_quality_notes: ['CPSC listed no hazard description for this recall.'],
          },
        ],
        total_found: 2,
      }),
    );

    expect(text).toBe(
      [
        '## [25043] — ACME Widget Recall (2025-03-15)',
        'CPSC source fields:',
        '**Hazard:** Fire hazard',
        '**Remedy:** Refund — Contact ACME for a refund.',
        '**Products:** ACME Widget (About 5,000)',
        '**UPCs:** 012345678901',
        '**Sold by:** Target',
        '**Manufacturer:** ACME Corp',
        '**Images (1):** Product photo: https://example.com/img.jpg',
        '[View recall](https://www.cpsc.gov/Recalls/2025/acme-widget)',
        '---',
        '## [25044] — Sparse Recall (2024-01-02)',
        'CPSC source fields:',
        '**Hazard:** Not specified',
        '**Remedy:** Not specified — See CPSC recall page.',
        '**Products:** Not specified',
        '**Sold by:** Not specified',
        '**Manufacturer/Importer:** Not specified',
        '**Images:** None',
        '[View recall](https://www.cpsc.gov/Recalls/2024/sparse)',
        '**Data quality (server-assessed):** CPSC listed no hazard description for this recall.',
        '---',
        'Showing 2 of 2 recalls, starting at offset 0.',
        `Source: ${sourceNote}`,
        'CPSC jurisdiction: CPSC covers consumer products.',
      ].join('\n'),
    );
  });

  describe('date filter validation', () => {
    it('rejects impossible calendar dates that match the digit shape', () => {
      expect(() => cpscSearchRecalls.input.parse({ date_start: '2026-99-99' })).toThrow();
      expect(() => cpscSearchRecalls.input.parse({ date_end: '2026-99-99' })).toThrow();
      // 2026 is not a leap year and February never has 31 days.
      expect(() => cpscSearchRecalls.input.parse({ date_start: '2026-02-31' })).toThrow();
      expect(() => cpscSearchRecalls.input.parse({ date_end: '2026-02-31' })).toThrow();
      expect(() => cpscSearchRecalls.input.parse({ date_start: '2026-02-29' })).toThrow();
    });

    it('accepts real calendar dates and the empty-string form-client value', () => {
      expect(() => cpscSearchRecalls.input.parse({ date_start: '2026-02-28' })).not.toThrow();
      expect(() => cpscSearchRecalls.input.parse({ date_start: '2024-02-29' })).not.toThrow();
      expect(() => cpscSearchRecalls.input.parse({ date_start: '', date_end: '' })).not.toThrow();
    });

    it('throws invalid_date_range when date_start is after date_end', async () => {
      const input = cpscSearchRecalls.input.parse({
        date_start: '2026-06-01',
        date_end: '2026-01-01',
      });
      await expect(cpscSearchRecalls.handler(input, ctx)).rejects.toMatchObject({
        data: { reason: 'invalid_date_range' },
      });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('accepts a range where start equals end', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const input = cpscSearchRecalls.input.parse({
        date_start: '2026-01-01',
        date_end: '2026-01-01',
      });
      await expect(cpscSearchRecalls.handler(input, ctx)).resolves.toBeDefined();
    });
  });

  describe('manufacturer / importer role attribution', () => {
    /** A real CPSC org name — commas inside the name are what made ', ' unparseable. */
    const importerWithCommas = 'Baituo Innovation Technology Co. Ltd., dba Romorgniz, of China';

    it('labels manufacturer and importer separately when both are populated', () => {
      const text = formatText(
        makeFormatResult({ manufacturers: ['ACME Corp'], importers: [importerWithCommas] }),
      );

      expect(text).toContain('**Manufacturer:** ACME Corp');
      expect(text).toContain(`**Importer:** ${importerWithCommas}`);
      expect(text).not.toContain('**Manufacturer/Importer:**');
    });

    it('renders only the manufacturer line when there is no importer', () => {
      const text = formatText(makeFormatResult({ manufacturers: ['ACME Corp'], importers: [] }));

      expect(text).toContain('**Manufacturer:** ACME Corp');
      expect(text).not.toContain('**Importer:**');
    });

    it('renders only the importer line when there is no manufacturer', () => {
      const text = formatText(
        makeFormatResult({ manufacturers: [], importers: [importerWithCommas] }),
      );

      expect(text).toContain(`**Importer:** ${importerWithCommas}`);
      expect(text).not.toContain('**Manufacturer:**');
    });

    it('separates multiple orgs in one role with "; " so comma-bearing names stay parseable', () => {
      const text = formatText(
        makeFormatResult({ manufacturers: [importerWithCommas, 'ACME Corp'], importers: [] }),
      );

      expect(text).toContain(`**Manufacturer:** ${importerWithCommas}; ACME Corp`);
    });

    it('falls back to a combined "Not specified" line when neither role is populated', () => {
      const text = formatText(makeFormatResult({ manufacturers: [], importers: [] }));

      expect(text).toContain('**Manufacturer/Importer:** Not specified');
    });
  });

  describe('data quality notes and source caveat', () => {
    it('populates notes for a record with no hazards and no products', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw({ Hazards: [], Products: [] })]);
      const input = cpscSearchRecalls.input.parse({ title_search: 'widget' });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls[0]!.data_quality_notes).toEqual([
        'CPSC listed no hazard description for this recall.',
        'CPSC listed no product entries for this recall.',
      ]);
      expect(cpscSearchRecalls.output.parse(result)).toBeDefined();
    });

    it('leaves notes empty for a complete record', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const input = cpscSearchRecalls.input.parse({ title_search: 'widget' });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls[0]!.data_quality_notes).toEqual([]);
    });

    it('renders notes only when present, and always renders the source caveat', () => {
      const withNotes = formatText(
        makeFormatResult({ data_quality_notes: ['CPSC listed no hazard description.'] }),
      );
      const withoutNotes = formatText(makeFormatResult());

      expect(withNotes).toContain('**Data quality (server-assessed):**');
      expect(withNotes).toContain('CPSC listed no hazard description.');
      expect(withoutNotes).not.toContain('Data quality');
      expect(withoutNotes).toContain('relayed verbatim from the CPSC record');
      expect(withoutNotes).toContain('cpsc_url');
    });

    it('carries the source caveat on the handler result', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const input = cpscSearchRecalls.input.parse({ title_search: 'widget' });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.source_note).toContain('relayed verbatim from the CPSC record');
    });
  });

  describe('upstream parameter mapping', () => {
    /** Run the handler with `overrides` and return the params object the service received. */
    const paramsFor = async (overrides: Record<string, unknown>) => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const input = cpscSearchRecalls.input.parse(overrides);
      await cpscSearchRecalls.handler(input, ctx);
      return mockSearch.mock.calls[0]![0] as Record<string, string>;
    };

    it('maps title_search to the upstream RecallTitle parameter', async () => {
      expect(await paramsFor({ title_search: 'chandelier' })).toEqual({
        RecallTitle: 'chandelier',
      });
    });

    it('maps distributor to the upstream Distributor parameter', async () => {
      expect(await paramsFor({ distributor: 'Walmart' })).toEqual({ Distributor: 'Walmart' });
    });

    it('maps remedy to the upstream Remedy parameter', async () => {
      expect(await paramsFor({ remedy: 'repair' })).toEqual({ Remedy: 'repair' });
    });

    it('maps updated_start and updated_end to the LastPublishDate range', async () => {
      expect(await paramsFor({ updated_start: '2026-07-01', updated_end: '2026-07-10' })).toEqual({
        LastPublishDateStart: '2026-07-01',
        LastPublishDateEnd: '2026-07-10',
      });
    });

    it('combines new filters with existing ones as a single AND query', async () => {
      expect(
        await paramsFor({
          title_search: 'chandelier',
          product_name: 'light',
          manufacturer: 'Currey',
          distributor: 'Walmart',
          remedy: 'refund',
          description_search: 'ceiling',
          date_start: '2020-01-01',
          updated_start: '2025-01-01',
        }),
      ).toEqual({
        RecallTitle: 'chandelier',
        ProductName: 'light',
        Manufacturer: 'Currey',
        Distributor: 'Walmart',
        Remedy: 'refund',
        RecallDescription: 'ceiling',
        RecallDateStart: '2020-01-01',
        LastPublishDateStart: '2025-01-01',
      });
    });

    it('omits empty-string date bounds from the upstream query', async () => {
      expect(await paramsFor({ updated_start: '', updated_end: '', title_search: 'crib' })).toEqual(
        {
          RecallTitle: 'crib',
        },
      );
    });

    it('rejects impossible calendar dates on the updated range', () => {
      expect(() => cpscSearchRecalls.input.parse({ updated_start: '2026-02-31' })).toThrow();
      expect(() => cpscSearchRecalls.input.parse({ updated_end: '2026-99-99' })).toThrow();
      expect(() => cpscSearchRecalls.input.parse({ updated_start: '2026-02-28' })).not.toThrow();
    });

    it('throws invalid_date_range when updated_start is after updated_end', async () => {
      const input = cpscSearchRecalls.input.parse({
        updated_start: '2026-06-01',
        updated_end: '2026-01-01',
      });
      await expect(cpscSearchRecalls.handler(input, ctx)).rejects.toMatchObject({
        data: { reason: 'invalid_date_range' },
      });
      expect(mockSearch).not.toHaveBeenCalled();
    });
  });

  describe('hazard_search (client-side filter)', () => {
    /** Term appears only in Hazards[].Name — not in Title, Description, products, or remedy. */
    const hazardOnly = makeRaw({
      RecallNumber: '30001',
      Title: 'ACME Widget Recall',
      Description: 'Sold nationwide from January to June.',
      Hazards: [{ Name: 'Laceration hazard', HazardType: '', HazardTypeID: '' }],
      Remedies: [{ Name: 'Contact ACME.' }],
    });
    /** Term appears only in a product name. */
    const productOnly = makeRaw({
      RecallNumber: '30002',
      Title: 'ACME Recall',
      Hazards: [{ Name: 'Fire hazard', HazardType: '', HazardTypeID: '' }],
      Products: [
        {
          Name: 'Bunk Bed Ladder',
          Description: '',
          Model: '',
          Type: '',
          CategoryID: '',
          NumberOfUnits: 'About 10',
        },
      ],
      Remedies: [{ Name: 'Contact ACME.' }],
    });
    /** Term appears only in the remedy narrative. */
    const remedyOnly = makeRaw({
      RecallNumber: '30003',
      Title: 'ACME Recall',
      Hazards: [{ Name: 'Fire hazard', HazardType: '', HazardTypeID: '' }],
      Remedies: [{ Name: 'Contact ACME for a free firmware update.' }],
    });

    it('matches on Hazards[].Name when Title and Description do not contain the term', async () => {
      mockSearch.mockResolvedValueOnce([hazardOnly, makeRaw({ RecallNumber: '30099' })]);
      const input = cpscSearchRecalls.input.parse({ hazard_search: 'laceration' });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls.map((r) => r.recall_number)).toEqual(['30001']);
      expect(result.total_found).toBe(1);
    });

    it('matches on a product name', async () => {
      mockSearch.mockResolvedValueOnce([productOnly, hazardOnly]);
      const input = cpscSearchRecalls.input.parse({ hazard_search: 'bunk bed' });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls.map((r) => r.recall_number)).toEqual(['30002']);
    });

    it('matches on remedy text', async () => {
      mockSearch.mockResolvedValueOnce([remedyOnly, hazardOnly]);
      const input = cpscSearchRecalls.input.parse({ hazard_search: 'firmware' });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls.map((r) => r.recall_number)).toEqual(['30003']);
    });

    it('ignores surrounding whitespace in the hazard term', async () => {
      mockSearch.mockResolvedValueOnce([hazardOnly, makeRaw({ RecallNumber: '30099' })]);
      const input = cpscSearchRecalls.input.parse({ hazard_search: '  laceration ' });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls.map((r) => r.recall_number)).toEqual(['30001']);
    });

    it('matches case-insensitively', async () => {
      mockSearch.mockResolvedValueOnce([hazardOnly]);
      const input = cpscSearchRecalls.input.parse({ hazard_search: 'LACERATION' });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls).toHaveLength(1);
    });

    it('is never forwarded to the upstream query', async () => {
      mockSearch.mockResolvedValueOnce([hazardOnly]);
      const input = cpscSearchRecalls.input.parse({
        hazard_search: 'laceration',
        product_name: 'widget',
      });
      await cpscSearchRecalls.handler(input, ctx);

      expect(mockSearch.mock.calls[0]![0]).toEqual({ ProductName: 'widget' });
    });

    it('computes total_found after the filter, not from the raw upstream count', async () => {
      const raws = [hazardOnly, ...Array.from({ length: 9 }, () => makeRaw())];
      mockSearch.mockResolvedValueOnce(raws);
      const input = cpscSearchRecalls.input.parse({ hazard_search: 'laceration' });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.total_found).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.has_more).toBe(false);
    });

    it('names hazard_search and the count before it when it removes every match', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw(), makeRaw({ RecallNumber: '30098' })]);
      const input = cpscSearchRecalls.input.parse({
        title_search: 'widget',
        hazard_search: 'asbestos',
      });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.total_found).toBe(0);
      expect(result.recalls).toEqual([]);
      const { notice } = getEnrichment(ctx);
      expect(notice).toContain('hazard_search');
      expect(notice).toContain('2 recalls matched before hazard_search');
    });

    it('leaves the hazard_search count out when the other filters already matched nothing', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const input = cpscSearchRecalls.input.parse({
        title_search: 'chandelier',
        hazard_search: 'fire',
      });
      await cpscSearchRecalls.handler(input, ctx);

      expect(getEnrichment(ctx).notice).not.toContain('before hazard_search');
    });
  });

  describe('offset paging', () => {
    /** Ten distinguishable recalls, numbered 30000..30009. */
    const tenRaws = () =>
      Array.from({ length: 10 }, (_, i) => makeRaw({ RecallNumber: `3000${i}` }));

    it('returns the second page for offset + limit', async () => {
      mockSearch.mockResolvedValueOnce(tenRaws());
      const input = cpscSearchRecalls.input.parse({ title_search: 'widget', limit: 3, offset: 3 });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls.map((r) => r.recall_number)).toEqual(['30003', '30004', '30005']);
      expect(result.total_found).toBe(10);
      expect(result.offset).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it('returns an empty page (not an error) for an offset past total_found', async () => {
      mockSearch.mockResolvedValueOnce(tenRaws());
      const input = cpscSearchRecalls.input.parse({ title_search: 'widget', limit: 5, offset: 50 });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls).toEqual([]);
      expect(result.total_found).toBe(10);
      expect(result.offset).toBe(50);
      expect(result.has_more).toBe(false);
    });

    it('sets has_more false on the final page and true on every earlier page', async () => {
      mockSearch.mockResolvedValueOnce(tenRaws());
      const first = await cpscSearchRecalls.handler(
        cpscSearchRecalls.input.parse({ title_search: 'widget', limit: 5, offset: 0 }),
        ctx,
      );
      expect(first.has_more).toBe(true);

      mockSearch.mockResolvedValueOnce(tenRaws());
      const last = await cpscSearchRecalls.handler(
        cpscSearchRecalls.input.parse({ title_search: 'widget', limit: 5, offset: 5 }),
        ctx,
      );
      expect(last.recalls).toHaveLength(5);
      expect(last.has_more).toBe(false);
    });

    it('returns a short final page when offset + limit overruns the set', async () => {
      mockSearch.mockResolvedValueOnce(tenRaws());
      const input = cpscSearchRecalls.input.parse({ title_search: 'widget', limit: 5, offset: 8 });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls.map((r) => r.recall_number)).toEqual(['30008', '30009']);
      expect(result.has_more).toBe(false);
    });

    it('reports truncated exactly when has_more, on every page shape', async () => {
      const cases = [
        { limit: 5, offset: 0, has_more: true },
        { limit: 5, offset: 3, has_more: true },
        { limit: 5, offset: 5, has_more: false },
        { limit: 5, offset: 8, has_more: false },
        { limit: 20, offset: 0, has_more: false },
        { limit: 5, offset: 10, has_more: false },
        { limit: 5, offset: 50, has_more: false },
      ];
      for (const { limit, offset, has_more } of cases) {
        mockSearch.mockResolvedValueOnce(tenRaws());
        const result = await cpscSearchRecalls.handler(
          cpscSearchRecalls.input.parse({ title_search: 'widget', limit, offset }),
          createMockContext({ errors: cpscSearchRecalls.errors }),
        );
        expect({ limit, offset, has_more: result.has_more }).toEqual({ limit, offset, has_more });
        expect(result.truncated).toBe(result.has_more);
      }
    });

    it('explains an exhausted page with a notice naming total_found', async () => {
      mockSearch.mockResolvedValueOnce(tenRaws());
      const result = await cpscSearchRecalls.handler(
        cpscSearchRecalls.input.parse({ title_search: 'widget', limit: 5, offset: 10 }),
        ctx,
      );

      expect(result).toMatchObject({ recalls: [], total_found: 10, truncated: false });
      expect(getEnrichment(ctx).notice).toContain('10 matching recalls');
    });

    it('adds no notice to a non-empty page that fits', async () => {
      for (const offset of [0, 5, 9]) {
        mockSearch.mockResolvedValueOnce(tenRaws());
        const pageCtx = createMockContext({ errors: cpscSearchRecalls.errors });
        await cpscSearchRecalls.handler(
          cpscSearchRecalls.input.parse({ title_search: 'widget', limit: 5, offset }),
          pageCtx,
        );
        expect(getEnrichment(pageCtx).notice).toBeUndefined();
      }
    });

    it('defaults offset to 0', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const input = cpscSearchRecalls.input.parse({ title_search: 'widget' });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.offset).toBe(0);
    });

    it('rejects a negative offset', () => {
      expect(() => cpscSearchRecalls.input.parse({ offset: -1 })).toThrow();
    });

    it('applies hazard_search before the offset/limit window', async () => {
      /** Six matching records interleaved with six non-matching ones. */
      const raws = Array.from({ length: 12 }, (_, i) =>
        makeRaw({
          RecallNumber: `310${String(i).padStart(2, '0')}`,
          Hazards: [
            {
              Name: i % 2 === 0 ? 'Laceration hazard' : 'Fire hazard',
              HazardType: '',
              HazardTypeID: '',
            },
          ],
        }),
      );
      mockSearch.mockResolvedValueOnce(raws);
      const input = cpscSearchRecalls.input.parse({
        hazard_search: 'laceration',
        limit: 2,
        offset: 2,
      });
      const result = await cpscSearchRecalls.handler(input, ctx);

      // Filter keeps the six even-indexed records; the window is a slice of those.
      expect(result.total_found).toBe(6);
      expect(result.recalls.map((r) => r.recall_number)).toEqual(['31004', '31006']);
      expect(result.truncated).toBe(true);
      expect(result.has_more).toBe(true);
    });

    it('format surfaces the offset and the next-page call', () => {
      const paged = formatText(
        makeFormatResult(undefined, {
          total_found: 40,
          truncated: true,
          offset: 20,
          has_more: true,
        }),
      );
      expect(paged).toContain(
        'Showing 1 of 40 recalls (truncated), starting at offset 20. More available — repeat with offset 21.',
      );

      const done = formatText(
        makeFormatResult(undefined, {
          total_found: 40,
          truncated: false,
          offset: 39,
          has_more: false,
        }),
      );
      expect(done).toContain('Showing 1 of 40 recalls, starting at offset 39.');
      expect(done).not.toContain('More available');
      expect(done).not.toContain('truncated');

      const single = formatText(makeFormatResult());
      expect(single).toContain('Showing 1 of 1 recalls, starting at offset 0.');
      expect(single).not.toContain('truncated');
    });

    it('format states zero matches plainly rather than as an empty window', () => {
      const text = formatText(makeFormatResult(undefined, { recalls: [], total_found: 0 }));

      expect(text).toContain('No recalls matched the search criteria.');
      expect(text).not.toContain('Showing 0 of 0');
    });
  });

  describe('upstream error classification', () => {
    it('routes a non-retryable service error to upstream_rejected', async () => {
      mockSearch.mockRejectedValueOnce(
        new McpError(
          JsonRpcErrorCode.ServiceUnavailable,
          'CPSC rejected the request: Invalid date format.',
          { retryable: false },
        ),
      );
      const input = cpscSearchRecalls.input.parse({ product_name: 'widget' });
      await expect(cpscSearchRecalls.handler(input, ctx)).rejects.toMatchObject({
        message: 'CPSC rejected the request: Invalid date format.',
        data: { reason: 'upstream_rejected', retryable: false },
      });
    });

    it('keeps a transient service error on upstream_error and carries the upstream message', async () => {
      mockSearch.mockRejectedValueOnce(new Error('network error'));
      const input = cpscSearchRecalls.input.parse({ product_name: 'widget' });
      await expect(cpscSearchRecalls.handler(input, ctx)).rejects.toMatchObject({
        message: 'CPSC API request failed: network error',
        data: { reason: 'upstream_error', retryable: true },
      });
    });

    it('treats an McpError without a retryable flag as transient', async () => {
      mockSearch.mockRejectedValueOnce(
        new McpError(JsonRpcErrorCode.Timeout, 'CPSC API request timed out.'),
      );
      const input = cpscSearchRecalls.input.parse({ title_search: 'widget' });
      await expect(cpscSearchRecalls.handler(input, ctx)).rejects.toMatchObject({
        data: { reason: 'upstream_error', retryable: true },
      });
    });
  });

  /** Run the handler with `args` against `raws` and return the params object the service received. */
  const upstreamParamsFor = async (args: Record<string, unknown>, raws: unknown[] = []) => {
    mockSearch.mockResolvedValueOnce(raws);
    await cpscSearchRecalls.handler(cpscSearchRecalls.input.parse(args), ctx);
    return mockSearch.mock.calls[0]![0] as Record<string, string>;
  };

  /** Run the handler with `args` against `raws` and return the matched recall numbers. */
  const matchedNumbers = async (args: Record<string, unknown>, raws: unknown[]) => {
    mockSearch.mockResolvedValueOnce(raws);
    const result = await cpscSearchRecalls.handler(
      cpscSearchRecalls.input.parse({ limit: 200, ...args }),
      createMockContext({ errors: cpscSearchRecalls.errors }),
    );
    return result.recalls.map((r) => r.recall_number);
  };

  describe('search criteria', () => {
    const noCriterion = [
      {},
      { limit: 5, offset: 10 },
      { title_search: '' },
      { hazard_search: '   ' },
      { product_name: '  ' },
      { date_start: '', updated_end: '' },
    ];
    for (const args of noCriterion) {
      it(`rejects ${JSON.stringify(args)} with missing_criteria before any upstream call`, async () => {
        const input = cpscSearchRecalls.input.parse(args);
        await expect(cpscSearchRecalls.handler(input, ctx)).rejects.toMatchObject({
          code: JsonRpcErrorCode.ValidationError,
          data: { reason: 'missing_criteria' },
        });
        expect(mockSearch).not.toHaveBeenCalled();
      });
    }

    it('reports missing_criteria on both surfaces with a hint that points browsing to cpsc_get_recent', async () => {
      const result = await runToolContract(cpscSearchRecalls, { hazard: '  ', limit: 5 } as never);

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.ValidationError,
          data: {
            reason: 'missing_criteria',
            recovery: { hint: expect.stringContaining('cpsc_get_recent') },
          },
        },
      });
      expect(wireText(result)).toContain('cpsc_get_recent');
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('does not forward a blank filter given alongside a real one', async () => {
      expect(await upstreamParamsFor({ product_name: '  ', title_search: 'crib' })).toEqual({
        RecallTitle: 'crib',
      });
    });

    it('accepts a date range alone, a single date bound, hazard_search alone, and the hazard alias', async () => {
      const accepted = [
        { date_start: '2015-01-01', date_end: '2015-12-31' },
        { date_end: '2015-12-31' },
        { updated_start: '2025-01-01' },
        { hazard_search: 'fire' },
      ];
      for (const args of accepted) {
        mockSearch.mockResolvedValueOnce([]);
        await expect(
          cpscSearchRecalls.handler(
            cpscSearchRecalls.input.parse(args),
            createMockContext({ errors: cpscSearchRecalls.errors }),
          ),
        ).resolves.toMatchObject({ total_found: 0 });
      }
      mockSearch.mockResolvedValueOnce([]);
      const viaAlias = await runToolContract(cpscSearchRecalls, { hazard: 'fire' } as never);
      expect(viaAlias.isError).toBeFalsy();
    });

    it('treats a padded value exactly like the trimmed one', async () => {
      const raws = [makeRaw({ Title: 'ACME Crib Recall' }), makeRaw({ RecallNumber: '25044' })];
      const padded = await upstreamParamsFor({ title_search: ' crib ' }, raws);
      mockSearch.mockClear();
      const plain = await upstreamParamsFor({ title_search: 'crib' }, raws);

      expect(padded).toEqual(plain);
      expect(await matchedNumbers({ title_search: ' crib ' }, raws)).toEqual(
        await matchedNumbers({ title_search: 'crib' }, raws),
      );
    });

    it('keeps every input field optional in the schema itself', () => {
      expect(() => cpscSearchRecalls.input.parse({})).not.toThrow();
      expect(cpscSearchRecalls.input.def.type).toBe('object');
      expect(cpscSearchRecalls.input.def.checks ?? []).toHaveLength(0);
    });
  });

  describe('text filter length', () => {
    const TEXT_FILTERS = [
      'product_name',
      'manufacturer',
      'retailer',
      'importer',
      'distributor',
      'title_search',
      'description_search',
      'remedy',
      'hazard_search',
    ];

    it('advertises maxLength 500 on every text filter', () => {
      const { properties } = z.toJSONSchema(cpscSearchRecalls.input) as {
        properties: Record<string, { maxLength?: number }>;
      };
      for (const filter of TEXT_FILTERS) {
        expect({ filter, maxLength: properties[filter]?.maxLength }).toEqual({
          filter,
          maxLength: 500,
        });
      }
    });

    for (const filter of [...TEXT_FILTERS, 'hazard']) {
      it(`accepts 500 characters on ${filter} and rejects 501 before any upstream request`, async () => {
        mockSearch.mockResolvedValueOnce([makeRaw()]);
        const accepted = await runToolContract(cpscSearchRecalls, {
          [filter]: 'a'.repeat(500),
        } as never);
        expect(accepted.isError).toBeFalsy();
        expect(mockSearch).toHaveBeenCalledTimes(1);

        mockSearch.mockClear();
        const rejected = await runToolContract(cpscSearchRecalls, {
          [filter]: 'a'.repeat(501),
        } as never);
        expect(rejected.isError).toBe(true);
        expect(rejected.structuredContent).toMatchObject({
          error: {
            code: JsonRpcErrorCode.InvalidParams,
            data: { reason: 'invalid_arguments' },
          },
        });
        expect(wireText(rejected)).toContain(filter === 'hazard' ? 'hazard_search' : filter);
        expect(mockSearch).not.toHaveBeenCalled();
      });
    }
  });

  describe('multi-word text filters', () => {
    const graco = makeRaw({
      RecallNumber: '10212',
      Title: 'Graco Recalls Drop-Side Cribs Due to Entrapment',
    });
    const gracoStroller = makeRaw({ RecallNumber: '20001', Title: 'Graco Recalls Strollers' });
    const acmeCrib = makeRaw({ RecallNumber: '20002', Title: 'ACME Recalls Cribs' });
    const raws = [graco, gracoStroller, acmeCrib];

    it('matches records containing every word, in any order and any case', async () => {
      expect(await matchedNumbers({ title_search: 'Graco crib' }, raws)).toEqual(['10212']);
      expect(await matchedNumbers({ title_search: 'crib GRACO' }, raws)).toEqual(['10212']);
    });

    it('yields no match when any one word appears nowhere', async () => {
      expect(await matchedNumbers({ title_search: 'Graco zzzq' }, raws)).toEqual([]);
    });

    it('forwards only the longest word upstream, the first on a tie', async () => {
      expect(await upstreamParamsFor({ title_search: 'Graco crib' })).toEqual({
        RecallTitle: 'Graco',
      });
      mockSearch.mockClear();
      expect(await upstreamParamsFor({ title_search: 'crib   Graco' })).toEqual({
        RecallTitle: 'Graco',
      });
      mockSearch.mockClear();
      expect(await upstreamParamsFor({ product_name: 'baby crib' })).toEqual({
        ProductName: 'baby',
      });
    });

    it('forwards the longest apostrophe-free fragment, so no apostrophe reaches CPSC', async () => {
      expect(
        await upstreamParamsFor({ title_search: "Fisher-Price Rock 'n Play sleeper" }),
      ).toEqual({ RecallTitle: 'Fisher-Price' });
      mockSearch.mockClear();
      expect(await upstreamParamsFor({ title_search: "Children's" })).toEqual({
        RecallTitle: 'Children',
      });
      mockSearch.mockClear();
      expect(await upstreamParamsFor({ manufacturer: 'O’Neill’s toys' })).toEqual({
        Manufacturer: 'Neill',
      });
    });

    it('forwards nothing for a filter with no apostrophe-free fragment, but still checks it', async () => {
      const quoted = makeRaw({ RecallNumber: '20003', Title: "Crib Recall ' Notice" });
      expect(
        await upstreamParamsFor({ title_search: "'", product_name: 'widget' }, [quoted]),
      ).toEqual({ ProductName: 'widget' });
      expect(await matchedNumbers({ title_search: '’', product_name: 'widget' }, raws)).toEqual([]);
      expect(
        await matchedNumbers({ title_search: '’', product_name: 'widget' }, [quoted, graco]),
      ).toEqual(['20003']);
    });

    it('matches straight and curly apostrophes interchangeably', async () => {
      const curly = makeRaw({
        RecallNumber: '20004',
        Title: 'The Children’s Place Recalls Pajamas',
      });
      const straight = makeRaw({ RecallNumber: '20005', Title: "Children's Robes Recalled" });
      const opening = makeRaw({ RecallNumber: '20006', Title: 'Rock ‘n Play Sleepers Recalled' });
      const all = [curly, straight, opening];

      expect(await matchedNumbers({ title_search: "Children's" }, all)).toEqual(['20004', '20005']);
      expect(await matchedNumbers({ title_search: 'children’s' }, all)).toEqual(['20004', '20005']);
      expect(await matchedNumbers({ title_search: "rock 'n play" }, all)).toEqual(['20006']);
    });

    it('matches CPSC wildcard characters literally', async () => {
      const underscore = makeRaw({ RecallNumber: '26600', Title: 'Model_X Heater Recall' });
      const percent = makeRaw({ RecallNumber: '26601', Title: '50% Off Chairs Recall' });
      const plain = makeRaw({ RecallNumber: '26602', Title: 'Heater Recall' });
      const all = [underscore, percent, plain];

      expect(await matchedNumbers({ title_search: '_' }, all)).toEqual(['26600']);
      expect(await matchedNumbers({ title_search: '50%' }, all)).toEqual(['26601']);
      expect(await matchedNumbers({ title_search: '[a-z]' }, all)).toEqual([]);
    });

    it('still forwards % and _ upstream, where they can only widen the fetch', async () => {
      expect(await upstreamParamsFor({ title_search: '50%' })).toEqual({ RecallTitle: '50%' });
      mockSearch.mockClear();
      expect(await upstreamParamsFor({ title_search: 'Model_X' })).toEqual({
        RecallTitle: 'Model_X',
      });
    });

    /**
     * CPSC reads `[…]` as a character class, which can exclude the record that holds the
     * brackets literally: `RecallDescription=[mm][dd][yy]` omits the one description
     * containing "[mm][dd][yy]". The forwarded word therefore never carries a bracket.
     */
    it('forwards no bracket upstream, and still matches a bracketed value literally', async () => {
      expect(await upstreamParamsFor({ description_search: '[mm][dd][yy]' })).toEqual({
        RecallDescription: 'mm',
      });
      mockSearch.mockClear();
      expect(await upstreamParamsFor({ title_search: 'Cr[i]b recall' })).toEqual({
        RecallTitle: 'recall',
      });

      const literal = makeRaw({
        RecallNumber: '09242',
        Description: 'The date code is printed as [mm][dd][yy] on the base.',
      });
      const classMatch = makeRaw({ RecallNumber: '26036', Description: 'Sold in mdy packs.' });
      expect(
        await matchedNumbers({ description_search: '[mm][dd][yy]' }, [literal, classMatch]),
      ).toEqual(['09242']);
    });

    it('forwards at most 200 URL-encoded bytes of a long word, and checks the whole word locally', async () => {
      const long = 'a'.repeat(300);
      expect(await upstreamParamsFor({ title_search: long })).toEqual({
        RecallTitle: 'a'.repeat(200),
      });

      const prefixOnly = makeRaw({ RecallNumber: '20011', Title: `${'a'.repeat(200)} Recall` });
      const whole = makeRaw({ RecallNumber: '20012', Title: `${long} Recall` });
      expect(await matchedNumbers({ title_search: long }, [prefixOnly, whole])).toEqual(['20012']);
    });

    it('lets the words of an array-field filter match across entries', async () => {
      const split = makeRaw({
        RecallNumber: '20007',
        Products: [
          {
            Name: 'Baby Stroller',
            Description: '',
            Model: '',
            Type: '',
            CategoryID: '',
            NumberOfUnits: '',
          },
          {
            Name: 'Car Seat',
            Description: '',
            Model: '',
            Type: '',
            CategoryID: '',
            NumberOfUnits: '',
          },
        ],
      });
      const fisher = makeRaw({
        RecallNumber: '20008',
        Manufacturers: [{ Name: 'Fisher-Price, Inc.', CompanyID: '' }],
      });

      expect(await matchedNumbers({ product_name: 'seat stroller' }, [split, fisher])).toEqual([
        '20007',
      ]);
      expect(await matchedNumbers({ manufacturer: 'Fisher Price' }, [split, fisher])).toEqual([
        '20008',
      ]);
    });

    it('lets hazard_search words match across hazards, product names, and remedy text', async () => {
      const acrossFields = makeRaw({
        RecallNumber: '20009',
        Hazards: [{ Name: 'Tip-over hazard', HazardType: '', HazardTypeID: '' }],
        Products: [
          {
            Name: 'Six-Drawer Dresser',
            Description: '',
            Model: '',
            Type: '',
            CategoryID: '',
            NumberOfUnits: '',
          },
        ],
      });
      const hazardOnly = makeRaw({
        RecallNumber: '20010',
        Hazards: [{ Name: 'Tip-over hazard', HazardType: '', HazardTypeID: '' }],
      });

      expect(
        await matchedNumbers({ hazard_search: 'dresser tip-over' }, [acrossFields, hazardOnly]),
      ).toEqual(['20009']);
    });

    /**
     * Each filter's words must all land in the one field CPSC matches for it; a record
     * carrying the same words only in another field is a decoy that must not match.
     */
    const fieldCases: Array<{ filter: string; field: Record<string, unknown> }> = [
      {
        filter: 'product_name',
        field: {
          Products: [
            {
              Name: 'Beta Alpha Lamp',
              Description: '',
              Model: '',
              Type: '',
              CategoryID: '',
              NumberOfUnits: '',
            },
          ],
        },
      },
      {
        filter: 'manufacturer',
        field: { Manufacturers: [{ Name: 'Beta Alpha Co', CompanyID: '' }] },
      },
      { filter: 'retailer', field: { Retailers: [{ Name: 'Beta Alpha Stores', CompanyID: '' }] } },
      { filter: 'importer', field: { Importers: [{ Name: 'Beta Alpha Imports', CompanyID: '' }] } },
      {
        filter: 'distributor',
        field: { Distributors: [{ Name: 'Beta Alpha Supply', CompanyID: '' }] },
      },
      { filter: 'title_search', field: { Title: 'Beta Alpha Recalls Lamps' } },
      { filter: 'description_search', field: { Description: 'Sold in beta and alpha colors.' } },
      { filter: 'remedy', field: { Remedies: [{ Name: 'Contact Beta Alpha for a refund.' }] } },
      {
        filter: 'hazard_search',
        field: { Hazards: [{ Name: 'Beta alpha hazard', HazardType: '', HazardTypeID: '' }] },
      },
    ];
    for (const { filter, field } of fieldCases) {
      it(`checks ${filter} words against its own field only`, async () => {
        const hit = makeRaw({ RecallNumber: '21001', ...field });
        const decoy = makeRaw({
          RecallNumber: '21002',
          ...(filter === 'title_search'
            ? { Description: 'Beta Alpha Recalls Lamps' }
            : { Title: 'Beta Alpha Recall' }),
        });

        expect(await matchedNumbers({ [filter]: 'alpha beta' }, [hit, decoy])).toEqual(['21001']);
      });
    }

    it('runs word checks before total_found, the zero-match check, and the offset window', async () => {
      const mixed = Array.from({ length: 12 }, (_, i) =>
        makeRaw({
          RecallNumber: `320${String(i).padStart(2, '0')}`,
          Title: i % 2 === 0 ? 'Graco Crib Recall' : 'Graco Stroller Recall',
        }),
      );
      mockSearch.mockResolvedValueOnce(mixed);
      const result = await cpscSearchRecalls.handler(
        cpscSearchRecalls.input.parse({ title_search: 'graco crib', limit: 2, offset: 2 }),
        ctx,
      );

      expect(result.total_found).toBe(6);
      expect(result.recalls.map((r) => r.recall_number)).toEqual(['32004', '32006']);
      expect(result.has_more).toBe(true);
    });

    it('keeps a single-word value on the same upstream call and result set', async () => {
      const chandeliers = [
        makeRaw({ RecallNumber: '22001', Title: 'Currey Recalls Chandeliers' }),
        makeRaw({ RecallNumber: '22002', Title: 'CHANDELIER recall' }),
      ];
      expect(await upstreamParamsFor({ title_search: 'chandelier' }, chandeliers)).toEqual({
        RecallTitle: 'chandelier',
      });
      expect(await matchedNumbers({ title_search: 'chandelier' }, chandeliers)).toEqual([
        '22001',
        '22002',
      ]);
    });

    it('suggests fewer words when a multi-word filter matches nothing', async () => {
      mockSearch.mockResolvedValueOnce(raws);
      await cpscSearchRecalls.handler(
        cpscSearchRecalls.input.parse({ title_search: 'Graco zzzq' }),
        ctx,
      );
      expect(getEnrichment(ctx).notice).toContain('fewer words');
    });
  });

  describe('zero-match notice', () => {
    const noticeFor = async (args: Record<string, unknown>) => {
      mockSearch.mockResolvedValueOnce([]);
      await cpscSearchRecalls.handler(cpscSearchRecalls.input.parse(args), ctx);
      return String(getEnrichment(ctx).notice);
    };

    it('suggests importer, retailer, or distributor when manufacturer was set', async () => {
      const notice = await noticeFor({ manufacturer: 'Samsung' });
      expect(notice).toContain('importer');
      expect(notice).toContain('retailer');
      expect(notice).toContain('distributor');
    });

    it('suggests widening the dates when a date bound was set', async () => {
      expect(await noticeFor({ product_name: 'crib', date_start: '2026-01-01' })).toContain(
        'date bounds',
      );
    });

    it('omits suggestions that do not apply', async () => {
      const notice = await noticeFor({ product_name: 'crib' });
      expect(notice).not.toContain('importer');
      expect(notice).not.toContain('date bounds');
      expect(notice).not.toContain('fewer words');
    });

    it('offers dropping the date bounds only when another criterion remains', async () => {
      expect(await noticeFor({ product_name: 'crib', date_start: '2026-01-01' })).toContain(
        'Widen or drop the date bounds.',
      );
      const datesOnly = await noticeFor({ date_start: '2099-01-01' });
      expect(datesOnly).toContain('Widen the date bounds.');
      expect(datesOnly).not.toContain('drop');
    });

    /**
     * Dropping hazard_search when it is the only criterion leaves a search with none, which
     * fails missing_criteria; and "matched before hazard_search" would count every recall.
     */
    it('suggests another hazard term, not dropping it, when hazard_search is the only criterion', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw(), makeRaw({ RecallNumber: '30098' })]);
      await cpscSearchRecalls.handler(
        cpscSearchRecalls.input.parse({ hazard_search: 'asbestos' }),
        ctx,
      );
      const notice = String(getEnrichment(ctx).notice);

      expect(notice).toContain('try another hazard term');
      expect(notice).not.toContain('drop hazard_search');
      expect(notice).not.toContain('matched before hazard_search');
    });

    it('always states the CPSC jurisdiction boundary', async () => {
      expect(await noticeFor({ product_name: 'insulin' })).toContain('FDA');
    });

    it('echoes each applied filter, trimmed, with blank date bounds dropped', async () => {
      mockSearch.mockResolvedValueOnce([]);
      await cpscSearchRecalls.handler(
        cpscSearchRecalls.input.parse({
          title_search: '  Graco   crib ',
          hazard_search: 'fire',
          date_start: '2020-01-01',
          date_end: '',
        }),
        ctx,
      );
      expect(getEnrichment(ctx).effectiveQuery).toBe(
        'title_search="Graco crib" AND hazard_search="fire" AND date_start=2020-01-01',
      );
    });
  });

  describe('date floor for searches with no upstream parameter', () => {
    it('sends RecallDateStart=1970-01-01 when hazard_search is the only filter', async () => {
      expect(await upstreamParamsFor({ hazard_search: 'fire' })).toEqual({
        RecallDateStart: '1970-01-01',
      });
    });

    it('sends the floor when every text filter forwards nothing upstream', async () => {
      expect(await upstreamParamsFor({ title_search: "'", hazard_search: 'fire' })).toEqual({
        RecallDateStart: '1970-01-01',
      });
    });

    it('sends exactly the existing params when any filter or date bound maps upstream', async () => {
      const cases: Array<[Record<string, unknown>, Record<string, string>]> = [
        [{ title_search: 'crib', hazard_search: 'fire' }, { RecallTitle: 'crib' }],
        [{ date_end: '2020-01-01' }, { RecallDateEnd: '2020-01-01' }],
        [
          { updated_start: '2025-01-01', hazard_search: 'fire' },
          { LastPublishDateStart: '2025-01-01' },
        ],
        [{ date_start: '2024-01-01' }, { RecallDateStart: '2024-01-01' }],
      ];
      for (const [args, expected] of cases) {
        mockSearch.mockClear();
        expect(await upstreamParamsFor(args)).toEqual(expected);
      }
    });
  });

  describe('response size budget', () => {
    const utf8 = (text: string) => Buffer.byteLength(text, 'utf8');
    /** Records whose hazard text alone is `size` characters of `fill`, sized to cross the budget in bulk. */
    const heavyRaws = (count: number, size = 2_000, fill = 'x') =>
      Array.from({ length: count }, (_, i) =>
        makeRaw({
          RecallNumber: String(40000 + i),
          Hazards: [{ Name: `Fire hazard ${fill.repeat(size)}`, HazardType: '', HazardTypeID: '' }],
        }),
      );
    const noticeOf = (result: { structuredContent?: unknown }) =>
      (result.structuredContent as { notice?: string }).notice;

    it('cuts a page at the 64,000-byte budget on both surfaces and names the next offset', async () => {
      mockSearch.mockResolvedValueOnce(heavyRaws(60));
      const result = await runToolContract(cpscSearchRecalls, {
        product_name: 'widget',
        limit: 200,
      });
      const sc = result.structuredContent as {
        recalls: unknown[];
        has_more: boolean;
        truncated: boolean;
      };
      const returned = sc.recalls.length;

      expect(result.isError).toBeFalsy();
      expect(returned).toBeGreaterThan(0);
      expect(returned).toBeLessThan(60);
      expect(sc.has_more).toBe(true);
      expect(sc.truncated).toBe(true);
      expect(utf8(JSON.stringify(result.structuredContent))).toBeLessThanOrEqual(64_000);
      expect(utf8(wireText(result))).toBeLessThanOrEqual(64_000);
      // The cut is close to the budget, not a conservative guess far below it.
      expect(utf8(JSON.stringify(result.structuredContent))).toBeGreaterThan(64_000 - 3_000);

      const notice = noticeOf(result);
      expect(notice).toContain(`Returned ${returned} of the 200 requested recalls`);
      expect(notice).toContain('64,000-byte');
      expect(notice).toContain(`offset ${returned}`);
      expect(notice).not.toContain('No recalls matched');
      expect(notice).not.toContain('past the last');
      expect(wireText(result)).toContain(`> ${notice}`);
    });

    it('measures UTF-8 bytes, not string length', async () => {
      mockSearch.mockResolvedValueOnce(heavyRaws(60, 700, '€'));
      const result = await runToolContract(cpscSearchRecalls, {
        product_name: 'widget',
        limit: 200,
      });

      expect(utf8(JSON.stringify(result.structuredContent))).toBeLessThanOrEqual(64_000);
      expect(utf8(wireText(result))).toBeLessThanOrEqual(64_000);
    });

    /**
     * The query echo is part of both surfaces. A control character JSON-escapes to six
     * bytes, and seven once structuredContent escapes it again, so nine 499-character
     * filters make an echo of about 16,000 bytes that the page must leave room for.
     */
    it('reserves room for the query echo when every text filter is at its maximum length', async () => {
      const mark = '\u0001';
      const org = { Name: `Org ${mark}`, CompanyID: '' };
      const product = {
        Name: `Widget ${mark}`,
        Description: '',
        Model: '',
        Type: '',
        CategoryID: '',
        NumberOfUnits: '',
      };
      const marked = heavyRaws(60).map((raw) => ({
        ...raw,
        Title: `${raw.Title} ${mark}`,
        Description: `${raw.Description} ${mark}`,
        Products: [product],
        Manufacturers: [org],
        Retailers: [org],
        Importers: [org],
        Distributors: [org],
        Remedies: [{ Name: `Refund ${mark}` }],
      }));
      const value = Array.from({ length: 250 }, () => mark).join(' ');
      mockSearch.mockResolvedValueOnce(marked);
      const result = await runToolContract(cpscSearchRecalls, {
        product_name: value,
        manufacturer: value,
        retailer: value,
        importer: value,
        distributor: value,
        title_search: value,
        description_search: value,
        remedy: value,
        hazard_search: value,
        limit: 200,
      });
      const sc = result.structuredContent as {
        recalls: unknown[];
        has_more: boolean;
        effectiveQuery: string;
      };

      expect(result.isError).toBeFalsy();
      expect(utf8(sc.effectiveQuery)).toBeGreaterThan(15_000);
      expect(sc.recalls.length).toBeGreaterThan(0);
      expect(sc.has_more).toBe(true);
      expect(utf8(JSON.stringify(result.structuredContent))).toBeLessThanOrEqual(64_000);
      expect(utf8(wireText(result))).toBeLessThanOrEqual(64_000);
    });

    it('continues from the emitted offset with no gap or overlap', async () => {
      const all = heavyRaws(60);
      const seen: string[] = [];
      let offset = 0;
      for (let page = 0; page < 10; page++) {
        mockSearch.mockResolvedValueOnce(all);
        const result = await runToolContract(cpscSearchRecalls, {
          product_name: 'widget',
          limit: 200,
          offset,
        });
        const sc = result.structuredContent as {
          recalls: Array<{ recall_number: string }>;
          has_more: boolean;
          truncated: boolean;
        };
        expect(utf8(JSON.stringify(sc))).toBeLessThanOrEqual(64_000);
        expect(sc.truncated).toBe(sc.has_more);
        seen.push(...sc.recalls.map((r) => r.recall_number));
        if (!sc.has_more) break;
        expect(noticeOf(result)).toContain(`offset ${offset + sc.recalls.length}`);
        offset += sc.recalls.length;
      }

      expect(seen).toEqual(all.map((r) => r.RecallNumber));
    });

    it('returns a record larger than the budget alone, never an empty page or an error', async () => {
      mockSearch.mockResolvedValueOnce(heavyRaws(3, 70_000));
      const first = await runToolContract(cpscSearchRecalls, { product_name: 'widget' });
      const firstSc = first.structuredContent as { recalls: unknown[]; has_more: boolean };

      expect(first.isError).toBeFalsy();
      expect(firstSc.recalls).toHaveLength(1);
      expect(firstSc.has_more).toBe(true);
      expect(noticeOf(first)).toContain('offset 1');

      mockSearch.mockResolvedValueOnce(heavyRaws(1, 70_000));
      const only = await runToolContract(cpscSearchRecalls, { product_name: 'widget' });
      const onlySc = only.structuredContent as { recalls: unknown[]; has_more: boolean };

      expect(onlySc.recalls).toHaveLength(1);
      expect(onlySc.has_more).toBe(false);
      expect(noticeOf(only)).toBeUndefined();
    });

    it('leaves a default-limit page of typical records whole, with no notice', async () => {
      mockSearch.mockResolvedValueOnce(
        Array.from({ length: 30 }, (_, i) => makeRaw({ RecallNumber: String(41000 + i) })),
      );
      const result = await runToolContract(cpscSearchRecalls, { product_name: 'widget' });
      const sc = result.structuredContent as { recalls: unknown[]; has_more: boolean };

      expect(sc.recalls).toHaveLength(20);
      expect(sc.has_more).toBe(true);
      expect(noticeOf(result)).toBeUndefined();
    });
  });

  /**
   * The wire envelope both client families read: `structuredContent` and the
   * `content[]` text channel must carry the same facts on success, and the same
   * reason plus recovery hint on failure.
   */
  describe('wire contract', () => {
    it('carries the window and its paging state on both surfaces', async () => {
      mockSearch.mockResolvedValueOnce(
        Array.from({ length: 5 }, (_, i) => makeRaw({ RecallNumber: `2504${i}` })),
      );
      const result = await runToolContract(cpscSearchRecalls, { product_name: 'widget', limit: 2 });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        total_found: 5,
        truncated: true,
        offset: 0,
        has_more: true,
      });
      expect(() => cpscSearchRecalls.output.parse(result.structuredContent)).not.toThrow();

      const text = wireText(result);
      expect(text).toContain('Showing 2 of 5 recalls');
      expect(text).toContain('repeat with offset 2');
      expect(text).toContain('Fire hazard');
    });

    it('returns an empty page on both surfaces for an offset past total_found', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const result = await runToolContract(cpscSearchRecalls, {
        product_name: 'widget',
        offset: 50,
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        recalls: [],
        total_found: 1,
        offset: 50,
        truncated: false,
        has_more: false,
        effectiveQuery: 'product_name="widget"',
        notice: expect.stringContaining('the 1 matching recall,'),
      });
      const text = wireText(result);
      expect(text).toContain('Showing 0 of 1 recalls');
      expect(text).toContain('> Offset 50');
      expect(text).toContain('Query: product_name="widget"');
    });

    it('returns zero matches as a success on both surfaces, with the query and notice', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const result = await runToolContract(cpscSearchRecalls, { title_search: 'xyzzyqqzz' });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        recalls: [],
        total_found: 0,
        truncated: false,
        has_more: false,
        effectiveQuery: 'title_search="xyzzyqqzz"',
        notice: expect.stringContaining('No recalls matched'),
      });
      expect(() =>
        cpscSearchRecalls.output
          .extend(cpscSearchRecalls.enrichment!)
          .parse(result.structuredContent),
      ).not.toThrow();
      const text = wireText(result);
      expect(text).toContain('Query: title_search="xyzzyqqzz"');
      expect(text).toContain('> No recalls matched');
    });

    it('gives zero matches at a nonzero offset the zero-match notice, not an exhausted-page one', async () => {
      mockSearch.mockResolvedValueOnce([]);
      const result = await runToolContract(cpscSearchRecalls, {
        product_name: 'nothing',
        offset: 40,
      });

      const notice = (result.structuredContent as { notice?: string }).notice;
      expect(notice).toContain('No recalls matched');
      expect(notice).not.toContain('Offset 40');
    });

    it('carries the query echo and no notice on a non-empty page', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const result = await runToolContract(cpscSearchRecalls, { hazard: '  fire ' } as never);

      expect(result.structuredContent).toMatchObject({ effectiveQuery: 'hazard_search="fire"' });
      expect(result.structuredContent).not.toHaveProperty('notice');
      expect(wireText(result)).toContain('Query: hazard_search="fire"');
    });

    it('declares no no_results error', () => {
      expect(cpscSearchRecalls.errors!.map((e) => e.reason)).not.toContain('no_results');
    });

    it('reports invalid_date_range with its recovery hint on both surfaces', async () => {
      const result = await runToolContract(cpscSearchRecalls, {
        date_start: '2026-06-01',
        date_end: '2026-01-01',
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.ValidationError,
          data: { reason: 'invalid_date_range' },
        },
      });
      expect(wireText(result)).toContain('Swap the two dates');
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('rejects an argument key the input schema does not declare', async () => {
      const result = await runToolContract(cpscSearchRecalls, {
        product_name: 'widget',
        sort_by: 'date',
      } as never);

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.InvalidParams,
          message: expect.stringContaining('sort_by'),
        },
      });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it("accepts the upstream 'hazard' spelling as an alias for hazard_search", async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const result = await runToolContract(cpscSearchRecalls, { hazard: 'fire' } as never);

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ total_found: 1 });
      expect(mockSearch).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * @fileoverview Tests for the cpsc_search_recalls tool.
 * @module tests/tools/cpsc-search-recalls.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
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

describe('cpsc_search_recalls', () => {
  let ctx: ReturnType<typeof createMockContext>;
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
    const r = result.recalls[0];
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
    const input = cpscSearchRecalls.input.parse({ limit: 3 });
    const result = await cpscSearchRecalls.handler(input, ctx);

    expect(result.total_found).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.recalls).toHaveLength(3);
  });

  it('throws no_results when API returns empty array', async () => {
    mockSearch.mockResolvedValueOnce([]);
    const input = cpscSearchRecalls.input.parse({ product_name: 'xyzzy' });
    await expect(cpscSearchRecalls.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_results' },
    });
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
    const input = cpscSearchRecalls.input.parse({});
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
    const input = cpscSearchRecalls.input.parse({});
    const result = await cpscSearchRecalls.handler(input, ctx);

    expect(result.recalls[0].products).toHaveLength(2);
    // UPCs are recall-level — top-level field on the recall, not per-product
    expect(result.recalls[0].upcs).toEqual(['012345678901', '012345678902']);
    // Products themselves have no upcs field
    expect(result.recalls[0].products[0]).not.toHaveProperty('upcs');
  });

  it('format renders hazard, remedy, and products', () => {
    const blocks = cpscSearchRecalls.format(makeFormatResult());
    const text = blocks[0].text;
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
    const input = cpscSearchRecalls.input.parse({});
    const result = await cpscSearchRecalls.handler(input, ctx);
    expect(result.recalls[0].hazards).toEqual([]);
    expect(result.recalls[0].remedy_options).toEqual([]);
    expect(result.recalls[0].remedy_summary).toBe('');
    expect(result.recalls[0].manufacturers).toEqual([]);
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
      const text = cpscSearchRecalls.format(
        makeFormatResult({ manufacturers: ['ACME Corp'], importers: [importerWithCommas] }),
      )[0].text;

      expect(text).toContain('**Manufacturer:** ACME Corp');
      expect(text).toContain(`**Importer:** ${importerWithCommas}`);
      expect(text).not.toContain('**Manufacturer/Importer:**');
    });

    it('renders only the manufacturer line when there is no importer', () => {
      const text = cpscSearchRecalls.format(
        makeFormatResult({ manufacturers: ['ACME Corp'], importers: [] }),
      )[0].text;

      expect(text).toContain('**Manufacturer:** ACME Corp');
      expect(text).not.toContain('**Importer:**');
    });

    it('renders only the importer line when there is no manufacturer', () => {
      const text = cpscSearchRecalls.format(
        makeFormatResult({ manufacturers: [], importers: [importerWithCommas] }),
      )[0].text;

      expect(text).toContain(`**Importer:** ${importerWithCommas}`);
      expect(text).not.toContain('**Manufacturer:**');
    });

    it('separates multiple orgs in one role with "; " so comma-bearing names stay parseable', () => {
      const text = cpscSearchRecalls.format(
        makeFormatResult({ manufacturers: [importerWithCommas, 'ACME Corp'], importers: [] }),
      )[0].text;

      expect(text).toContain(`**Manufacturer:** ${importerWithCommas}; ACME Corp`);
    });

    it('falls back to a combined "Not specified" line when neither role is populated', () => {
      const text = cpscSearchRecalls.format(
        makeFormatResult({ manufacturers: [], importers: [] }),
      )[0].text;

      expect(text).toContain('**Manufacturer/Importer:** Not specified');
    });
  });

  describe('data quality notes and source caveat', () => {
    it('populates notes for a record with no hazards and no products', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw({ Hazards: [], Products: [] })]);
      const input = cpscSearchRecalls.input.parse({});
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls[0].data_quality_notes).toEqual([
        'CPSC listed no hazard description for this recall.',
        'CPSC listed no product entries for this recall.',
      ]);
      expect(cpscSearchRecalls.output.parse(result)).toBeDefined();
    });

    it('leaves notes empty for a complete record', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const input = cpscSearchRecalls.input.parse({});
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls[0].data_quality_notes).toEqual([]);
    });

    it('renders notes only when present, and always renders the source caveat', () => {
      const withNotes = cpscSearchRecalls.format(
        makeFormatResult({ data_quality_notes: ['CPSC listed no hazard description.'] }),
      )[0].text;
      const withoutNotes = cpscSearchRecalls.format(makeFormatResult())[0].text;

      expect(withNotes).toContain('**Data quality (server-assessed):**');
      expect(withNotes).toContain('CPSC listed no hazard description.');
      expect(withoutNotes).not.toContain('Data quality');
      expect(withoutNotes).toContain('relayed verbatim from the CPSC record');
      expect(withoutNotes).toContain('cpsc_url');
    });

    it('carries the source caveat on the handler result', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const input = cpscSearchRecalls.input.parse({});
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
      return mockSearch.mock.calls[0][0] as Record<string, string>;
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

      expect(mockSearch.mock.calls[0][0]).toEqual({ ProductName: 'widget' });
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

    it('throws no_results when the filter eliminates every upstream match', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw(), makeRaw({ RecallNumber: '30098' })]);
      const input = cpscSearchRecalls.input.parse({ hazard_search: 'asbestos' });
      await expect(cpscSearchRecalls.handler(input, ctx)).rejects.toMatchObject({
        data: { reason: 'no_results' },
      });
    });
  });

  describe('offset paging', () => {
    /** Ten distinguishable recalls, numbered 30000..30009. */
    const tenRaws = () =>
      Array.from({ length: 10 }, (_, i) => makeRaw({ RecallNumber: `3000${i}` }));

    it('returns the second page for offset + limit', async () => {
      mockSearch.mockResolvedValueOnce(tenRaws());
      const input = cpscSearchRecalls.input.parse({ limit: 3, offset: 3 });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls.map((r) => r.recall_number)).toEqual(['30003', '30004', '30005']);
      expect(result.total_found).toBe(10);
      expect(result.offset).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it('returns an empty page (not an error) for an offset past total_found', async () => {
      mockSearch.mockResolvedValueOnce(tenRaws());
      const input = cpscSearchRecalls.input.parse({ limit: 5, offset: 50 });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls).toEqual([]);
      expect(result.total_found).toBe(10);
      expect(result.offset).toBe(50);
      expect(result.has_more).toBe(false);
    });

    it('sets has_more false on the final page and true on every earlier page', async () => {
      mockSearch.mockResolvedValueOnce(tenRaws());
      const first = await cpscSearchRecalls.handler(
        cpscSearchRecalls.input.parse({ limit: 5, offset: 0 }),
        ctx,
      );
      expect(first.has_more).toBe(true);

      mockSearch.mockResolvedValueOnce(tenRaws());
      const last = await cpscSearchRecalls.handler(
        cpscSearchRecalls.input.parse({ limit: 5, offset: 5 }),
        ctx,
      );
      expect(last.recalls).toHaveLength(5);
      expect(last.has_more).toBe(false);
    });

    it('returns a short final page when offset + limit overruns the set', async () => {
      mockSearch.mockResolvedValueOnce(tenRaws());
      const input = cpscSearchRecalls.input.parse({ limit: 5, offset: 8 });
      const result = await cpscSearchRecalls.handler(input, ctx);

      expect(result.recalls.map((r) => r.recall_number)).toEqual(['30008', '30009']);
      expect(result.has_more).toBe(false);
    });

    it('keeps truncated limit-only and offset-independent', async () => {
      mockSearch.mockResolvedValueOnce(tenRaws());
      const paged = await cpscSearchRecalls.handler(
        cpscSearchRecalls.input.parse({ limit: 5, offset: 5 }),
        ctx,
      );
      // Last page, nothing further to fetch — but the result set still exceeds limit.
      expect(paged.has_more).toBe(false);
      expect(paged.truncated).toBe(true);

      mockSearch.mockResolvedValueOnce(tenRaws());
      const wide = await cpscSearchRecalls.handler(
        cpscSearchRecalls.input.parse({ limit: 20, offset: 5 }),
        ctx,
      );
      expect(wide.truncated).toBe(false);
    });

    it('defaults offset to 0', async () => {
      mockSearch.mockResolvedValueOnce([makeRaw()]);
      const input = cpscSearchRecalls.input.parse({});
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
      const paged = cpscSearchRecalls.format(
        makeFormatResult(undefined, {
          total_found: 40,
          truncated: true,
          offset: 20,
          has_more: true,
        }),
      )[0].text;
      expect(paged).toContain(
        'Showing 1 of 40 recalls (truncated by limit), starting at offset 20.',
      );
      expect(paged).toContain('More available — repeat with offset 21.');

      const done = cpscSearchRecalls.format(
        makeFormatResult(undefined, {
          total_found: 40,
          truncated: true,
          offset: 39,
          has_more: false,
        }),
      )[0].text;
      expect(done).toContain('starting at offset 39.');
      expect(done).not.toContain('More available');

      const single = cpscSearchRecalls.format(makeFormatResult())[0].text;
      expect(single).toContain('Showing 1 of 1 recalls, starting at offset 0.');
      expect(single).not.toContain('truncated by limit');
    });
  });

  describe('upstream error classification', () => {
    it('routes a non-retryable service error to upstream_rejected', async () => {
      mockSearch.mockRejectedValueOnce(
        new McpError(
          JsonRpcErrorCode.ServiceUnavailable,
          'CPSC API returned an error row instead of recall records: Invalid date format.',
          { retryable: false },
        ),
      );
      const input = cpscSearchRecalls.input.parse({ product_name: 'widget' });
      await expect(cpscSearchRecalls.handler(input, ctx)).rejects.toMatchObject({
        message: 'CPSC API returned an error row instead of recall records: Invalid date format.',
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
      const input = cpscSearchRecalls.input.parse({});
      await expect(cpscSearchRecalls.handler(input, ctx)).rejects.toMatchObject({
        data: { reason: 'upstream_error', retryable: true },
      });
    });
  });
});

/**
 * @fileoverview Tests for the cpsc_search_recalls tool.
 * @module tests/tools/cpsc-search-recalls.tool.test
 */

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
    const fakeResult = {
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
        },
      ],
      total_found: 1,
      truncated: false,
      cpsc_jurisdiction: 'CPSC covers consumer products.',
    };
    const blocks = cpscSearchRecalls.format(fakeResult);
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
});

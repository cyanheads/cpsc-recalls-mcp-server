/**
 * @fileoverview Tests for the cpsc_get_recall tool.
 * @module tests/tools/cpsc-get-recall.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
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

vi.mock('@/services/cpsc-recall/cpsc-recall-service.js', () => ({
  getCpscRecallService: vi.fn(),
  initCpscRecallService: vi.fn(),
}));

import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';

describe('cpsc_get_recall', () => {
  let ctx: ReturnType<typeof createMockContext>;
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

  it('throws upstream_error on service failure', async () => {
    mockGetByNumber.mockRejectedValueOnce(new Error('timeout'));
    const input = cpscGetRecall.input.parse({ recall_number: '25043' });
    await expect(cpscGetRecall.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'upstream_error' },
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
    const fakeResult = {
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
      cpsc_jurisdiction: 'CPSC covers consumer products.',
    };
    const blocks = cpscGetRecall.format(fakeResult);
    const text = blocks[0].text;
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
});

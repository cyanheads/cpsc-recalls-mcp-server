/**
 * @fileoverview Tests for the cpsc_get_recent tool.
 * @module tests/tools/cpsc-get-recent.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cpscGetRecent } from '@/mcp-server/tools/definitions/cpsc-get-recent.tool.js';

const makeRaw = (overrides?: Record<string, unknown>) => ({
  RecallID: 1,
  RecallNumber: '25043',
  RecallDate: '2025-03-15T00:00:00',
  LastPublishDate: '2025-03-15T00:00:00',
  Title: 'ACME Widget Recall',
  Description: 'Fire hazard.',
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
  Images: [],
  Injuries: [{ Name: 'None reported' }],
  Manufacturers: [],
  Retailers: [],
  Importers: [],
  Distributors: [],
  ManufacturerCountries: [],
  ProductUPCs: [],
  Hazards: [{ Name: 'Fire hazard', HazardType: '', HazardTypeID: '' }],
  Remedies: [{ Name: 'Refund available.' }],
  RemedyOptions: [{ Option: 'Refund' }],
  ...overrides,
});

vi.mock('@/services/cpsc-recall/cpsc-recall-service.js', () => ({
  getCpscRecallService: vi.fn(),
  initCpscRecallService: vi.fn(),
}));

import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';

describe('cpsc_get_recent', () => {
  let ctx: ReturnType<typeof createMockContext>;
  const mockGetRecent = vi.fn();

  beforeEach(() => {
    ctx = createMockContext({ errors: cpscGetRecent.errors });
    vi.mocked(getCpscRecallService).mockReturnValue({ getRecent: mockGetRecent } as never);
    mockGetRecent.mockReset();
  });

  it('returns recent recalls with period metadata', async () => {
    mockGetRecent.mockResolvedValueOnce([makeRaw()]);
    const input = cpscGetRecent.input.parse({ days: 7 });
    const result = await cpscGetRecent.handler(input, ctx);

    expect(result.total_found).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.recalls).toHaveLength(1);
    expect(result.recalls[0].recall_number).toBe('25043');
    expect(result.recalls[0].recall_date).toBe('2025-03-15');
    expect(result.recalls[0].hazards).toEqual(['Fire hazard']);
    expect(result.recalls[0].remedy_options).toEqual(['Refund']);
    expect(result.recalls[0].products).toEqual(['ACME Widget']);
    expect(result.period.days).toBe(7);
  });

  it('applies client-side limit and sets truncated', async () => {
    const raws = Array.from({ length: 10 }, (_, i) => makeRaw({ RecallNumber: `2500${i}` }));
    mockGetRecent.mockResolvedValueOnce(raws);
    const input = cpscGetRecent.input.parse({ days: 30, limit: 5 });
    const result = await cpscGetRecent.handler(input, ctx);

    expect(result.total_found).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.recalls).toHaveLength(5);
  });

  it('returns empty recalls (not an error) when no recalls in window', async () => {
    mockGetRecent.mockResolvedValueOnce([]);
    const input = cpscGetRecent.input.parse({ days: 1 });
    const result = await cpscGetRecent.handler(input, ctx);
    expect(result.recalls).toEqual([]);
    expect(result.total_found).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('throws upstream_error on service failure', async () => {
    mockGetRecent.mockRejectedValueOnce(new Error('timeout'));
    const input = cpscGetRecent.input.parse({});
    await expect(cpscGetRecent.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'upstream_error' },
    });
  });

  it('includes cpsc_jurisdiction in result', async () => {
    mockGetRecent.mockResolvedValueOnce([makeRaw()]);
    const input = cpscGetRecent.input.parse({});
    const result = await cpscGetRecent.handler(input, ctx);
    expect(result.cpsc_jurisdiction).toContain('CPSC covers');
    expect(result.cpsc_jurisdiction).toContain('FDA');
  });

  it('format renders period header and recall rows', () => {
    const fakeResult = {
      recalls: [
        {
          recall_number: '25043',
          recall_date: '2025-03-15',
          title: 'ACME Widget Recall',
          hazards: ['Fire hazard'],
          remedy_options: ['Refund'],
          products: ['ACME Widget'],
          cpsc_url: 'https://www.cpsc.gov/Recalls/2025/acme-widget',
        },
      ],
      period: { start: '2025-03-01', end: '2025-03-31', days: 30 },
      total_found: 1,
      truncated: false,
      cpsc_jurisdiction: 'CPSC covers consumer products.',
    };
    const blocks = cpscGetRecent.format(fakeResult);
    const text = blocks[0].text;
    expect(text).toContain('2025-03-01');
    expect(text).toContain('2025-03-31');
    expect(text).toContain('25043');
    expect(text).toContain('Fire hazard');
    expect(text).toContain('Refund');
    expect(text).toContain('ACME Widget');
    expect(text).toContain('CPSC covers');
  });
});

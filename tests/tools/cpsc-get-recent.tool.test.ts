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

/** A single-recall result matching the output schema, for exercising format() directly. */
const makeFormatResult = (recallOverrides?: Record<string, unknown>) => ({
  recalls: [
    {
      recall_number: '25043',
      recall_date: '2025-03-15',
      title: 'ACME Widget Recall',
      hazards: ['Fire hazard'],
      remedy_options: ['Refund'],
      products: ['ACME Widget'],
      cpsc_url: 'https://www.cpsc.gov/Recalls/2025/acme-widget',
      data_quality_notes: [],
      ...recallOverrides,
    },
  ],
  period: { start: '2025-03-01', end: '2025-03-31', days: 30 },
  total_found: 1,
  truncated: false,
  cpsc_jurisdiction: 'CPSC covers consumer products.',
  source_note:
    'Recall fields are relayed verbatim from the CPSC record and are neither edited nor verified by this server. Check cpsc_url before acting on a recall for a consumer-facing decision.',
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
    const blocks = cpscGetRecent.format(makeFormatResult());
    const text = blocks[0].text;
    expect(text).toContain('2025-03-01');
    expect(text).toContain('2025-03-31');
    expect(text).toContain('25043');
    expect(text).toContain('Fire hazard');
    expect(text).toContain('Refund');
    expect(text).toContain('ACME Widget');
    expect(text).toContain('CPSC covers');
  });

  describe('data quality notes and source caveat', () => {
    it('populates notes for a record with no hazards and no products', async () => {
      mockGetRecent.mockResolvedValueOnce([makeRaw({ Hazards: [], Products: [] })]);
      const input = cpscGetRecent.input.parse({});
      const result = await cpscGetRecent.handler(input, ctx);

      expect(result.recalls[0].data_quality_notes).toEqual([
        'CPSC listed no hazard description for this recall.',
        'CPSC listed no product entries for this recall.',
      ]);
      expect(cpscGetRecent.output.parse(result)).toBeDefined();
    });

    it('leaves notes empty for a complete record', async () => {
      mockGetRecent.mockResolvedValueOnce([makeRaw()]);
      const input = cpscGetRecent.input.parse({});
      const result = await cpscGetRecent.handler(input, ctx);

      expect(result.recalls[0].data_quality_notes).toEqual([]);
    });

    it('carries the source caveat on the handler result', async () => {
      mockGetRecent.mockResolvedValueOnce([makeRaw()]);
      const input = cpscGetRecent.input.parse({});
      const result = await cpscGetRecent.handler(input, ctx);

      expect(result.source_note).toContain('relayed verbatim from the CPSC record');
    });

    it('renders notes only when present, and always renders the source caveat', () => {
      const withNotes = cpscGetRecent.format(
        makeFormatResult({ data_quality_notes: ['CPSC listed no hazard description.'] }),
      )[0].text;
      const withoutNotes = cpscGetRecent.format(makeFormatResult())[0].text;

      expect(withNotes).toContain('**Data quality (server-assessed):**');
      expect(withNotes).toContain('CPSC listed no hazard description.');
      expect(withoutNotes).not.toContain('Data quality');
      expect(withoutNotes).toContain('relayed verbatim from the CPSC record');
      expect(withoutNotes).toContain('cpsc_url');
    });

    it('labels the relayed block as CPSC source fields', () => {
      const text = cpscGetRecent.format(makeFormatResult())[0].text;

      expect(text).toContain('CPSC source fields:\nHazard: Fire hazard');
    });
  });
});

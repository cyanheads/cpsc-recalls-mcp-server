/**
 * @fileoverview Tests for the cpsc_get_recent tool.
 * @module tests/tools/cpsc-get-recent.tool.test
 */

import type { HandlerContext, ReasonOf } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
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
      products: ['ACME Widget'],
      cpsc_url: 'https://www.cpsc.gov/Recalls/2025/acme-widget',
      data_quality_notes: [],
      ...recallOverrides,
    },
  ],
  period: { start: '2025-03-01', end: '2025-03-31', days: 30 },
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
type GetRecentContext = HandlerContext<ReasonOf<typeof cpscGetRecent.errors>>;

/** Content blocks are a union; narrow to the text channel before asserting on it. */
const textOf = (blocks: ReadonlyArray<{ type: string; text?: string }>): string =>
  blocks.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('');

/** The text channel `format()` alone produces. */
const formatText = (result: Parameters<NonNullable<typeof cpscGetRecent.format>>[0]): string =>
  textOf(cpscGetRecent.format!(result));

/** The text channel of a full wire result. */
const wireText = (result: { content?: ReadonlyArray<{ type: string; text?: string }> }): string =>
  textOf(result.content ?? []);

describe('cpsc_get_recent', () => {
  let ctx: GetRecentContext;
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
    expect(result.recalls[0]!.recall_number).toBe('25043');
    expect(result.recalls[0]!.recall_date).toBe('2025-03-15');
    expect(result.recalls[0]!.hazards).toEqual(['Fire hazard']);
    expect(result.recalls[0]!.remedy_options).toEqual(['Refund']);
    expect(result.recalls[0]!.products).toEqual(['ACME Widget']);
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
    const text = formatText(makeFormatResult());
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

      expect(result.recalls[0]!.data_quality_notes).toEqual([
        'CPSC listed no hazard description for this recall.',
        'CPSC listed no product entries for this recall.',
      ]);
      expect(cpscGetRecent.output.parse(result)).toBeDefined();
    });

    it('leaves notes empty for a complete record', async () => {
      mockGetRecent.mockResolvedValueOnce([makeRaw()]);
      const input = cpscGetRecent.input.parse({});
      const result = await cpscGetRecent.handler(input, ctx);

      expect(result.recalls[0]!.data_quality_notes).toEqual([]);
    });

    it('carries the source caveat on the handler result', async () => {
      mockGetRecent.mockResolvedValueOnce([makeRaw()]);
      const input = cpscGetRecent.input.parse({});
      const result = await cpscGetRecent.handler(input, ctx);

      expect(result.source_note).toContain('relayed verbatim from the CPSC record');
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

    it('labels the relayed block as CPSC source fields', () => {
      const text = formatText(makeFormatResult());

      expect(text).toContain('CPSC source fields:\nHazard: Fire hazard');
    });
  });

  describe('offset paging', () => {
    /** Ten distinguishable recalls, numbered 30000..30009. */
    const tenRaws = () =>
      Array.from({ length: 10 }, (_, i) => makeRaw({ RecallNumber: `3000${i}` }));

    it('returns the second page for offset + limit', async () => {
      mockGetRecent.mockResolvedValueOnce(tenRaws());
      const input = cpscGetRecent.input.parse({ limit: 3, offset: 3 });
      const result = await cpscGetRecent.handler(input, ctx);

      expect(result.recalls.map((r) => r.recall_number)).toEqual(['30003', '30004', '30005']);
      expect(result.total_found).toBe(10);
      expect(result.offset).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it('returns an empty page (not an error) for an offset past total_found', async () => {
      mockGetRecent.mockResolvedValueOnce(tenRaws());
      const input = cpscGetRecent.input.parse({ limit: 5, offset: 50 });
      const result = await cpscGetRecent.handler(input, ctx);

      expect(result.recalls).toEqual([]);
      expect(result.total_found).toBe(10);
      expect(result.offset).toBe(50);
      expect(result.has_more).toBe(false);
    });

    it('sets has_more false on the final page and true on every earlier page', async () => {
      mockGetRecent.mockResolvedValueOnce(tenRaws());
      const first = await cpscGetRecent.handler(
        cpscGetRecent.input.parse({ limit: 5, offset: 0 }),
        ctx,
      );
      expect(first.has_more).toBe(true);

      mockGetRecent.mockResolvedValueOnce(tenRaws());
      const last = await cpscGetRecent.handler(
        cpscGetRecent.input.parse({ limit: 5, offset: 5 }),
        ctx,
      );
      expect(last.recalls).toHaveLength(5);
      expect(last.has_more).toBe(false);
    });

    it('keeps truncated limit-only and offset-independent', async () => {
      mockGetRecent.mockResolvedValueOnce(tenRaws());
      const paged = await cpscGetRecent.handler(
        cpscGetRecent.input.parse({ limit: 5, offset: 5 }),
        ctx,
      );
      expect(paged.has_more).toBe(false);
      expect(paged.truncated).toBe(true);

      mockGetRecent.mockResolvedValueOnce(tenRaws());
      const wide = await cpscGetRecent.handler(
        cpscGetRecent.input.parse({ limit: 20, offset: 5 }),
        ctx,
      );
      expect(wide.truncated).toBe(false);
    });

    it('defaults offset to 0 and rejects a negative offset', async () => {
      mockGetRecent.mockResolvedValueOnce([makeRaw()]);
      const result = await cpscGetRecent.handler(cpscGetRecent.input.parse({}), ctx);
      expect(result.offset).toBe(0);
      expect(() => cpscGetRecent.input.parse({ offset: -1 })).toThrow();
    });

    it('format surfaces the window and the next-page call', () => {
      const paged = formatText(
        makeFormatResult(undefined, {
          total_found: 40,
          truncated: true,
          offset: 20,
          has_more: true,
        }),
      );
      expect(paged).toContain('Found 40 recalls, showing 1 from offset 20 (truncated by limit).');
      expect(paged).toContain('More available — repeat with offset 21.');

      const single = formatText(makeFormatResult());
      expect(single).toContain('Found 1 recall.');
      expect(single).not.toContain('More available');
    });
  });

  describe('upstream error classification', () => {
    it('routes a non-retryable service error to upstream_rejected', async () => {
      mockGetRecent.mockRejectedValueOnce(
        new McpError(
          JsonRpcErrorCode.ServiceUnavailable,
          'CPSC API returned an error row instead of recall records: Invalid date format.',
          { retryable: false },
        ),
      );
      await expect(cpscGetRecent.handler(cpscGetRecent.input.parse({}), ctx)).rejects.toMatchObject(
        {
          message: 'CPSC API returned an error row instead of recall records: Invalid date format.',
          data: { reason: 'upstream_rejected', retryable: false },
        },
      );
    });

    it('keeps a transient service error on upstream_error and carries the upstream message', async () => {
      mockGetRecent.mockRejectedValueOnce(new Error('timeout'));
      await expect(cpscGetRecent.handler(cpscGetRecent.input.parse({}), ctx)).rejects.toMatchObject(
        {
          message: 'CPSC API request failed: timeout',
          data: { reason: 'upstream_error', retryable: true },
        },
      );
    });
  });
  /**
   * The wire envelope both client families read: `structuredContent` and the
   * `content[]` text channel must carry the same facts on success, and the same
   * reason plus recovery hint on failure.
   */
  describe('wire contract', () => {
    it('carries the feed on structuredContent and in the text channel', async () => {
      mockGetRecent.mockResolvedValueOnce([makeRaw()]);
      const result = await runToolContract(cpscGetRecent, { days: 7, limit: 5 });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        total_found: 1,
        truncated: false,
        offset: 0,
        has_more: false,
        recalls: [{ recall_number: '25043' }],
      });
      expect(() => cpscGetRecent.output.parse(result.structuredContent)).not.toThrow();

      const text = wireText(result);
      expect(text).toContain('25043');
      expect(text).toContain('ACME Widget Recall');
      expect(text).toContain('Fire hazard');
    });

    it('renders an empty window on both surfaces rather than failing', async () => {
      mockGetRecent.mockResolvedValueOnce([]);
      const result = await runToolContract(cpscGetRecent, { days: 7 });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        total_found: 0,
        has_more: false,
        recalls: [],
      });
      expect(wireText(result)).toContain('Found 0 recalls');
    });

    it('reports upstream_rejected with its recovery hint on both surfaces', async () => {
      mockGetRecent.mockRejectedValueOnce(
        new McpError(
          JsonRpcErrorCode.ServiceUnavailable,
          'CPSC API returned an error row instead of recall records: Invalid date format.',
          { retryable: false },
        ),
      );
      const result = await runToolContract(cpscGetRecent, { days: 7 });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.ServiceUnavailable,
          data: {
            reason: 'upstream_rejected',
            recovery: { hint: expect.stringContaining('Do not retry') },
          },
        },
      });
      expect(wireText(result)).toContain('Do not retry');
    });

    it('rejects an argument key the input schema does not declare', async () => {
      const result = await runToolContract(cpscGetRecent, { days: 7, page: 2 } as never);

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.ValidationError,
          message: expect.stringContaining('page'),
        },
      });
      expect(mockGetRecent).not.toHaveBeenCalled();
    });
  });
});

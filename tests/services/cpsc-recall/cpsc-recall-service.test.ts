/**
 * @fileoverview Tests for CpscRecallService — upstream response handling.
 * @module tests/services/cpsc-recall/cpsc-recall-service.test
 */

import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpscSearchRecalls } from '@/mcp-server/tools/definitions/cpsc-search-recalls.tool.js';
import {
  CpscRecallService,
  initCpscRecallService,
} from '@/services/cpsc-recall/cpsc-recall-service.js';

/** A genuine recall record, trimmed to the fields the service inspects. */
const genuineRecord = {
  RecallID: 4084,
  RecallNumber: '04084',
  RecallDate: '2004-02-11T00:00:00',
  LastPublishDate: '2004-02-11T00:00:00',
  Title: 'Toy Recall',
  Description: null,
  URL: 'https://www.cpsc.gov/Recalls/2004/toy',
  ConsumerContact: null,
  SoldAtLabel: null,
  Products: [],
  Inconjunctions: [],
  Images: [],
  Injuries: [],
  Manufacturers: [],
  Retailers: [],
  Importers: [],
  Distributors: [],
  ManufacturerCountries: [],
  ProductUPCs: [],
  Hazards: [],
  Remedies: [],
  RemedyOptions: [],
};

/**
 * The one-row array CPSC substitutes for results when a request is malformed upstream.
 * Identifying fields are null; the upstream message rides in `Title`.
 */
const cpscErrorRow = {
  ...genuineRecord,
  RecallNumber: null,
  RecallDate: null,
  Title: 'Error retrieving Recalls: String was not recognized as a valid DateTime.',
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** An HTTP 200 carrying something other than a JSON array of recalls. */
const textResponse = (body: string, contentType = 'text/html') =>
  new Response(body, { status: 200, headers: { 'content-type': contentType } });

describe('CpscRecallService', () => {
  let ctx: ReturnType<typeof createMockContext>;
  let service: CpscRecallService;
  const mockFetch = vi.fn();

  beforeEach(() => {
    ctx = createMockContext();
    service = new CpscRecallService();
    mockFetch.mockReset();
    mockFetch.mockRejectedValue(new Error('unmocked fetch'));
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects the CPSC error row instead of normalizing null fields', async () => {
    mockFetch.mockResolvedValue(jsonResponse([cpscErrorRow]));

    const err = await service.search({ RecallDateStart: '2026-99-99' }, ctx).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(
      'CPSC rejected the request: Error retrieving Recalls: String was not recognized as a valid DateTime.',
    );
    // Deterministic failure — the same request always produces the same row, so no retries.
    expect(err.data).toMatchObject({ retryable: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns a genuine record whose only null field is Description', async () => {
    mockFetch.mockResolvedValue(jsonResponse([genuineRecord]));

    const results = await service.search({ ProductName: 'toy' }, ctx);

    expect(results).toHaveLength(1);
    expect(results[0]?.RecallNumber).toBe('04084');
    expect(results[0]?.Description).toBeNull();
  });

  it('getByNumber returns null when the API returns an empty array', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));

    await expect(service.getByNumber('99999', ctx)).resolves.toBeNull();
  });

  it('forwards every declared search parameter to the upstream query string', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));

    await service.search(
      {
        ProductName: 'crib',
        Manufacturer: 'ACME',
        Retailer: 'Target',
        Importer: 'Import Co',
        Distributor: 'Walmart',
        RecallTitle: 'chandelier',
        RecallDescription: 'overheating',
        Remedy: 'repair',
        RecallDateStart: '2020-01-01',
        RecallDateEnd: '2021-01-01',
        LastPublishDateStart: '2025-01-01',
        LastPublishDateEnd: '2026-01-01',
      },
      ctx,
    );

    const url = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: 'json',
      ProductName: 'crib',
      Manufacturer: 'ACME',
      Retailer: 'Target',
      Importer: 'Import Co',
      Distributor: 'Walmart',
      RecallTitle: 'chandelier',
      RecallDescription: 'overheating',
      Remedy: 'repair',
      RecallDateStart: '2020-01-01',
      RecallDateEnd: '2021-01-01',
      LastPublishDateStart: '2025-01-01',
      LastPublishDateEnd: '2026-01-01',
    });
  });

  it('rejects the error row on the getRecent path too', async () => {
    mockFetch.mockResolvedValue(jsonResponse([cpscErrorRow]));

    await expect(service.getRecent('2026-01-01', '2026-02-01', ctx)).rejects.toThrow(
      /^CPSC rejected the request: Error retrieving Recalls/,
    );
  });

  it('says CPSC rejected the request without a reason when the row carries no message', async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ ...cpscErrorRow, Title: null }]));

    await expect(service.search({ RecallDateStart: '2026-99-99' }, ctx)).rejects.toThrow(
      'CPSC rejected the request without saying why.',
    );
  });

  /**
   * Each shape is classified transient, so the retry boundary spends its full
   * budget before the message reaches the caller. A fresh `Response` per attempt
   * is required — one instance's body is consumed by the first read.
   */
  describe('non-recall HTTP 200 bodies', () => {
    const cases = [
      {
        name: 'an HTML error page served as a 200',
        body: () => textResponse('<!DOCTYPE html>\n<html><body>Service unavailable</body></html>'),
        expected: /HTML instead of JSON/,
      },
      {
        name: 'a body that is not JSON at all',
        body: () => textResponse('not json', 'text/plain'),
        expected: /unparseable response/,
      },
      {
        name: 'valid JSON that is not an array',
        body: () => jsonResponse({ message: 'nope' }),
        expected: /not a JSON array/,
      },
    ];

    for (const { name, body, expected } of cases) {
      it(`retries then rejects ${name}`, async () => {
        mockFetch.mockImplementation(() => Promise.resolve(body()));

        await expect(service.search({ ProductName: 'crib' }, ctx)).rejects.toThrow(expected);
        // Default budget: the initial call plus three retries.
        expect(mockFetch).toHaveBeenCalledTimes(4);
      });
    }
  });

  /**
   * cpsc_search_recalls against the real service, fetch stubbed: the URL the upstream
   * actually receives, not the params object a service mock would record.
   */
  describe('upstream URL for cpsc_search_recalls', () => {
    const gracoCrib = {
      ...genuineRecord,
      Title: 'Graco Crib Recall',
      Hazards: [{ Name: 'Fire hazard', HazardType: '', HazardTypeID: '' }],
    };
    const upstreamQuery = async (args: Record<string, unknown>) => {
      mockFetch.mockResolvedValueOnce(jsonResponse([gracoCrib]));
      initCpscRecallService();
      const result = await runToolContract(cpscSearchRecalls, args as never);
      expect(result.isError).toBeFalsy();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      return Object.fromEntries(new URL(String(mockFetch.mock.calls[0]?.[0])).searchParams);
    };

    it('sends the 1970-01-01 date floor when hazard_search is the only filter', async () => {
      expect(await upstreamQuery({ hazard_search: 'fire' })).toEqual({
        format: 'json',
        RecallDateStart: '1970-01-01',
      });
    });

    it('sends one word per text filter and no floor when a filter maps upstream', async () => {
      expect(await upstreamQuery({ title_search: 'Graco crib', hazard_search: 'fire' })).toEqual({
        format: 'json',
        RecallTitle: 'Graco',
      });
    });

    /**
     * CPSC refuses a query string longer than 2,048 bytes (HTTP 404 at 2,049). Eight text
     * filters at their 500-character maximum, in a script that URL-encodes to nine bytes a
     * character, plus every date bound, must still fit.
     */
    it('keeps the query string within 2,048 bytes when every filter is at its maximum', async () => {
      const long = '中'.repeat(500);
      const query = await upstreamQuery({
        product_name: long,
        manufacturer: long,
        retailer: long,
        importer: long,
        distributor: long,
        title_search: long,
        description_search: long,
        remedy: long,
        date_start: '2000-01-01',
        date_end: '2026-12-31',
        updated_start: '2000-01-01',
        updated_end: '2026-12-31',
      });
      const search = new URL(String(mockFetch.mock.calls[0]?.[0])).search.slice(1);

      expect(search.length).toBeLessThanOrEqual(2_048);
      expect(query.RecallTitle).toBe('中'.repeat(22));
    });

    it('forwards a prefix of a long word that never splits a surrogate pair', async () => {
      const query = await upstreamQuery({ title_search: '😀'.repeat(250) });

      expect(query.RecallTitle).toBe('😀'.repeat(16));
    });

    it('relays a CPSC rejection as upstream_rejected on both surfaces, in behavioral terms', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([cpscErrorRow]));
      initCpscRecallService();
      const result = await runToolContract(cpscSearchRecalls, { title_search: 'crib' });
      const text = (result.content ?? [])
        .map((block) => ('text' in block ? block.text : ''))
        .join('');

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          message:
            'CPSC rejected the request: Error retrieving Recalls: String was not recognized as a valid DateTime.',
          data: { reason: 'upstream_rejected', retryable: false },
        },
      });
      expect(text).toContain('CPSC rejected the request: Error retrieving Recalls');
      expect(text).toContain('Do not retry this request unchanged');
      expect(text).not.toContain('error row');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry boundary', () => {
    it('retries a transient network failure and returns the eventual success', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce(jsonResponse([genuineRecord]));

      const results = await service.search({ ProductName: 'toy' }, ctx);

      expect(results).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries a transient failure on the getByNumber path too', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce(jsonResponse([genuineRecord]));

      await expect(service.getByNumber('04084', ctx)).resolves.toMatchObject({
        RecallNumber: '04084',
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("forwards the handler's abort signal to fetch", async () => {
      mockFetch.mockResolvedValue(jsonResponse([]));

      await service.search({ ProductName: 'toy' }, ctx);

      const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });
});

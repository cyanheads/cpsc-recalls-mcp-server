/**
 * @fileoverview Tests for CpscRecallService — upstream response handling.
 * @module tests/services/cpsc-recall/cpsc-recall-service.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';

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

describe('CpscRecallService', () => {
  let ctx: ReturnType<typeof createMockContext>;
  let service: CpscRecallService;
  const mockFetch = vi.fn();

  beforeEach(() => {
    ctx = createMockContext();
    service = new CpscRecallService();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects the CPSC error row instead of normalizing null fields', async () => {
    mockFetch.mockResolvedValue(jsonResponse([cpscErrorRow]));

    const err = await service.search({ RecallDateStart: '2026-99-99' }, ctx).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('error row');
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

  it('rejects the error row on the getRecent path too', async () => {
    mockFetch.mockResolvedValue(jsonResponse([cpscErrorRow]));

    await expect(service.getRecent('2026-01-01', '2026-02-01', ctx)).rejects.toThrow(/error row/);
  });
});

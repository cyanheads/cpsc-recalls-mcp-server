/**
 * @fileoverview Service for fetching consumer product recall data from the CPSC
 * saferproducts.gov REST API. Keyless, stateless per-request fetches.
 * @module services/cpsc-recall/cpsc-recall-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import { fetchWithTimeout, withRetry } from '@cyanheads/mcp-ts-core/utils';
import { normalizeRecall } from './normalize-text.js';
import type { CpscSearchParams, RawRecall } from './types.js';

const BASE_URL = 'https://www.saferproducts.gov/RestWebServices/Recall';
/** Request timeout: 30 s. The API returns full datasets; allow enough time. */
const TIMEOUT_MS = 30_000;
/** Upper bound on how much of the upstream error text is echoed back in the thrown message. */
const ERROR_ROW_MESSAGE_LIMIT = 200;

/**
 * The error-row message CPSC sends when its data source failed, rather than the request.
 * Every other error-row message (an unparseable date filter, for example) is deterministic.
 */
const PROVIDER_FAILURE = /underlying provider failed/i;

/** Query parameters by upstream name; an absent or empty value is not sent. */
type QueryParams = Partial<Record<string, string>>;

/** One fetch's outcome: the records, or the message of a provider-failure error row. */
type FetchOutcome = { recalls: RawRecall[] } | { providerFailure: string };

/**
 * True when a row is CPSC's error row rather than a recall record.
 *
 * When a request is malformed upstream (an unparseable date filter, for example) the API
 * answers HTTP 200 with a one-element array whose identifying fields are null and whose
 * `Title` carries the upstream message. The check keys on the identifying fields only —
 * a genuine record can carry a null `Description` and must not be rejected.
 */
function isCpscErrorRow(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return true;
  const r = row as Partial<RawRecall>;
  return r.RecallNumber == null || r.RecallDate == null || r.Title == null;
}

export class CpscRecallService {
  /**
   * Search recalls by filter params. Returns all matching records (the API has no
   * server-side pagination); client-side limiting must be applied by callers.
   */
  search(params: CpscSearchParams, ctx: Context): Promise<RawRecall[]> {
    return this.fetchRecalls(
      {
        ProductName: params.ProductName,
        Manufacturer: params.Manufacturer,
        Retailer: params.Retailer,
        Importer: params.Importer,
        Distributor: params.Distributor,
        RecallTitle: params.RecallTitle,
        RecallDescription: params.RecallDescription,
        Remedy: params.Remedy,
        RecallDateStart: params.RecallDateStart,
        RecallDateEnd: params.RecallDateEnd,
        LastPublishDateStart: params.LastPublishDateStart,
        LastPublishDateEnd: params.LastPublishDateEnd,
      },
      ctx,
    );
  }

  /**
   * Fetch a single recall by recall number. Returns `null` when no matching record
   * exists (API returns empty array for unknown numbers).
   */
  async getByNumber(recallNumber: string, ctx: Context): Promise<RawRecall | null> {
    const results = await this.fetchRecalls({ RecallNumber: recallNumber }, ctx);
    return results[0] ?? null;
  }

  /**
   * Fetch recalls within a date window. The date range is required — passing no
   * dates returns the whole dataset (over 10,000 records), which is too large to be useful.
   */
  getRecent(dateStart: string, dateEnd: string, ctx: Context): Promise<RawRecall[]> {
    return this.fetchRecalls({ RecallDateStart: dateStart, RecallDateEnd: dateEnd }, ctx);
  }

  /** The request URL: `format` first, or — for the provider-failure retry — last. */
  private buildUrl(params: QueryParams, formatLast = false): string {
    const qs = new URLSearchParams();
    if (!formatLast) qs.set('format', 'json');
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') qs.set(key, value);
    }
    if (formatLast) qs.set('format', 'json');
    return `${BASE_URL}?${qs.toString()}`;
  }

  /**
   * Fetches the records matching `params`, their text normalized.
   *
   * A provider-failure error row gets one immediate retry through the same query with
   * `format` moved last: CPSC serves a failed query's error row from a cache keyed on the
   * exact query string, so repeating the URL keeps failing while the reordered one misses
   * the cache. A second provider failure surfaces as retryable.
   */
  private async fetchRecalls(params: QueryParams, ctx: Context): Promise<RawRecall[]> {
    let outcome = await this.fetchOnce(this.buildUrl(params), ctx);
    if ('providerFailure' in outcome) {
      ctx.log.info('CPSC reported a provider failure; retrying with the query reordered', {
        upstreamMessage: outcome.providerFailure,
      });
      outcome = await this.fetchOnce(this.buildUrl(params, true), ctx);
    }
    if ('providerFailure' in outcome) {
      throw serviceUnavailable(`CPSC reported a temporary failure: ${outcome.providerFailure}`, {
        retryable: true,
      });
    }
    return outcome.recalls.map(normalizeRecall);
  }

  /**
   * One fetch of `url` under the retry boundary. A provider-failure row comes back as a
   * value rather than a throw, so `withRetry` never repeats a URL CPSC answers from cache.
   */
  private fetchOnce(url: string, ctx: Context): Promise<FetchOutcome> {
    return withRetry(
      async () => {
        const response = await fetchWithTimeout(url, TIMEOUT_MS, ctx, {
          signal: ctx.signal,
        });
        const text = await response.text();
        // Some upstream error pages return HTTP 200 with HTML.
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable(
            'CPSC API returned HTML instead of JSON — likely a transient service issue.',
          );
        }
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw serviceUnavailable('CPSC API returned unparseable response.');
        }
        if (!Array.isArray(data)) {
          throw serviceUnavailable('CPSC API response was not a JSON array.');
        }
        const errorRow = data.find(isCpscErrorRow);
        if (errorRow !== undefined) {
          const title = (errorRow as Partial<RawRecall>)?.Title;
          const upstreamMessage =
            typeof title === 'string' && title.length > 0
              ? title.slice(0, ERROR_ROW_MESSAGE_LIMIT)
              : undefined;
          if (upstreamMessage && PROVIDER_FAILURE.test(upstreamMessage)) {
            return { providerFailure: upstreamMessage };
          }
          throw serviceUnavailable(
            upstreamMessage
              ? `CPSC rejected the request: ${upstreamMessage}`
              : 'CPSC rejected the request without saying why.',
            // Deterministic — the same request produces the same error row, so skip retries.
            { retryable: false },
          );
        }
        return { recalls: data as RawRecall[] };
      },
      {
        operation: 'CpscRecallService.fetchRecalls',
        context: ctx,
        baseDelayMs: 500,
        signal: ctx.signal,
      },
    );
  }
}

// --- Init/accessor pattern ---

let _service: CpscRecallService | undefined;

export function initCpscRecallService(): void {
  _service = new CpscRecallService();
}

export function getCpscRecallService(): CpscRecallService {
  if (!_service) {
    throw new Error('CpscRecallService not initialized — call initCpscRecallService() in setup()');
  }
  return _service;
}

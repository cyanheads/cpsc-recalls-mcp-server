/**
 * @fileoverview Service for fetching consumer product recall data from the CPSC
 * saferproducts.gov REST API. Keyless, stateless per-request fetches.
 * @module services/cpsc-recall/cpsc-recall-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import { fetchWithTimeout, requestContextService, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type { CpscSearchParams, RawRecall } from './types.js';

const BASE_URL = 'https://www.saferproducts.gov/RestWebServices/Recall';
/** Request timeout: 30 s. The API returns full datasets; allow enough time. */
const TIMEOUT_MS = 30_000;
/** Upper bound on how much of the upstream error text is echoed back in the thrown message. */
const ERROR_ROW_MESSAGE_LIMIT = 200;

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
    const url = this.buildUrl({
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
    });
    return this.fetchRecalls(url, ctx);
  }

  /**
   * Fetch a single recall by recall number. Returns `null` when no matching record
   * exists (API returns empty array for unknown numbers).
   */
  async getByNumber(recallNumber: string, ctx: Context): Promise<RawRecall | null> {
    const url = this.buildUrl({ RecallNumber: recallNumber });
    const results = await this.fetchRecalls(url, ctx);
    return results[0] ?? null;
  }

  /**
   * Fetch recalls within a date window. The date range is required — passing no
   * dates returns all 9,828+ records, which is too large to be useful.
   */
  getRecent(dateStart: string, dateEnd: string, ctx: Context): Promise<RawRecall[]> {
    const url = this.buildUrl({ RecallDateStart: dateStart, RecallDateEnd: dateEnd });
    return this.fetchRecalls(url, ctx);
  }

  private buildUrl(params: Partial<Record<string, string>>): string {
    const qs = new URLSearchParams({ format: 'json' });
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') qs.set(key, value);
    }
    return `${BASE_URL}?${qs.toString()}`;
  }

  private fetchRecalls(url: string, ctx: Context): Promise<RawRecall[]> {
    const reqCtx = requestContextService.createRequestContext({
      operation: 'CpscRecallService.fetchRecalls',
      requestId: ctx.requestId,
    });
    return withRetry(
      async () => {
        const response = await fetchWithTimeout(url, TIMEOUT_MS, reqCtx, {
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
          const upstreamMessage = (errorRow as Partial<RawRecall>)?.Title;
          throw serviceUnavailable(
            'CPSC API returned an error row instead of recall records' +
              (typeof upstreamMessage === 'string' && upstreamMessage.length > 0
                ? `: ${upstreamMessage.slice(0, ERROR_ROW_MESSAGE_LIMIT)}`
                : '.'),
            // Deterministic — the same request produces the same error row, so skip retries.
            { retryable: false },
          );
        }
        return data as RawRecall[];
      },
      {
        operation: 'CpscRecallService.fetchRecalls',
        context: reqCtx,
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

/**
 * @fileoverview Tests for the list tools' shared response size budget.
 * @module tests/tools/response-budget.test
 */

import { describe, expect, it } from 'vitest';
import {
  budgetCutNotice,
  countWithinBudget,
  pageOverheadBytes,
  RESPONSE_BUDGET_BYTES,
} from '@/mcp-server/tools/response-budget.js';

/** Identity renderer: a string record renders as itself, so its JSON form is two bytes longer. */
const asText = (record: string) => record;

describe('response budget', () => {
  it('caps each surface at 64,000 bytes', () => {
    expect(RESPONSE_BUDGET_BYTES).toBe(64000);
  });

  describe('countWithinBudget', () => {
    /** Each 31,497-character record charges 31,500 bytes: 31,499 JSON bytes plus one separator. */
    const pair = ['a'.repeat(31_497), 'b'.repeat(31_497)];

    it('keeps a record that lands exactly on the budget', () => {
      expect(countWithinBudget(pair, asText, 1_000)).toBe(2);
    });

    it('drops the record that would cross the budget by one byte', () => {
      expect(countWithinBudget(pair, asText, 1_001)).toBe(1);
    });

    it('charges the rendered text when it is larger than the JSON', () => {
      const doubled = (record: string) => record + record;
      // 'x' × 16,000 renders to 32,000 bytes: charge 32,001 each, so two need 64,002.
      const records = ['x'.repeat(16_000), 'y'.repeat(16_000)];
      expect(countWithinBudget(records, doubled, 0)).toBe(1);
      expect(countWithinBudget(records, asText, 0)).toBe(2);
    });

    it('counts UTF-8 bytes rather than string length', () => {
      // 11,000 '€' is 11,000 characters but 33,000 bytes.
      const records = ['€'.repeat(11_000), '€'.repeat(11_000)];
      expect(countWithinBudget(records, asText, 0)).toBe(1);
    });

    it('returns a record larger than the budget alone rather than nothing', () => {
      expect(countWithinBudget(['z'.repeat(70_000), 'a'], asText, 500)).toBe(1);
    });

    it('returns zero for an empty window', () => {
      expect(countWithinBudget([], asText, 0)).toBe(0);
    });
  });

  describe('pageOverheadBytes', () => {
    it('reserves the JSON skeleton with its enrichment when that is the larger surface', () => {
      const skeleton = { recalls: [], note: 'n'.repeat(500) };
      const enrichment = { notice: 'Cut short.' };
      const json = Buffer.byteLength(JSON.stringify({ ...skeleton, ...enrichment }), 'utf8');

      expect(pageOverheadBytes(skeleton, 'short footer', enrichment)).toBe(json);
    });

    it('reserves the rendered text plus the enrichment trailer when that is the larger surface', () => {
      const text = 't'.repeat(900);
      const enrichment = { effectiveQuery: 'title_search="crib"', notice: 'Cut short.' };
      const overhead = pageOverheadBytes({ recalls: [] }, text, enrichment);

      // The framework renders "\n\nQuery: …\n> …": 900 + 2 + 7 + 19 + 1 + 2 + 10 = 941 bytes.
      expect(overhead).toBeGreaterThanOrEqual(941);
      expect(overhead).toBeLessThanOrEqual(941 + 2 * 4);
    });
  });

  describe('budgetCutNotice', () => {
    it('names the returned and requested counts, the budget, and the next offset', () => {
      expect(budgetCutNotice(34, 200, 74)).toBe(
        'Returned 34 of the 200 requested recalls: this page reached the 64,000-byte response size budget. Continue with offset 74 for the rest.',
      );
    });
  });
});

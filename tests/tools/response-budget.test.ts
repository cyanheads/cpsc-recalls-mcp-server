/**
 * @fileoverview Tests for the list tools' shared response size budget.
 * @module tests/tools/response-budget.test
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
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
    /**
     * Values the framework trailer renders at their largest: backtick runs that lengthen a
     * code span's delimiters, line breaks that turn it into a fenced block and add `> `
     * lines to a notice, edge spaces and backticks that add padding, and the empty string.
     */
    const hostile = [
      '',
      ' ',
      '`',
      '`'.repeat(500),
      'a`b``c```d',
      ` ${'`'.repeat(40)} `,
      'distributor="````" AND remedy="``"',
      'line one\nline two',
      'a\r\nb\rc\n',
      '\n\n\n\n',
      `${'`'.repeat(300)}\n${'`'.repeat(2)}`,
      '```\nfenced\n```',
      `${'é'.repeat(200)}\`\`\``,
      '> quoted\n- bullet\n1. item',
    ];

    /** Sets one value through the echo, notice, and generic trailer arms at once. */
    const probe = tool('budget_probe', {
      description: 'Echoes one value into every enrichment trailer arm.',
      input: z.object({ value: z.string().describe('The value to enrich with.') }),
      output: z.object({}).describe('Nothing; the value rides the enrichment.'),
      enrichment: {
        effectiveQuery: z.string().describe('The value, echoed as a query.'),
        notice: z.string().describe('The value, as a notice.'),
        note: z.string().describe('The value, as a generic field.'),
      },
      handler(input, ctx) {
        ctx.enrich.echo(input.value);
        ctx.enrich.notice(input.value);
        ctx.enrich({ note: input.value });
        return {};
      },
      format: () => [{ type: 'text', text: '' }],
    });

    it.each(hostile)('reserves the trailer the framework renders for %j', async (value) => {
      const result = await runToolContract(probe, { value });
      const blocks = result.content ?? [];
      const trailer = blocks.at(-1);
      expect(blocks).toHaveLength(2);
      const rendered = Buffer.byteLength(trailer?.type === 'text' ? trailer.text : '', 'utf8');
      expect(rendered).toBeGreaterThan(0);

      // A long page text makes content[] the larger surface, so the overhead past it is the trailer reservation.
      const pageText = 't'.repeat(100_000);
      const reserved =
        pageOverheadBytes({}, pageText, { effectiveQuery: value, notice: value, note: value }) -
        pageText.length;

      expect(reserved).toBeGreaterThanOrEqual(rendered);
    });

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

      // The framework renders "\n\nQuery: `…`\n> …": 900 + 2 + 7 + 21 + 1 + 2 + 10 = 943 bytes.
      expect(overhead).toBeGreaterThanOrEqual(943);
      /**
       * Each field is reserved its largest rendering — the generic `**key:** ` line with a
       * code span padded on both sides — plus a two-byte separator:
       * 900 + (2 + 20 + 19 + 4) + (2 + 12 + 10 + 4) = 973 bytes.
       */
      expect(overhead).toBe(973);
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

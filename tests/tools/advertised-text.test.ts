/**
 * @fileoverview Tests for the text the server advertises to callers — tool descriptions,
 * every schema `.describe()`, error `when`/`recovery`, and the server `instructions` —
 * plus the jurisdiction note every tool renders.
 * @module tests/tools/advertised-text.test
 */

import { readFileSync } from 'node:fs';
import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cpscGetRecall } from '@/mcp-server/tools/definitions/cpsc-get-recall.tool.js';
import { cpscGetRecent } from '@/mcp-server/tools/definitions/cpsc-get-recent.tool.js';
import { cpscSearchRecalls } from '@/mcp-server/tools/definitions/cpsc-search-recalls.tool.js';

vi.mock('@/services/cpsc-recall/cpsc-recall-service.js', () => ({
  getCpscRecallService: vi.fn(),
  initCpscRecallService: vi.fn(),
}));

import { getCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';

const tools = [cpscSearchRecalls, cpscGetRecall, cpscGetRecent] as const;

const sourceOf = (relative: string) =>
  readFileSync(new URL(`../../src/${relative}`, import.meta.url), 'utf8');

const SOURCE_FILES = [
  'mcp-server/tools/definitions/cpsc-search-recalls.tool.ts',
  'mcp-server/tools/definitions/cpsc-get-recall.tool.ts',
  'mcp-server/tools/definitions/cpsc-get-recent.tool.ts',
  'index.ts',
];

/** The server `instructions` literal, read from source: importing `index.ts` would start the server. */
function serverInstructions(): string {
  const match = /instructions:\s*'((?:[^'\\\n]|\\.)*)',/.exec(sourceOf('index.ts'));
  if (!match?.[1]) throw new Error('instructions is not a single-line string literal');
  return match[1];
}

/** Every `description` string anywhere in a JSON Schema. */
function schemaDescriptions(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(schemaDescriptions);
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === 'description' && typeof value === 'string' ? [value] : schemaDescriptions(value),
  );
}

/** Each advertised string, labeled with where it comes from. */
function advertisedStrings(): Array<[string, string]> {
  const strings: Array<[string, string]> = [['instructions', serverInstructions()]];
  for (const def of tools) {
    const output = def.enrichment ? def.output.extend(def.enrichment) : def.output;
    strings.push([`${def.name} description`, def.description]);
    for (const text of schemaDescriptions(z.toJSONSchema(def.input))) {
      strings.push([`${def.name} input`, text]);
    }
    for (const text of schemaDescriptions(z.toJSONSchema(output))) {
      strings.push([`${def.name} output`, text]);
    }
    for (const entry of def.errors ?? []) {
      strings.push([`${def.name} ${entry.reason} when`, entry.when]);
      strings.push([`${def.name} ${entry.reason} recovery`, entry.recovery]);
    }
  }
  return strings;
}

/** How the server routes a request — never what a caller observes. */
const MECHANICS = [
  /client[- ]side/i,
  /applied upstream/i,
  /upstream fetch/i,
  /\bupstream\b/i,
  /the API returns/i,
  /\bAPI\b/,
  /error row/i,
  /Hazard parameter/i,
  /\barray\b/i,
  /in the API/i,
  /9,8\d\d/,
];

describe('advertised text', () => {
  it('collects strings from every tool, schema, error entry, and the instructions', () => {
    const labels = new Set(advertisedStrings().map(([label]) => label.split(' ')[0]));
    expect(labels).toEqual(
      new Set(['instructions', 'cpsc_search_recalls', 'cpsc_get_recall', 'cpsc_get_recent']),
    );
    expect(advertisedStrings().length).toBeGreaterThan(80);
  });

  it('describes behavior, never routing or provider mechanics', () => {
    const leaks = advertisedStrings().flatMap(([label, text]) =>
      MECHANICS.filter((pattern) => pattern.test(text)).map(
        (pattern) => `${label}: ${pattern} in "${text}"`,
      ),
    );
    expect(leaks).toEqual([]);
  });

  it('writes every string as a single-line literal, with no + joins', () => {
    for (const file of SOURCE_FILES) {
      const joined = sourceOf(file)
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => /['"`]\s*\+\s*$/.test(line) || /^\s*\+\s*['"`]/.test(line));
      expect({ file, joined }).toEqual({ file, joined: [] });
    }
  });

  it('keeps the instructions to a few sentences that require a filter and route browsing', () => {
    const instructions = serverInstructions();
    const sentences = instructions.split(/(?<=\.)\s+(?=[A-Z])/);

    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(instructions).toContain('at least one filter');
    expect(instructions).toContain('cpsc_get_recent');
    expect(instructions).toContain('cpsc_get_recall');
    expect(instructions).toContain('CPSC jurisdiction');
  });

  describe('cpsc_search_recalls guidance', () => {
    const inputDescriptions = z.toJSONSchema(cpscSearchRecalls.input).properties as Record<
      string,
      { description?: string }
    >;

    /** The recall field(s) each text filter matches, as its description names them. */
    const fieldNamed: Record<string, string[]> = {
      product_name: ['product names'],
      manufacturer: ['manufacturer names'],
      retailer: ['retailer'],
      importer: ['importer names'],
      distributor: ['distributor names'],
      title_search: ['title'],
      description_search: ['description'],
      remedy: ['remedy instructions'],
      hazard_search: ['hazard descriptions', 'product names', 'remedy instructions'],
    };
    for (const [filter, fields] of Object.entries(fieldNamed)) {
      it(`says which recall fields ${filter} matches, and that every word must appear`, () => {
        const text = inputDescriptions[filter]?.description ?? '';
        for (const field of fields) expect(text).toContain(field);
        expect(text).toContain('every word');
      });
    }

    it('covers the criterion rule, AND combination, word matching, paging, and jurisdiction', () => {
      const text = cpscSearchRecalls.description;
      expect(text).toContain('at least one');
      expect(text).toContain('cpsc_get_recent');
      expect(text).toContain('AND');
      expect(text).toContain('every one of its words, in any order');
      expect(text).toContain('offset');
      expect(text).toContain('has_more');
      expect(text).toContain('64,000-byte');
      expect(text).toContain('CPSC jurisdiction');
    });

    it('says a page can return fewer than limit when the size budget is reached', () => {
      for (const def of [cpscSearchRecalls, cpscGetRecent]) {
        const limit = (
          z.toJSONSchema(def.input).properties as Record<string, { description: string }>
        ).limit;
        expect(limit?.description).toContain('64,000-byte');
      }
    });

    /**
     * A budget-cut page returns fewer than limit, so stepping offset by limit skips records;
     * the offset guidance must step by the count the previous page returned.
     */
    it('pages offset by the number returned, never by a fixed limit step', () => {
      for (const def of [cpscSearchRecalls, cpscGetRecent]) {
        const offset = (
          z.toJSONSchema(def.input).properties as Record<string, { description: string }>
        ).offset;
        expect(offset?.description).toContain('number of recalls the previous page returned');
        expect(offset?.description).not.toMatch(/offset 0, 20, 40/);
      }
    });

    it('states UPC sparsity and recall-level attribution on both tools that return UPCs', () => {
      for (const def of [cpscSearchRecalls, cpscGetRecall]) {
        const texts = schemaDescriptions(z.toJSONSchema(def.output)).filter((t) =>
          t.startsWith('UPC codes'),
        );
        expect(texts).toHaveLength(1);
        expect(texts[0]).toContain('~4%');
        expect(texts[0]).toContain('not per product');
      }
    });
  });

  describe('jurisdiction note', () => {
    const makeRaw = () => ({
      RecallID: 1,
      RecallNumber: '25043',
      RecallDate: '2025-03-15T00:00:00',
      LastPublishDate: '2025-03-15T00:00:00',
      Title: 'ACME Widget Recall',
      Description: 'Fire hazard.',
      URL: 'https://www.cpsc.gov/Recalls/2025/acme-widget',
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
      Hazards: [{ Name: 'Fire hazard', HazardType: '', HazardTypeID: '' }],
      Remedies: [],
      RemedyOptions: [],
    });

    beforeEach(() => {
      vi.mocked(getCpscRecallService).mockReturnValue({
        search: vi.fn().mockResolvedValue([makeRaw()]),
        getByNumber: vi.fn().mockResolvedValue(makeRaw()),
        getRecent: vi.fn().mockResolvedValue([makeRaw()]),
      } as never);
    });

    const wire = async () => {
      const results = await Promise.all([
        runToolContract(cpscSearchRecalls, { title_search: 'widget' }),
        runToolContract(cpscGetRecall, { recall_number: '25043' }),
        runToolContract(cpscGetRecent, { days: 7 }),
      ]);
      return results.map((result) => ({
        jurisdiction: (result.structuredContent as { cpsc_jurisdiction: string }).cpsc_jurisdiction,
        text: (result.content ?? []).map((block) => ('text' in block ? block.text : '')).join(''),
      }));
    };

    it('renders the same "CPSC jurisdiction:" line on every tool, matching structuredContent', async () => {
      const [search, recall, recent] = await wire();

      for (const surface of [search, recall, recent]) {
        expect(surface?.text).toContain(`CPSC jurisdiction: ${surface?.jurisdiction}`);
        expect(surface?.text).not.toContain('CPSC covers: CPSC covers');
      }
      expect(recent?.jurisdiction).toBe(recall?.jurisdiction);
      expect(search?.jurisdiction).toBe(
        `${recall?.jurisdiction} For those categories, use the appropriate server.`,
      );
    });
  });

  describe('recall_number validation', () => {
    it('rejects a malformed number with -32602 invalid_arguments and advertises the pattern', async () => {
      const result = await runToolContract(cpscGetRecall, { recall_number: '2504' });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'invalid_arguments' } },
      });
      const { properties } = z.toJSONSchema(cpscGetRecall.input);
      expect(properties?.recall_number).toMatchObject({ pattern: '^\\d{5}([a-d])?$' });
    });

    it('names both accepted forms and the tools that return recall numbers, not the raw regex', async () => {
      const result = await runToolContract(cpscGetRecall, { recall_number: '2504' });
      const text = (result.content ?? [])
        .map((block) => ('text' in block ? block.text : ''))
        .join('');
      const { data } = (
        result.structuredContent as { error: { data: { recovery: { hint: string } } } }
      ).error;

      for (const surface of [text, data.recovery.hint]) {
        expect(surface).toContain('25043');
        expect(surface).toContain('99003a');
        expect(surface).toContain('cpsc_search_recalls');
        expect(surface).toContain('cpsc_get_recent');
        expect(surface).not.toContain('must match pattern');
      }
    });
  });
});

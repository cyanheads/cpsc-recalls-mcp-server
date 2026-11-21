/** Verify the recall search criteria through the tool contract and the real CPSC request builder. */

import { z } from '@cyanheads/mcp-ts-core';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import MarkdownIt from 'markdown-it';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpscSearchRecalls } from '@/mcp-server/tools/definitions/cpsc-search-recalls.tool.js';
import { initCpscRecallService } from '@/services/cpsc-recall/cpsc-recall-service.js';
import type { RawRecall } from '@/services/cpsc-recall/types.js';

function recall(recallNumber: string, fields: Partial<RawRecall> = {}): RawRecall {
  return {
    RecallID: Number(recallNumber),
    RecallNumber: recallNumber,
    RecallDate: '2026-10-10T00:00:00',
    LastPublishDate: '2026-10-11T00:00:00',
    Title: 'Product recalled',
    Description: null,
    URL: 'https://www.cpsc.gov/Recalls/2026/toys',
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
    ...fields,
  };
}

describe('classified remedy, barcode, and incident searches', () => {
  const fetchCpsc = vi.fn<typeof fetch>();
  const markdown = new MarkdownIt('commonmark');

  beforeEach(() => {
    fetchCpsc.mockReset();
    vi.stubGlobal('fetch', fetchCpsc);
    initCpscRecallService();
  });

  afterEach(() => vi.unstubAllGlobals());

  async function search(input: Record<string, unknown>, ...rows: RawRecall[]) {
    fetchCpsc.mockResolvedValueOnce(Response.json(rows));
    const result = await runToolContract(cpscSearchRecalls, input as never);
    const text = (result.content ?? [])
      .map((block) => ('text' in block ? block.text : ''))
      .join('\n');
    return { ...result, text, html: markdown.render(text) };
  }

  function query() {
    return new URL(String(fetchCpsc.mock.lastCall?.[0])).searchParams;
  }

  it('advertises remedy choices and the UPC pattern and includes incidents in the output schema', () => {
    expect(z.toJSONSchema(cpscSearchRecalls.input, { io: 'input' })).toMatchObject({
      properties: {
        remedy_option: {
          enum: [
            'Refund',
            'Repair',
            'Replace',
            'New Instructions',
            'Dispose',
            'Label',
            'No Remedy Available',
            'Inspect',
          ],
        },
        upc: { pattern: '^(?:[0-9][ -]?){5,13}[0-9]$' },
        injury_search: { type: 'string' },
      },
    });
    expect(z.toJSONSchema(cpscSearchRecalls.output)).toMatchObject({
      properties: { recalls: { items: { properties: { injuries: { type: 'string' } } } } },
    });
  });

  it('keeps the legacy remedy criterion bound to instructions, not classification', async () => {
    const disposal = recall('27042', {
      Remedies: [{ Name: 'Send a disposal photo.' }],
      RemedyOptions: [{ Option: 'Refund' }],
    });
    const textRefund = recall('27043', { Remedies: [{ Name: 'Ask for a refund.' }] });

    const result = await search({ remedy: 'refund' }, disposal, textRefund);

    expect(result.structuredContent).toMatchObject({
      total_found: 1,
      recalls: [{ recall_number: '27043' }],
    });
    expect(query().get('Remedy')).toBe('refund');
    expect(query().has('RemedyOption')).toBe(false);
  });

  it.each(['Refund', ' refund '])(
    'matches classified %j before counting and paging',
    async (option) => {
      const result = await search(
        { remedy_option: option, date_start: '2026-10-01', offset: 1 },
        recall('27021', { RemedyOptions: [{ Option: 'Refund' }, { Option: 'Replace' }] }),
        recall('27041', { RemedyOptions: [{ Option: 'Refund instructions' }] }),
        recall('27042', {
          Remedies: [{ Name: 'Send a disposal photo.' }],
          RemedyOptions: [{ Option: 'Refund' }],
        }),
      );

      expect(Object.fromEntries(query())).toEqual({
        format: 'json',
        RecallDateStart: '2026-10-01',
        RemedyOption: 'Refund',
      });
      expect(result.structuredContent).toMatchObject({
        total_found: 2,
        effectiveQuery: 'remedy_option="Refund" AND date_start=2026-10-01',
        recalls: [{ recall_number: '27042', remedy_options: ['Refund'] }],
      });
      expect(result.html).toContain('[27042]');
    },
  );

  it('keeps multiple source remedy classifications and matches any exact option', async () => {
    const result = await search(
      { remedy_option: 'Replace' },
      recall('27021', { RemedyOptions: [{ Option: 'Refund' }, { Option: 'Replace' }] }),
    );
    expect(result.structuredContent).toMatchObject({
      total_found: 1,
      recalls: [{ recall_number: '27021', remedy_options: ['Refund', 'Replace'] }],
    });
    expect(result.html).toContain('Refund, Replace');
  });

  it('rejects an unknown remedy option while blank alone triggers missing_criteria', async () => {
    const invalid = await search({ remedy_option: 'Rebate' });
    expect(invalid.structuredContent).toMatchObject({ error: { code: -32602 } });
    expect(invalid.text).toContain('No Remedy Available');
    const blank = await search({ remedy_option: ' ' });
    expect(blank.structuredContent).toMatchObject({
      error: { data: { reason: 'missing_criteria' } },
    });
    expect(blank.text).toContain('remedy_option');
    expect(fetchCpsc).not.toHaveBeenCalled();
  });

  it('explains classification coverage when a prose option is the only candidate', async () => {
    const result = await search(
      { remedy_option: 'Repair' },
      recall('25326', {
        RemedyOptions: [{ Option: 'A certified technician will install the repair.' }],
      }),
    );
    expect(result.structuredContent).toMatchObject({
      total_found: 0,
      notice: expect.stringContaining('unclassified'),
    });
    expect(result.html).toContain('unclassified');
  });

  it.each([
    ['812355036227', '26536'],
    ['036227', '26536'],
    ['0-82294-319754', '03051'],
    ['082294319754', '03051'],
    ['0 82294 319754', '03051'],
    ['319754', '03051'],
    ['810002862779', '27069'],
    ['266045', '07114'],
  ])('matches UPC candidate %j on %s', async (upc, recallNumber) => {
    const result = await search(
      { upc },
      recall('26536', { ProductUPCs: [{ UPC: '812355036227' }] }),
      recall('03051', { Description: 'UPC numbers 0-82294-319754 (white).' }),
      recall('27069', { Description: 'Model number GTF7530 and UPC Code 810002862779.' }),
      recall('07114', { ProductUPCs: [{ UPC: '1524100121266045' }] }),
      recall('26801', { ProductUPCs: [{ UPC: '812355136227' }] }),
    );
    expect(Object.fromEntries(query())).toEqual({ format: 'json', RecallDateStart: '1970-01-01' });
    expect(result.structuredContent).toMatchObject({
      total_found: 1,
      effectiveQuery: `upc=${JSON.stringify(upc)}`,
      recalls: [{ recall_number: recallNumber }],
    });
    expect(result.html).toContain(`[${recallNumber}]`);
    expect(result.html).toContain('confirm');
  });

  it.each(['12345', 'abc', '036\t227'])(
    'rejects malformed UPC %j with a usable shape',
    async (upc) => {
      const result = await search({ upc });
      expect(result.structuredContent).toMatchObject({ error: { code: -32602 } });
      expect(result.text).toContain('6–14');
      expect(fetchCpsc).not.toHaveBeenCalled();
    },
  );

  it('does not treat an interior digit run as a suffix and explains sparse coverage', async () => {
    const result = await search(
      { upc: '355036' },
      recall('26536', { ProductUPCs: [{ UPC: '812355036227' }] }),
    );
    expect(result.structuredContent).toMatchObject({
      total_found: 0,
      notice: expect.stringContaining('brand and product'),
    });
    expect(result.html).toContain('brand and product');
  });

  it('does not interpret a one-digit quantity as a zero-padded UPC', async () => {
    const result = await search(
      { upc: '000001' },
      recall('26536', { Description: 'Only 1 product was recalled.' }),
    );
    expect(result.structuredContent).toMatchObject({ total_found: 0, recalls: [] });
    expect(result.html).toContain('brand and product');
  });

  it('matches every injury word across incident entries and preserves reported denials', async () => {
    const shared = [
      recall('10051', { Injuries: [{ Name: 'The death of a girl.' }] }),
      recall('14161', {
        Injuries: [{ Name: 'An infant was involved.' }, { Name: 'A death was reported.' }],
      }),
      recall('20713', {
        Injuries: [{ Name: 'No collisions, crashes, injuries or deaths have been reported.' }],
      }),
      recall('25000', { Title: 'Death of infant', Injuries: [] }),
    ];
    const result = await search({ injury_search: 'death infant' }, ...shared);
    expect(query().get('Injury')).toBe('infant');
    expect(result.structuredContent).toMatchObject({
      total_found: 1,
      effectiveQuery: 'injury_search="death infant"',
      recalls: [
        { recall_number: '14161', injuries: 'An infant was involved. A death was reported.' },
      ],
    });
    expect(result.html).toContain('An infant was involved. A death was reported.');
    const withDenial = await search({ injury_search: 'death' }, ...shared);
    expect(withDenial.structuredContent).toMatchObject({ total_found: 3 });
    expect(withDenial.html).toContain(
      'No collisions, crashes, injuries or deaths have been reported.',
    );
  });

  it('combines every new criterion before offset and preserves exhausted-page guidance', async () => {
    const result = await search(
      { injury_search: 'death _', remedy_option: 'Refund', upc: '036227', offset: 1 },
      recall('27041', {
        Injuries: [{ Name: 'A death _ was reported.' }],
        ProductUPCs: [{ UPC: '812355036227' }],
        RemedyOptions: [{ Option: 'Repair' }],
      }),
      recall('27042', {
        Injuries: [{ Name: 'A death _ was reported.' }],
        ProductUPCs: [{ UPC: '812355036227' }],
        RemedyOptions: [{ Option: 'Refund' }],
      }),
      recall('27043', {
        Injuries: [{ Name: 'A death was reported.' }],
        ProductUPCs: [{ UPC: '812355036227' }],
        RemedyOptions: [{ Option: 'Refund' }],
      }),
      recall('27044', {
        Injuries: [{ Name: 'A death _ was reported.' }],
        ProductUPCs: [{ UPC: '812355136227' }],
        RemedyOptions: [{ Option: 'Refund' }],
      }),
    );
    expect(query().get('Injury')).toBe('death');
    expect(result.structuredContent).toMatchObject({
      total_found: 1,
      recalls: [],
      has_more: false,
      notice: expect.stringContaining('Offset 1 is past'),
    });
    expect(result.html).toContain('Offset 1 is past');
  });

  it('explains missing narratives and leaves an unreported narrative empty on other searches', async () => {
    const result = await search({ injury_search: 'death' }, recall('25000'));
    expect(result.structuredContent).toMatchObject({
      total_found: 0,
      notice: expect.stringContaining('incident narrative'),
    });
    expect(result.html).toContain('incident narrative');
    const broad = await search({ date_start: '2026-10-01' }, recall('25000'));
    expect(broad.structuredContent).toMatchObject({ recalls: [{ injuries: '' }] });
  });
});

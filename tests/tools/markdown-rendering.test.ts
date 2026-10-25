/**
 * @fileoverview Independent CommonMark and GFM checks for CPSC formatter data parity.
 * @module tests/tools/markdown-rendering.test
 */

import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { cpscGetRecall } from '@/mcp-server/tools/definitions/cpsc-get-recall.tool.js';
import { cpscGetRecent } from '@/mcp-server/tools/definitions/cpsc-get-recent.tool.js';
import { cpscSearchRecalls } from '@/mcp-server/tools/definitions/cpsc-search-recalls.tool.js';

const record = {
  recall_number: '25043',
  recall_date: '2025-03-15',
  last_updated: '2025-03-20',
  title: 'Model_X *Pro*',
  description: 'Serial 1HFVE05**K4000003\n- Model_X\nwww.example.com/model',
  cpsc_url: 'https://www.cpsc.gov/Kids&amp;Co (recall)',
  consumer_contact: 'Call now',
  hazards: [{ description: 'Burn hazard' }],
  remedy_options: ['Refund'],
  remedy_instructions: 'Stop use',
  remedy_summary: 'Stop use',
  products: [{ name: 'Model_X *Pro*', units_recalled: 'About 5,000' }],
  upcs: [],
  injuries: 'None reported',
  manufacturers: [],
  importers: [],
  retailers: [],
  distributors: [],
  manufacturer_countries: [],
  images: [{ url: 'https://x.gov/a b(c)<d>.png?x=&amp;.', caption: 'Label *with* [brackets]' }],
  coordinated_recalls: ['https://x.gov/another recall'],
  data_quality_notes: [],
  cpsc_jurisdiction: 'Consumer products',
  source_note: 'CPSC records',
};

const page = {
  recalls: [{ ...record, hazards: ['Burn hazard'] }],
  total_found: 1,
  truncated: false,
  offset: 0,
  has_more: false,
  period: { start: '2025-03-01', end: '2025-03-31', days: 31 },
  cpsc_jurisdiction: record.cpsc_jurisdiction,
  source_note: record.source_note,
};

/** Flatten parser tokens, including inline descendants, without rendering through server code. */
function tokens(markdown: InstanceType<typeof MarkdownIt>, text: string) {
  return markdown.parse(text, {}).flatMap((token) => [token, ...(token.children ?? [])]);
}

describe.each([
  ['CommonMark', new MarkdownIt('commonmark')],
  ['GFM autolinks', new MarkdownIt({ linkify: true })],
] as const)('%s rendering', (_name, markdown) => {
  it('keeps recall and coordinated links complete and renders images with literal captions', () => {
    const detail = cpscGetRecall.format!(cpscGetRecall.output.parse(record));
    const search = cpscSearchRecalls.format!(cpscSearchRecalls.output.parse(page));
    for (const blocks of [detail, search]) {
      const parsed = tokens(
        markdown,
        blocks.map((block) => (block.type === 'text' ? block.text : '')).join(''),
      );
      expect(
        parsed
          .filter((token) => token.type === 'image')
          .map((token) => ({
            src: token.attrGet('src'),
            caption: token.children?.map((child) => child.content).join(''),
          })),
      ).toEqual([
        { src: 'https://x.gov/a%20b(c)%3Cd%3E.png?x=&amp;.', caption: 'Label *with* [brackets]' },
      ]);
      expect(
        parsed.filter((token) => token.type === 'link_open').map((token) => token.attrGet('href')),
      ).toContain('https://www.cpsc.gov/Kids&amp;Co%20(recall)');
    }
    expect(
      tokens(markdown, detail.map((block) => (block.type === 'text' ? block.text : '')).join(''))
        .filter((token) => token.type === 'link_open')
        .map((token) => token.attrGet('href')),
    ).toContain('https://x.gov/another%20recall');
    const recent = cpscGetRecent.format!(
      cpscGetRecent.output.parse({
        ...page,
        recalls: [{ ...record, hazards: ['Burn hazard'], products: ['Model_X *Pro*'] }],
      }),
    );
    expect(
      tokens(markdown, recent.map((block) => (block.type === 'text' ? block.text : '')).join(''))
        .filter((token) => token.type === 'link_open')
        .map((token) => token.attrGet('href')),
    ).toContain('https://www.cpsc.gov/Kids&amp;Co%20(recall)');
  });

  it('keeps multiline serial numbers and GFM prose addresses literal', () => {
    const blocks = cpscGetRecall.format!(cpscGetRecall.output.parse(record));
    const parsed = tokens(
      markdown,
      blocks.map((block) => (block.type === 'text' ? block.text : '')).join(''),
    );
    const text = parsed
      .filter((token) => token.type === 'text')
      .map((token) => token.content)
      .join('\n');
    expect(text).toContain('Serial 1HFVE05**K4000003');
    expect(text).toContain('- Model_X');
    expect(text).toContain('www.example.com/model');
    expect(parsed.filter((token) => token.type === 'em_open')).toEqual([]);
  });

  it('shows unsafe destinations as literal text without creating links or images', () => {
    const blocks = cpscGetRecall.format!(
      cpscGetRecall.output.parse({
        ...record,
        cpsc_url: 'javascript:alert(1)',
        images: [{ url: 'data:text/html,<b>unsafe</b>', caption: '*Label*' }],
        coordinated_recalls: [],
      }),
    );
    const parsed = tokens(
      markdown,
      blocks.map((block) => (block.type === 'text' ? block.text : '')).join(''),
    );
    expect(parsed.filter((token) => token.type === 'image')).toEqual([]);
    expect(
      parsed.filter((token) => token.type === 'link_open').map((token) => token.attrGet('href')),
    ).not.toContain('javascript:alert(1)');
    expect(
      parsed
        .filter((token) => token.type === 'text')
        .map((token) => token.content)
        .join('\n'),
    ).toContain('*Label* (data:text/html,<b>unsafe</b>)');
  });
});

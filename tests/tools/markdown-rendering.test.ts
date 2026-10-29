/**
 * @fileoverview Independent CommonMark and GFM checks for CPSC formatter data parity.
 * @module tests/tools/markdown-rendering.test
 */

import MarkdownIt from 'markdown-it';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { describe, expect, it } from 'vitest';
import { cpscGetRecall } from '@/mcp-server/tools/definitions/cpsc-get-recall.tool.js';
import { cpscGetRecent } from '@/mcp-server/tools/definitions/cpsc-get-recent.tool.js';
import { cpscSearchRecalls } from '@/mcp-server/tools/definitions/cpsc-search-recalls.tool.js';
import { escapeMarkdown } from '@/mcp-server/tools/markdown-escape.js';

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
  ['markdown-it linkify', new MarkdownIt({ linkify: true })],
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

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  '#x27': "'",
};

/** Decodes the references an HTML renderer writes, in one pass so `&amp;lt;` stays `&lt;`. */
function decodeHtml(html: string): string {
  return html.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_ref, name: string) => HTML_ENTITIES[name]!);
}

/** The text a reader sees, whitespace runs collapsed. */
function visible(html: string): string {
  return decodeHtml(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every link target, in order. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/<a href="([^"]*)"/g)].map((match) => decodeHtml(match[1]!));
}

const commonMarkIt = new MarkdownIt('commonmark');

/**
 * Renderers outside the server's code: CommonMark in two implementations, and GFM through
 * micromark's autolink-literal extension, which ends links where GitHub's cmark-gfm does
 * (markdown-it's linkify detector does not).
 */
describe.each([
  ['markdown-it CommonMark', (text: string) => commonMarkIt.render(text), false],
  ['micromark CommonMark', (text: string) => micromark(text), false],
  [
    'micromark GFM',
    (text: string) => micromark(text, { extensions: [gfm()], htmlExtensions: [gfmHtml()] }),
    true,
  ],
] as const)('%s rendering of prose addresses', (_name, render, autolinks) => {
  /** Each slot: the text as written, and the Markdown that carries it there. */
  const slots: [string, (address: string) => [text: string, markdown: string]][] = [
    ['after a space', (a) => [`see ${a} now`, escapeMarkdown(`see ${a} now`)]],
    ['after "("', (a) => [`see (${a}) now`, escapeMarkdown(`see (${a}) now`)]],
    ['at the start of a quote line', (a) => [a, `> ${escapeMarkdown(a)}`]],
  ];

  it.each([
    ['www.example.com/a*b*', 'http://www.example.com/a*b'],
    ['https://x.com/a*b*', 'https://x.com/a*b'],
    ['https://x.com/?ref_=a_', 'https://x.com/?ref_=a'],
    ['www.example.com/?a=1&amp;b=2', 'http://www.example.com/?a=1&amp;b=2'],
  ])('shows every character of %s and links it to %s', (address, href) => {
    for (const [slot, place] of slots) {
      const [text, markdown] = place(address);
      const html = render(markdown);
      expect(visible(html), slot).toBe(text);
      expect(hrefs(html), slot).toEqual([href]);
    }
  });

  it('links an address before "<" without a backslash in its text or target', () => {
    const html = render(escapeMarkdown('see www.example.com/a<b now'));
    expect(visible(html)).toBe('see www.example.com/a<b now');
    expect(hrefs(html)).toEqual(['http://www.example.com/a']);
  });

  it('ends a link where GFM does and shows the characters after it', () => {
    const text = 'see https://x.com/a*b"; or 1https://x.com/c_d_ or see!https://x.com/e*f*';
    const html = render(escapeMarkdown(text));
    expect(visible(html)).toBe(text);
    expect(hrefs(html)).toEqual(['https://x.com/a*b', 'https://x.com/c_d', 'https://x.com/e*f']);
    expect(html).not.toContain('<img');
  });

  it('leaves an address with nothing to escape for GFM to link', () => {
    const html = render(escapeMarkdown('see www.example.com/model now'));
    expect(visible(html)).toBe('see www.example.com/model now');
    expect(hrefs(html)).toEqual(autolinks ? ['http://www.example.com/model'] : []);
  });

  it('shows an address GFM does not autolink as escaped text', () => {
    const text = 'a "www.x.com/a*b*" b https://my_site.com/a*b* c https://_x_ d';
    const html = render(escapeMarkdown(text));
    expect(visible(html)).toBe(text);
    expect(hrefs(html)).toEqual([]);
  });

  it('carries the link form through each tool that relays CPSC titles', () => {
    const titled = { ...record, title: 'Model see www.example.com/a*b* now' };
    const rendered = [
      cpscGetRecall.format!(cpscGetRecall.output.parse(titled)),
      cpscSearchRecalls.format!(
        cpscSearchRecalls.output.parse({ ...page, recalls: [{ ...titled, hazards: ['Burn'] }] }),
      ),
      cpscGetRecent.format!(
        cpscGetRecent.output.parse({
          ...page,
          recalls: [{ ...titled, hazards: ['Burn'], products: ['Model'] }],
        }),
      ),
    ];
    for (const blocks of rendered) {
      const html = render(
        blocks.map((block) => (block.type === 'text' ? block.text : '')).join(''),
      );
      expect(visible(html)).toContain('Model see www.example.com/a*b* now');
      expect(hrefs(html)).toContain('http://www.example.com/a*b');
    }
  });
});

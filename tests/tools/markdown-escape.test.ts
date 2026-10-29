/**
 * @fileoverview Tests for the Markdown escaping applied to CPSC text in `content[]`.
 * @module tests/tools/markdown-escape.test
 */

import { describe, expect, it } from 'vitest';
import { escapeMarkdown } from '@/mcp-server/tools/markdown-escape.js';

describe('escapeMarkdown', () => {
  it('escapes emphasis, code, link, and strikethrough characters and backslashes anywhere', () => {
    expect(escapeMarkdown('1HFVE05**K4000003 1HFVE05**K4003902')).toBe(
      '1HFVE05\\*\\*K4000003 1HFVE05\\*\\*K4003902',
    );
    expect(escapeMarkdown('ECP8*')).toBe('ECP8\\*');
    expect(escapeMarkdown('labeled \\"CABINET.\\"')).toBe('labeled \\\\"CABINET.\\\\"');
    expect(escapeMarkdown('`x` [a](b) ~~c~~')).toBe('\\`x\\` \\[a\\](b) \\~\\~c\\~\\~');
  });

  it('escapes an underscore unless letters or digits sit on both sides', () => {
    expect(escapeMarkdown('AMG005197_12_Q_GLT')).toBe('AMG005197_12_Q_GLT');
    expect(escapeMarkdown('Modèle_é')).toBe('Modèle_é');
    expect(escapeMarkdown('_Model_ X_ _Y __Z__')).toBe('\\_Model\\_ X\\_ \\_Y \\_\\_Z\\_\\_');
  });

  it('escapes "<" only where it opens a tag or autolink, and "&" only where it opens a reference', () => {
    expect(escapeMarkdown('<Main> </td> <!-- <?x <5mW a < b')).toBe(
      '\\<Main> \\</td> \\<!-- \\<?x <5mW a < b',
    );
    expect(escapeMarkdown('Stoopher & Boots &amp; C&T; &#38; AT&T')).toBe(
      'Stoopher & Boots \\&amp; C\\&T; \\&#38; AT&T',
    );
  });

  it('escapes the first "#" of a run that ends a line, which a heading would drop', () => {
    expect(escapeMarkdown('Model # and Serial #')).toBe('Model # and Serial \\#');
    expect(escapeMarkdown('Call 672-2300. ###\nNext')).toBe('Call 672-2300. \\###\nNext');
    expect(escapeMarkdown('No. #123')).toBe('No. #123');
  });

  it('keeps each line start from opening a block, and leaves the same markers mid-line alone', () => {
    expect(escapeMarkdown('Ross\n- Simply 6\n+ plus\n# Head\n> quote\n=== \n| a |')).toBe(
      'Ross\n\\- Simply 6\n\\+ plus\n\\# Head\n\\> quote\n\\=== \n\\| a |',
    );
    expect(escapeMarkdown('- first\n  - indented')).toBe('\\- first\n  \\- indented');
    expect(escapeMarkdown('1. one\n2) two\n3.5 inches\n2026.')).toBe(
      '1\\. one\n2\\) two\n3.5 inches\n2026\\.',
    );
    expect(escapeMarkdown('a - b + c > d = e | f 1. g')).toBe('a - b + c > d = e | f 1. g');
    expect(escapeMarkdown('1234567890. ten digits')).toBe('1234567890. ten digits');
  });

  it('leaves an address GFM autolinks as it is when it holds nothing to escape', () => {
    const text =
      'see https://x.com/a/b?c=1#d, www.x.com/page. and (www.x.com/(e)) or www.x.com/a<5';
    expect(escapeMarkdown(text)).toBe(text);
  });

  /**
   * A backslash inside a GFM autolink shows literally, so an address GFM links that holds a
   * character to escape becomes an explicit link over the span GFM links, with the
   * characters GFM leaves out of the link escaped after it as text.
   */
  it('renders an address GFM autolinks as an explicit link when it holds a character to escape', () => {
    expect(escapeMarkdown('www.example.com/a*b*')).toBe(
      '[www.example.com/a\\*b](<http://www.example.com/a*b>)\\*',
    );
    expect(
      escapeMarkdown('see https://www.cpsc.gov/a_b*c?_x=1 or www.amazon.com/s?ref_=x_ now_'),
    ).toBe(
      'see [https://www.cpsc.gov/a_b\\*c?\\_x=1](<https://www.cpsc.gov/a_b*c?_x=1>) or [www.amazon.com/s?ref\\_=x](<http://www.amazon.com/s?ref_=x>)\\_ now\\_',
    );
    expect(escapeMarkdown('(www.x.com/a*b*) "https://a_b.x.com/c*d*"')).toBe(
      '([www.x.com/a\\*b](<http://www.x.com/a*b>)\\*) "[https://a_b.x.com/c\\*d](<https://a_b.x.com/c*d>)\\*"',
    );
    expect(escapeMarkdown('see www.example.com/?a=1&amp;b=2 now')).toBe(
      'see [www.example.com/?a=1\\&amp;b=2](<http://www.example.com/?a=1\\&amp;b=2>) now',
    );
  });

  it('links the address before an escaped "<" over GFM\'s span, so no backslash joins the link', () => {
    expect(escapeMarkdown('see www.example.com/a<b now')).toBe(
      'see [www.example.com/a](<http://www.example.com/a>)\\<b now',
    );
    expect(escapeMarkdown('https://x.com/a.<br>')).toBe(
      '[https://x.com/a](<https://x.com/a>).\\<br>',
    );
  });

  /** Where cmark-gfm's `autolink_delim` ends the link, as GitHub renders it. */
  it('ends the link where GFM ends the autolink and escapes the rest as text', () => {
    expect(escapeMarkdown('https://x.com/a*?!.,:_~"\' x')).toBe(
      '[https://x.com/a](<https://x.com/a>)\\*?!.,:\\_\\~"\' x',
    );
    expect(escapeMarkdown('https://x.com/a*b(c)) x')).toBe(
      '[https://x.com/a\\*b(c)](<https://x.com/a*b(c)>)) x',
    );
    expect(escapeMarkdown('https://x.com/a*)(b) x')).toBe(
      '[https://x.com/a\\*)(b](<https://x.com/a*)(b>)) x',
    );
    expect(escapeMarkdown('https://x.com/a*&amp;&copy;. x')).toBe(
      '[https://x.com/a](<https://x.com/a>)\\*\\&amp;\\&copy;. x',
    );
    expect(escapeMarkdown('https://x.com/a*&a1; x')).toBe(
      '[https://x.com/a\\*&a1](<https://x.com/a*&a1>); x',
    );
    expect(escapeMarkdown('https://x.com/a*] x')).toBe(
      '[https://x.com/a\\*\\]](<https://x.com/a*]>) x',
    );
  });

  /** GFM links a scheme after anything but an ASCII letter, and `![…](…)` is an image. */
  it('links a scheme address after a digit, a non-ASCII letter, or "!" as text reads it', () => {
    expect(escapeMarkdown('1https://x.com/a*b and éhttps://x.com/c_ x')).toBe(
      '1[https://x.com/a\\*b](<https://x.com/a*b>) and é[https://x.com/c](<https://x.com/c>)\\_ x',
    );
    expect(escapeMarkdown('see!https://x.com/a*b*')).toBe(
      'see\\![https://x.com/a\\*b](<https://x.com/a*b>)\\*',
    );
    expect(escapeMarkdown('see!https://x.com/ab and xhttps://x.com/a*b')).toBe(
      'see!https://x.com/ab and xhttps://x.com/a\\*b',
    );
  });

  /** `markdownLink` would show such an address twice, as `label (url)`. */
  it('escapes an address as text when its link target is not a parseable web URL', () => {
    expect(escapeMarkdown('see https://x.com:99999/a*b* now')).toBe(
      'see https://x.com:99999/a\\*b\\* now',
    );
  });

  /**
   * GFM links a `www.` address only after whitespace or `(`, `*`, `_`, `~`, and no address
   * whose host has `_` in its last two labels; left unescaped, such an address renders
   * `*b*` as emphasis.
   */
  it('escapes an address GFM does not autolink as the text it renders as', () => {
    expect(escapeMarkdown('"www.x.com/a*b*" or x.www.y.com/_c_')).toBe(
      '"www.x.com/a\\*b\\*" or x.www.y.com/\\_c\\_',
    );
    expect(escapeMarkdown('https://my_site.com/a*b* and https://x.a_b.com/c*d*')).toBe(
      'https://my_site.com/a\\*b\\* and https://x.a_b.com/c\\*d\\*',
    );
  });

  /** No renderer links an address whose host starts with punctuation, so it is plain text. */
  it('escapes an address-shaped run whose host does not start with a letter or digit', () => {
    expect(escapeMarkdown('at https://_x_ or www._y_ ok')).toBe(
      'at https://\\_x\\_ or www.\\_y\\_ ok',
    );
  });

  /** CommonMark ends a line at a carriage return, so a marker after one opens a block. */
  it('treats a carriage return as a line break, so the line after it opens no block', () => {
    expect(escapeMarkdown('line one\r- two\r\n# three')).toBe('line one\n\\- two\n\\# three');
  });

  it('keeps a line starting with ":" from completing a GFM table delimiter row', () => {
    expect(escapeMarkdown('Size | Price\n:-- | --:\nS | $5')).toBe(
      'Size | Price\n\\:-- | --:\nS | $5',
    );
  });

  it('returns text with nothing to escape unchanged', () => {
    const text = "Children's Robes (About 2,500) sold at Target for $45 — 100% refund.";
    expect(escapeMarkdown(text)).toBe(text);
  });

  /**
   * Adversarial shapes: each must scale linearly. From 5,000 to 320,000 characters linear
   * work grows 64× and quadratic 4,096×; the full-span bound allows 256×, and the per-size
   * bound stops a quadratic pass before it reaches the largest input.
   */
  const adversarial: Record<string, (n: number) => string> = {
    'long runs of "*"': (n) => '*'.repeat(n),
    'long runs of "_"': (n) => '_'.repeat(n),
    'a newline followed by long whitespace': (n) => `\n${' '.repeat(n - 2)}x`,
    'many line starts': (n) => '\n#'.repeat(n / 2),
    'a "#" followed by long whitespace': (n) => ` #${' '.repeat(n - 3)}x`,
    'a long "#" run': (n) => ` ${'#'.repeat(n - 1)}`,
    'many tags in one string': (n) => 'x<br>'.repeat(n / 5),
    '"<" and a letter, with no ">"': (n) => '<a'.repeat(n / 2),
    '"&" and a long alphanumeric run, with no ";"': (n) => `&${'a'.repeat(n - 1)}`,
    'one long web address': (n) => `https://${'a_'.repeat(n / 2 - 4)}`,
    'an address holding "*" followed by a long ")" run': (n) =>
      `https://x.com/a*${')'.repeat(n - 16)}`,
    'an address holding "*" followed by a long "&a;" run': (n) =>
      `https://x.com/a*${'&a;'.repeat((n - 16) / 3)}`,
    'an address holding "*" followed by a long "(" run': (n) =>
      `https://x.com/a*${'('.repeat(n - 16)}`,
    'an address holding "*" followed by a long ";" run': (n) =>
      `https://x.com/a*${';'.repeat(n - 16)}`,
    'an address holding "*" ending in a long letter run and ";"': (n) =>
      `https://x.com/a*${'a'.repeat(n - 17)};`,
    'many addresses rendered as links': (n) => 'www.x.com/a*b* '.repeat(n / 15),
    'many addresses after "!" before an escaped "<"': (n) => '!https://x.com/a<b '.repeat(n / 20),
    'one long line of addresses ending in a line break': (n) =>
      `${'https://x.com/a* '.repeat((n - 2) / 17)}\ny`,
    'line breaks through the whole input': (n) => '  \r\n'.repeat(n / 4),
  };
  for (const [shape, make] of Object.entries(adversarial)) {
    it(`runs in linear time on ${shape}`, () => {
      expect(timeDoubling(make, escapeMarkdown)).toBeLessThan(256);
    });
  }
});

/** Thread CPU each measurement runs for, so a coarse CPU clock tick never reads as zero. */
const SAMPLE_MS = 8;

/**
 * Per-call thread CPU time in milliseconds, excluding other workers and scheduler delays,
 * over as many calls as it takes to use {@link SAMPLE_MS}.
 */
function perCallMs(run: (input: string) => unknown, input: string): number {
  const start = process.threadCpuUsage();
  let calls = 0;
  let elapsedMs = 0;
  do {
    run(input);
    calls++;
    const elapsed = process.threadCpuUsage(start);
    elapsedMs = (elapsed.user + elapsed.system) / 1_000;
  } while (elapsedMs < SAMPLE_MS);
  return elapsedMs / calls;
}

/**
 * Times `run` on `make(n)` for n doubling from 5,000 to 320,000 characters, asserting each
 * size's best-of-three per-call time against an absolute bound (1 ms per 1,600 characters)
 * before timing the next, and returns the 320,000 ÷ 5,000 time ratio.
 */
function timeDoubling(make: (length: number) => string, run: (input: string) => unknown): number {
  const times: number[] = [];
  for (let length = 5_000; length <= 320_000; length *= 2) {
    const input = make(length);
    perCallMs(run, input);
    const ms = Math.min(perCallMs(run, input), perCallMs(run, input), perCallMs(run, input));
    expect(ms, `${length} characters`).toBeLessThan(length / 1_600);
    times.push(ms);
  }
  return times.at(-1)! / times[0]!;
}

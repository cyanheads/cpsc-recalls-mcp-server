/**
 * @fileoverview Tests for the Markdown escaping applied to CPSC text in `content[]`.
 * @module tests/tools/markdown-escape.test
 */

import { describe, expect, it } from 'vitest';
import {
  bareAddress,
  escapeMarkdown,
  linkDestination,
} from '@/mcp-server/tools/markdown-escape.js';
import { timeAcrossSizes } from '../linear-time.js';

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

  it('leaves web addresses as they are, so a GFM autolink shows no backslash', () => {
    expect(
      escapeMarkdown('see https://www.cpsc.gov/a_b*c?_x=1 or www.amazon.com/s?ref_=x_ now_'),
    ).toBe('see https://www.cpsc.gov/a_b*c?_x=1 or www.amazon.com/s?ref_=x_ now\\_');
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
   * Adversarial shapes from the issue: each must scale linearly. Quadratic work would take
   * 256× the time for 16× the input; the bound allows 64×.
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
  };
  for (const [shape, make] of Object.entries(adversarial)) {
    it(`runs in linear time on ${shape}`, () => {
      const { ms80k, ratio } = timeAcrossSizes(make, escapeMarkdown);
      expect(ratio).toBeLessThan(64);
      expect(ms80k).toBeLessThan(50);
    });
  }
});

describe('linkDestination', () => {
  it('percent-encodes whitespace, angle brackets, and parentheses as UTF-8', () => {
    expect(
      linkDestination('https://www.cpsc.gov/Recalls/2024/Amer Sports Winter & Outdoor Recalls'),
    ).toBe('https://www.cpsc.gov/Recalls/2024/Amer%20Sports%20Winter%20&%20Outdoor%20Recalls');
    expect(linkDestination('https://x.gov/a\u00a0b(c)<d>')).toBe(
      'https://x.gov/a%C2%A0b%28c%29%3Cd%3E',
    );
  });

  it('returns an address with nothing to encode unchanged, existing escapes included', () => {
    const url = 'https://www.cpsc.gov/Recalls/2025/Acme-Recalls-Widgets?lang=eng&rn=25043%20';
    expect(linkDestination(url)).toBe(url);
  });
});

describe('bareAddress', () => {
  it('encodes a web address so it stays one address, and leaves one with nothing to encode as it is', () => {
    expect(bareAddress('https://www.cpsc.gov/s3fs-public/Neon Nitro 8 (top view)_0.png')).toBe(
      'https://www.cpsc.gov/s3fs-public/Neon%20Nitro%208%20%28top%20view%29_0.png',
    );
    expect(bareAddress('https://example.com/a_b*.png')).toBe('https://example.com/a_b*.png');
  });

  /** GFM leaves trailing punctuation out of an autolink; records 26799 and 26793 end so. */
  it('percent-encodes a trailing ".", "_", or "~" so a GFM autolink keeps it', () => {
    expect(bareAddress('https://cpsc.gov/s3fs-public/ABC3.png?VersionId=Yz4.7.f1i.')).toBe(
      'https://cpsc.gov/s3fs-public/ABC3.png?VersionId=Yz4.7.f1i%2E',
    );
    expect(bareAddress('https://cpsc.gov/Xinan3.png?VersionId=Q8_Kwu_')).toBe(
      'https://cpsc.gov/Xinan3.png?VersionId=Q8_Kwu%5F',
    );
    expect(bareAddress('https://x.gov/a~._')).toBe('https://x.gov/a%7E%2E%5F');
  });

  it('escapes a value that is not a web address as text, without percent-encoding it', () => {
    expect(bareAddress('The recalled *mattresses* (queen)')).toBe(
      'The recalled \\*mattresses\\* (queen)',
    );
  });
});

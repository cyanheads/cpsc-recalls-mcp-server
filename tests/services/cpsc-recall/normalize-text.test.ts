/**
 * @fileoverview Tests for the CPSC text normalizer — reference decoding, tag removal, and
 * its cost on adversarial input.
 * @module tests/services/cpsc-recall/normalize-text.test
 */

import { describe, expect, it } from 'vitest';
import { normalizeRecall, normalizeText } from '@/services/cpsc-recall/normalize-text.js';
import type { RawRecall } from '@/services/cpsc-recall/types.js';
import { timeAcrossSizes } from '../../linear-time.js';

describe('normalizeText', () => {
  it('decodes the XML references, &nbsp;, and decimal and hex numeric references', () => {
    expect(normalizeText('Stoopher &amp; Boots')).toBe('Stoopher & Boots');
    expect(normalizeText('&lt;&gt;&quot;&apos;&nbsp;')).toBe('<>"\' ');
    expect(normalizeText('&#38; &#x26; &#X26; &#8482; &#x1F600;')).toBe('& & & ™ 😀');
  });

  it('decodes in one pass, so decoded text is never decoded or stripped again', () => {
    expect(normalizeText('&amp;lt;br&amp;gt;')).toBe('&lt;br&gt;');
    expect(normalizeText('see &lt;br&gt; and &lt;p')).toBe('see <br> and <p');
  });

  it('leaves unknown, unterminated, and out-of-range references and bare ampersands alone', () => {
    for (const text of [
      'manufactured by C&T; however',
      'Helmets & Helmet Accessories',
      'AT&T',
      '&amp',
      '&#;',
      '&#0;',
      '&#xD800;',
      '&#99999999;',
      '&#x110000;',
      '&copy;',
    ]) {
      expect(normalizeText(text)).toBe(text);
    }
  });

  /**
   * A control character would decode invisible, and HTML reads 128–159 as Windows-1252
   * punctuation, not C1 controls, so those references stay visible as written.
   */
  it('leaves references to control characters other than tab, line feed, and carriage return alone', () => {
    for (const text of ['&#1;', '&#27;', '&#x1B;', '&#127;', '&#146;', '&#x96;', '&#159;']) {
      expect(normalizeText(text)).toBe(text);
    }
    expect(normalizeText('a&#9;b&#10;c&#13;d&#160;e')).toBe('a\tb\nc\rd e');
  });

  it('removes a tag without joining its neighbours', () => {
    expect(normalizeText('07039261 thru 07039743</td> 07067165 thru 07073548')).toBe(
      '07039261 thru 07039743 07067165 thru 07073548',
    );
    expect(normalizeText('26" Titanium <td valign="middle" headers="Model"> K6672')).toBe(
      '26" Titanium K6672',
    );
    expect(normalizeText('Red</td>Blue')).toBe('Red Blue');
  });

  it('turns br, p, and tr — opening or closing — into one line break', () => {
    expect(normalizeText('Picture of Recalled BC117-K45<br>BC117CR-K45 Compensator')).toBe(
      'Picture of Recalled BC117-K45\nBC117CR-K45 Compensator',
    );
    expect(normalizeText("Mervyn's - Ross <p>- Simply 6")).toBe("Mervyn's - Ross\n- Simply 6");
    expect(normalizeText('09000-09025 </tr> Coronet <br /> <td>2400')).toBe(
      '09000-09025\nCoronet\n2400',
    );
    expect(normalizeText('A <BR> B')).toBe('A\nB');
  });

  it('removes a tag cut off at the end of the string', () => {
    expect(normalizeText('out of an abundance of caution. <br/')).toBe(
      'out of an abundance of caution.',
    );
    expect(normalizeText("under CPSC's jurisdiction.</p")).toBe("under CPSC's jurisdiction.");
  });

  it('drops tags at either end without leaving a separator', () => {
    expect(normalizeText('<p>Text</p>')).toBe('Text');
    expect(normalizeText('<br><td>')).toBe('');
  });

  it('keeps "<" when a digit, a space, or nothing follows it, at the end of the string too', () => {
    for (const text of [
      'Max. Output: <5mW, class IIIa',
      'iQ0036407 <9m (29.5ft) and <17.5m',
      'ends with <17.5m',
      'a < b',
      'trailing <',
      'line-height: normal;">Dependiendo',
    ]) {
      expect(normalizeText(text)).toBe(text);
    }
  });

  it('keeps text that holds no reference or tag, whitespace included', () => {
    const text = 'Sold Online At:\nAmazon.com  from June';
    expect(normalizeText(text)).toBe(text);
  });

  /**
   * Adversarial shapes from the issue: each must scale linearly. Quadratic work would take
   * 256× the time for 16× the input; the bound allows 64×.
   */
  const adversarial: Record<string, (n: number) => string> = {
    'many tags in one string': (n) => 'x <td a="b"> y<br>'.repeat(Math.ceil(n / 18)).slice(0, n),
    '"<" and a letter, with no ">"': (n) => '<a'.repeat(n / 2),
    '"<" and a long name, with no ">"': (n) => `<${'a'.repeat(n - 1)} `,
    '"<td" and spaces, with no ">"': (n) => `<td${' '.repeat(n - 3)}x`,
    '"&" and a long alphanumeric run, with no ";"': (n) => `&${'a1'.repeat(n / 2 - 1)}x`,
    '"&#" and a long digit run': (n) => `&#${'1'.repeat(n - 2)}`,
    'many references': (n) => '&amp;'.repeat(n / 5),
  };
  for (const [shape, make] of Object.entries(adversarial)) {
    it(`runs in linear time on ${shape}`, () => {
      const { ms80k, ratio } = timeAcrossSizes(make, normalizeText);
      expect(ratio).toBeLessThan(64);
      expect(ms80k).toBeLessThan(50);
    });
  }
});

describe('normalizeRecall', () => {
  const record = {
    RecallID: 9491,
    RecallNumber: '23085',
    RecallDate: '2023-01-05T00:00:00',
    LastPublishDate: '2023-01-05T00:00:00',
    Title: 'Kids &amp; Co Recall',
    Description: null,
    URL: 'https://www.cpsc.gov/Recalls/2023/Kids&amp;Co <br>',
    ConsumerContact: 'Call<br>now',
    SoldAtLabel: null,
    Products: [
      {
        Name: 'Robe &amp; Belt',
        Description: '',
        Model: '',
        Type: 'Robes &amp; Sleepwear',
        CategoryID: '',
        NumberOfUnits: 'About 1,000',
      },
    ],
    Inconjunctions: [{ URL: 'https://example.ca/a&amp;b' }],
    Images: [{ URL: 'https://www.cpsc.gov/a&amp;b.png', Caption: 'A<br>B' }],
    Injuries: [],
    Manufacturers: [],
    Retailers: [{ Name: 'Stoopher &amp; Boots', CompanyID: '' }],
    Importers: [],
    Distributors: [],
    ManufacturerCountries: [{ Country: 'China &amp; Vietnam' }],
    ProductUPCs: [],
    Hazards: [],
    Remedies: [],
    RemedyOptions: [],
  } satisfies RawRecall;

  it('normalizes every text field, nested entries included, and leaves addresses and non-strings alone', () => {
    expect(normalizeRecall(record)).toEqual({
      ...record,
      Title: 'Kids & Co Recall',
      ConsumerContact: 'Call\nnow',
      Products: [{ ...record.Products[0], Name: 'Robe & Belt', Type: 'Robes & Sleepwear' }],
      Images: [{ URL: 'https://www.cpsc.gov/a&amp;b.png', Caption: 'A\nB' }],
      Retailers: [{ Name: 'Stoopher & Boots', CompanyID: '' }],
      ManufacturerCountries: [{ Country: 'China & Vietnam' }],
    });
  });

  it('returns a copy and leaves its input untouched', () => {
    const before = structuredClone(record);
    normalizeRecall(record);
    expect(record).toEqual(before);
  });
});

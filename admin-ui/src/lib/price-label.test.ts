import { describe, expect, it } from 'vitest';
import { buildPriceLabel, labelHex, type PriceLabelDraft } from './price-label';

const sample: PriceLabelDraft = {
  nameKk: 'Көже',
  nameRu: 'Коже',
  price: '500',
  ingredientsRu: 'Кукуруза, кефир, рис, вода.',
  ingredientsKk: 'Жүгері, айран, күріш, су.',
  background: '#792C14',
};
const measure = (text: string, size: number) => [...text].length * size * 0.55;
describe('price labels', () => {
  it('uses the exact paper size and both languages', () => {
    const result = buildPriceLabel(sample, measure);
    expect(result.fits).toBe(true);
    expect(result.svg).toContain('width="100mm" height="60mm"');
    expect(result.svg).toContain('Көже');
    expect(result.svg).toContain('Құрамы:');
    expect(result.svg).toContain('Состав:');
    expect(result.svg).toContain('>500</tspan>');
  });
  it('keeps names and ingredients as text, never executable markup', () => {
    const result = buildPriceLabel(
      {
        ...sample,
        nameRu: '<script>alert(1)</script>',
        ingredientsRu: '</text><image onload="evil()"/>',
      },
      measure,
    );
    expect(result.svg).not.toContain('<script>');
    expect(result.svg).not.toContain('<image');
    expect(result.svg).toContain('&lt;');
    expect(labelHex('#fff" onload="evil')).toBeNull();
    expect(labelHex('abc123')).toBe('#ABC123');
  });
  it('rejects missing translations, invalid prices and text that would be cut off', () => {
    expect(buildPriceLabel({ ...sample, nameKk: '' }, measure).errors.nameKk).toBeTruthy();
    for (const price of ['NaN', '-1', 'Infinity', '500 ₸', '1.001', '10000000']) {
      expect(buildPriceLabel({ ...sample, price }, measure).errors.price).toBeTruthy();
    }
    expect(buildPriceLabel({ ...sample, ingredientsKk: 'Состав '.repeat(150) }, measure).fits).toBe(
      false,
    );
    expect(buildPriceLabel({ ...sample, price: '1250,50' }, measure).svg).toContain('1 250,5');
  });
});

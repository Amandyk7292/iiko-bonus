import { create } from 'qrcode';
import { productPublicUrl } from './product-qr';
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
  it('embeds the selected product QR with a white quiet zone only when enabled', () => {
    const id = '0669be83-bd9c-4e74-9150-dfc9a452e56b';
    const qr = create(productPublicUrl(id), { errorCorrectionLevel: 'M' }).modules;
    const result = buildPriceLabel(sample, measure, qr);
    expect(result.fits).toBe(true);
    expect(result.svg).toContain('x="760" y="20" width="220" height="220"');
    expect(result.svg).toContain(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`);
    const cells = result.svg.match(/h1v1h-1z/g) || [];
    expect(cells.length).toBe(Array.from(qr.data).filter(Boolean).length);
    expect(buildPriceLabel(sample, measure).svg).not.toContain('QR-код товара');
  });
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

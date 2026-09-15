import { describe, it, expect } from 'vitest';
import { labelProducts } from './price-label-batch';
import { labelPosition } from './price-label-pdf';
describe('bulk labels', () => {
  it('uses all products and excludes admin stops and hidden products/categories', () => {
    const menu = {
      rawMenu: {
        products: Array.from({ length: 45 }, (_, i) => ({
          id: String(i),
          name: `Товар ${i}`,
          parentGroup: i === 3 ? 'hidden' : 'main',
          sizePrices: [{ price: { currentPrice: 300 } }],
        })),
      },
      overrides: {
        products: [
          { iiko_product_id: '0', is_stop_listed: true },
          { iiko_product_id: '1', is_hidden: true },
          { iiko_product_id: '2', custom_price: 350 },
        ],
        categories: [{ iiko_category_id: 'hidden', is_hidden: true }],
        customProducts: [
          { id: 'custom', name: 'Свой', price: 500, category_name: 'Свои' },
          { id: 'off', name: 'Стоп', price: 100, category_name: 'Свои', is_available: false },
        ],
      },
    };
    const result = labelProducts(menu);
    expect(result).toHaveLength(43);
    for (const id of ['0', '1', '3', 'off']) expect(result.some((p) => p.id === id)).toBe(false);
    expect(result.find((p) => p.id === '2')?.price).toBe('350');
    expect(result.find((p) => p.id === '44')?.price).toBe('300');
  });
  it('lays out eight 100 by 60 mm labels inside A4 without scaling', () => {
    const mm = 72 / 25.4;
    for (let i = 0; i < 8; i++) {
      const p = labelPosition(i);
      expect(p.width / mm).toBeCloseTo(100);
      expect(p.height / mm).toBeCloseTo(60);
      expect(p.x).toBeGreaterThanOrEqual(3.5 * mm);
      expect(p.x + p.width).toBeLessThanOrEqual(206.5 * mm + 0.001);
      expect(p.y).toBeGreaterThanOrEqual(24 * mm - 0.001);
    }
    expect((labelPosition(1).x - labelPosition(0).x - labelPosition(0).width) / mm).toBeCloseTo(3);
    expect((labelPosition(0).y - labelPosition(2).y - labelPosition(0).height) / mm).toBeCloseTo(3);
    expect(labelPosition(8)).toEqual(labelPosition(0));
  });
});

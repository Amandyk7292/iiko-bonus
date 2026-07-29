import { describe, expect, it } from 'vitest';
import {
  normalizeStorageConditionsForSave,
  sanitizeProductOverridePatch,
} from './menu-page.shared';

describe('menu product override payload', () => {
  it('removes service fields and compacts blank storage rows', () => {
    expect(
      sanitizeProductOverridePatch({
        iiko_product_id: 'product-1',
        updated_at: '2026-07-29T18:22:58.000Z',
        custom_price: 300,
        storage_conditions: [
          { temperature: '', duration_value: undefined, duration_unit: '' },
          { temperature: '  ', duration_value: '', duration_unit: '' },
        ],
      }),
    ).toEqual({
      custom_price: 300,
      storage_conditions: [],
    });
  });

  it('normalizes complete storage conditions', () => {
    expect(
      normalizeStorageConditionsForSave([
        { temperature: ' 4±2 °C ', duration_value: '72', duration_unit: 'hours' },
        { temperature: '', duration_value: undefined, duration_unit: '' },
      ]),
    ).toEqual([
      {
        temperature: '4±2 °C',
        duration_value: 72,
        duration_unit: 'hours',
      },
    ]);
  });

  it('keeps explicit nulls so cleared optional facts are removed on the server', () => {
    expect(
      sanitizeProductOverridePatch({
        weight_grams: null,
        calories_kcal: null,
        protein_grams: null,
      }),
    ).toEqual({
      weight_grams: null,
      calories_kcal: null,
      protein_grams: null,
    });
  });

  it('keeps partially completed optional storage rows unpublished', () => {
    expect(
      normalizeStorageConditionsForSave([
        { temperature: '-18 °C', duration_value: undefined, duration_unit: 'days' },
        { temperature: '', duration_value: 72, duration_unit: 'hours' },
      ]),
    ).toEqual([]);
  });
});

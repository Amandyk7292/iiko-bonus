import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  normalizeStorageConditionsForSave,
  ProductFactsFields,
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

  it('keeps native product fact checkboxes and shows a separate selected marker', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      createElement(ProductFactsFields, {
        value: { allergens: ['milk'] },
        onChange,
        idPrefix: 'test-product',
      }),
    );

    const milk = screen.getByRole('checkbox', { name: 'Молоко' });
    const milkChoice = milk.closest('label');
    expect(milk).toBeChecked();
    expect(milkChoice).toHaveClass('is-selected');
    expect(milkChoice?.querySelector('.product-fact-check svg')).toBeInTheDocument();

    const gluten = screen.getByRole('checkbox', { name: 'Глютен' });
    expect(gluten).not.toBeChecked();
    expect(
      gluten.closest('label')?.querySelector('.product-fact-check svg'),
    ).not.toBeInTheDocument();
    await user.click(gluten);
    expect(onChange).toHaveBeenCalledWith('allergens', ['milk', 'gluten']);
  });
});

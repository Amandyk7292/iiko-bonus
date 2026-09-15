import { describe, expect, it } from 'vitest';
import { sortMenuProductsByCompleteness } from './menu-completeness';

describe('admin menu completeness order', () => {
  it('puts incomplete products first, then sorts both groups alphabetically', () => {
    const products = [
      {
        id: '3',
        name: 'Ватрушка',
        descriptionRu: 'Состав',
        descriptionKk: 'Құрамы',
        nameKk: 'Ірімшік',
      },
      { id: '2', name: 'Багет', descriptionRu: 'Состав', descriptionKk: '', nameKk: 'Багет' },
      { id: '1', name: 'Американо', descriptionRu: 'Состав', descriptionKk: 'Құрамы', nameKk: '' },
    ];
    expect(sortMenuProductsByCompleteness(products, {}).map((product) => product.name)).toEqual([
      'Американо',
      'Багет',
      'Ватрушка',
    ]);
  });
});

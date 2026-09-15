import { describe, expect, it } from 'vitest';
import { hasIncompleteProductText } from './IncompleteDescription';

describe('product text completeness', () => {
  it('marks a product incomplete when its Kazakh name is absent despite both descriptions', () => {
    expect(
      hasIncompleteProductText({
        russianName: 'Хлеб',
        kazakhName: '',
        descriptions: ['Состав: мука'],
        kazakh: 'Құрамы: ұн',
      }),
    ).toBe(true);
  });

  it('treats completed Russian and Kazakh text as complete', () => {
    expect(
      hasIncompleteProductText({
        russianName: 'Хлеб',
        kazakhName: 'Нан',
        descriptions: ['Состав: мука'],
        kazakh: 'Құрамы: ұн',
      }),
    ).toBe(false);
  });
});

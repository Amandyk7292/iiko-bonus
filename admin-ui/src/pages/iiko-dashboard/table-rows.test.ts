import { expect, it, vi } from 'vitest';
import { tableRows } from './table-rows';

const originalRows = [
  { item: 'Плюшка 10', quantity: 10, hidden: 'hidden' },
  { item: 'Плюшка 2', quantity: 2, hidden: 'hidden' },
  { item: 'Самса', quantity: 0, hidden: 'hidden' },
  { item: null, quantity: -1, hidden: 'hidden' },
];
it('keeps case insensitive, column scoped matching including numeric values and nulls', () => {
  expect(
    tableRows(originalRows, ['item', 'quantity'], 'пЛЮшКа', { field: '', direction: -1 }),
  ).toEqual(originalRows.slice(0, 2));
  expect(tableRows(originalRows, ['item'], 'hidden', { field: '', direction: -1 })).toEqual([]);
  expect(tableRows(originalRows, ['item', 'quantity'], '-1', { field: '', direction: -1 })).toEqual(
    [originalRows[3]],
  );
});
it('preserves numeric sorting, natural text ordering and the source array', () => {
  const before = [...originalRows];
  expect(tableRows(originalRows, ['item'], 'Плюшка', { field: 'item', direction: 1 })).toEqual([
    originalRows[1],
    originalRows[0],
  ]);
  expect(
    tableRows(originalRows, ['quantity'], '', { field: 'quantity', direction: -1 }).map(
      (row) => row.quantity,
    ),
  ).toEqual([10, 2, 0, -1]);
  expect(originalRows).toEqual(before);
  expect(tableRows(originalRows, ['item'], '', { field: '', direction: 1 })).toBe(originalRows);
  expect(tableRows(originalRows, [], '', { field: '', direction: 1 })).toEqual([]);
});
it('a large natural sort creates one collator and matches the previous comparator', () => {
  const rows = Array.from({ length: 2000 }, (_, index) => ({
    item: `Товар ${(index * 17) % 2000}`,
  }));
  const expected = [...rows].sort((a, b) =>
    a.item.localeCompare(b.item, undefined, { numeric: true }),
  );
  const factory = vi.spyOn(Intl, 'Collator');
  try {
    expect(tableRows(rows, ['item'], '', { field: 'item', direction: 1 })).toEqual(expected);
    expect(factory).toHaveBeenCalledTimes(1);
  } finally {
    factory.mockRestore();
  }
});

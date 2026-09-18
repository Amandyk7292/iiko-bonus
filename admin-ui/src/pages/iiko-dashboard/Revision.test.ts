import { describe, expect, it } from 'vitest';
import { revisionRows, revisionTotals } from './Revision';

const row = (key: string, name: string, expected: number) => ({
  key,
  name,
  unit: 'шт',
  opening: 10,
  incoming: 2,
  sold: 3,
  writtenOff: 1,
  expected,
  systemBalance: expected,
});

describe('revision calculations', () => {
  it('separates shortage and surplus and totals only visible rows', () => {
    const rows = revisionRows(
      [row('a', 'Синнабон', 8), row('b', 'Кофе', 4), row('c', 'Чай', 2)],
      { a: '6', b: '5', c: '2' },
      '',
      true,
    );
    expect(rows.map(({ key, shortage, surplus }) => ({ key, shortage, surplus }))).toEqual([
      { key: 'a', shortage: 2, surplus: 0 },
      { key: 'b', shortage: 0, surplus: 1 },
    ]);
    expect(revisionTotals(rows)).toEqual({ shortage: 2, surplus: 1 });
  });

  it('keeps an empty or malformed physical count unclassified', () => {
    const rows = revisionRows([row('a', 'Кофе', 8)], { a: 'не число' }, 'КОФ', false);
    expect(rows[0]).toMatchObject({ actual: Number.NaN, shortage: null, surplus: null });
  });
});

import { describe, expect, it } from 'vitest';
import { comparisonRange, datedRows, valueFor, validRange } from './model';
import { parsePreferences } from './Settings';

describe('report calculations and settings', () => {
  it('uses total revenue / unique checks and distinguishes absent data', () => {
    expect(valueFor({ DishDiscountSumInt: 1000, UniqOrderId: 4 }, 'average')).toBe(250);
    expect(valueFor({ DishDiscountSumInt: 1000, UniqOrderId: 0 }, 'average')).toBeNull();
    expect(valueFor({}, 'DishDiscountSumInt')).toBeNull();
    expect(valueFor({ DishDiscountSumInt: 0 }, 'DishDiscountSumInt')).toBe(0);
  });
  it('compares equal periods and clamps leap-day year comparison', () => {
    expect(comparisonRange('2026-09-01', '2026-09-07', 'previous')).toEqual({
      from: '2026-08-25',
      to: '2026-08-31',
    });
    expect(comparisonRange('2024-02-29', '2024-02-29', 'year')).toEqual({
      from: '2023-02-28',
      to: '2023-02-28',
    });
    expect(validRange('2026-09-07', '2026-09-01')).toBe(false);
  });
  it('missing sales dates do not shift chart values to the wrong day', () => {
    const rows = datedRows({
      serverId: 'aktau-chain',
      fetchedAt: '',
      columns: {},
      period: { from: '2026-09-01', to: '2026-09-03' },
      rows: [{ 'OpenDate.Typed': '2026-09-03', amount: 42 }],
    });
    expect(rows).toEqual([
      { 'OpenDate.Typed': '2026-09-01' },
      { 'OpenDate.Typed': '2026-09-02' },
      { 'OpenDate.Typed': '2026-09-03', amount: 42 },
    ]);
  });
  it('rejects malformed imported settings instead of breaking the next render', () => {
    expect(() => parsePreferences('{"cards":["unknown"],"templates":[],"auto":true}')).toThrow();
    expect(() => parsePreferences('{"cards":["revenue"],"templates":[{}],"auto":true}')).toThrow();
    expect(
      parsePreferences('{"cards":["revenue"],"templates":[],"auto":true,"password":"never-keep"}'),
    ).toEqual({ cards: ['revenue'], templates: [], auto: true });
  });
});

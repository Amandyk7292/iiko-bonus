import { expect, it } from 'vitest';
import { dishSalesDetails, dishSalesQuery, type DishSalesScope } from './top-dish-details';
import { salesFilters } from './model';

const scope: DishSalesScope = {
  serverId: 'aktau-chain',
  from: '2026-09-01',
  to: '2026-09-04',
  department: '',
  productId: 'a',
  unit: 'шт',
};
const row = (
  date: string,
  department: string,
  quantity: unknown,
  revenue: unknown,
  unit = 'шт',
) => ({
  'OpenDate.Typed': date,
  Department: department,
  DishMeasureUnit: unit,
  DishAmountInt: quantity,
  DishDiscountSumInt: revenue,
});
const rows = [
  row('2026-09-01T00:00:00', 'Основной цех', 3.5, 7000),
  row('2026-09-01', 'Основной цех', 2.5, 5000),
  row('2026-09-02', 'Основной цех', -0.25, -500),
  row('2026-09-01', 'Bulka 16', '1', '2000'),
  row('2026-09-04', 'Bulka 16', 4, 8000),
  row('2026-09-01', 'Основной цех', 999, 999000, 'кг'),
  row('2026-08-31', 'Основной цех', 999, 999000),
  row('2026-09-05', 'Основной цех', 999, 999000),
  row('2026-09-01unexpected', 'Основной цех', 999, 999000),
];

it('requests the same product and exact point with shared SALES filters, inclusive dates and unit grouping', () => {
  expect(dishSalesQuery({ ...scope, department: 'Основной цех' })).toEqual({
    serverId: 'aktau-chain',
    reportType: 'SALES',
    from: scope.from,
    to: scope.to,
    groupBy: ['OpenDate.Typed', 'Department', 'DishMeasureUnit'],
    aggregate: ['DishAmountInt', 'DishDiscountSumInt'],
    filters: [
      ...salesFilters,
      { field: 'DishId', values: ['a'], exclude: false },
      { field: 'Department', values: ['Основной цех'], exclude: false },
    ],
  });
  expect(dishSalesQuery(scope).filters).toHaveLength(3);
});

it('merges day/point splits, preserves signed fractional quantities and isolates units, with every day zero filled', () => {
  const snapshot = structuredClone(rows);
  const result = dishSalesDetails(rows, scope);
  expect(result).toMatchObject({ quantity: 10.75, revenue: 21500 });
  expect(result.points.map((point) => [point.department, point.quantity, point.revenue])).toEqual([
    ['Основной цех', 5.75, 11500],
    ['Bulka 16', 5, 10000],
  ]);
  expect(result.daily).toEqual([
    { date: '2026-09-01', quantity: 7, revenue: 14000 },
    { date: '2026-09-02', quantity: -0.25, revenue: -500 },
    { date: '2026-09-03', quantity: 0, revenue: 0 },
    { date: '2026-09-04', quantity: 4, revenue: 8000 },
  ]);
  expect(result.points[0].daily[3]).toEqual({ date: '2026-09-04', quantity: 0, revenue: 0 });
  expect(rows).toEqual(snapshot);
});

it('enforces exact selected department and fills absent selected-point days across the year boundary', () => {
  const result = dishSalesDetails(rows, { ...scope, department: 'Bulka 16' });
  expect(result.points).toHaveLength(1);
  expect(result).toMatchObject({ quantity: 5, revenue: 10000 });
  expect(result.daily.map((day) => day.quantity)).toEqual([1, 0, 0, 4]);
  const empty = dishSalesDetails([], {
    ...scope,
    department: 'Нет продаж',
    from: '2026-12-31',
    to: '2027-01-02',
  });
  expect(empty.points[0].daily).toEqual([
    { date: '2026-12-31', quantity: 0, revenue: 0 },
    { date: '2027-01-01', quantity: 0, revenue: 0 },
    { date: '2027-01-02', quantity: 0, revenue: 0 },
  ]);
});

it('distinguishes missing metrics from days without sales, propagating unknown amounts into totals', () => {
  const result = dishSalesDetails(
    [
      row('2026-09-01', 'Known quantity', 3, 500),
      row('2026-09-01', 'Known quantity', 1, null),
      row('2026-09-02', 'Unknown quantity', null, 200),
    ],
    scope,
  );
  expect(result).toMatchObject({ quantity: null, revenue: null });
  expect(result.points.map((point) => [point.department, point.quantity, point.revenue])).toEqual([
    ['Known quantity', 4, null],
    ['Unknown quantity', null, 200],
  ]);
  expect(result.daily[0]).toEqual({ date: '2026-09-01', quantity: 4, revenue: null });
  expect(result.daily[1]).toEqual({ date: '2026-09-02', quantity: null, revenue: 200 });
  expect(result.daily[2]).toEqual({ date: '2026-09-03', quantity: 0, revenue: 0 });
});

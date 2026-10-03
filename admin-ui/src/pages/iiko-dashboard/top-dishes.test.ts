import { expect, it } from 'vitest';
import { topDishes } from './top-dishes';

it('merges name/group splits by ID and unit, keeps signed fractions and separates distinct IDs', () => {
  const rows = [
    {
      DishId: 'a',
      DishName: 'Коже',
      DishGroup: 'Супы',
      DishMeasureUnit: 'шт',
      DishAmountInt: 10.75,
      DishDiscountSumInt: 5400,
    },
    {
      DishId: 'a',
      DishName: 'Көже',
      DishGroup: 'Новое меню',
      DishMeasureUnit: 'шт',
      DishAmountInt: -2.25,
      DishDiscountSumInt: -1000,
    },
    {
      DishId: 'a',
      DishName: 'Коже',
      DishMeasureUnit: 'кг',
      DishAmountInt: '2.125',
      DishDiscountSumInt: '2500.50',
    },
    {
      DishId: 'b',
      DishName: 'Коже',
      DishMeasureUnit: 'шт',
      DishAmountInt: 7,
      DishDiscountSumInt: 6000,
    },
    {
      DishId: 'c',
      DishName: 'Больше выручки',
      DishMeasureUnit: 'шт',
      DishAmountInt: 1,
      DishDiscountSumInt: 50000,
    },
  ];
  const snapshot = structuredClone(rows);
  expect(topDishes(rows)).toMatchObject([
    { name: 'Коже', unit: 'шт', quantity: 8.5, revenue: 4400 },
    { name: 'Коже', unit: 'шт', quantity: 7, revenue: 6000 },
    { name: 'Коже', unit: 'кг', quantity: 2.125, revenue: 2500.5 },
    { name: 'Больше выручки', quantity: 1 },
  ]);
  expect(rows).toEqual(snapshot);
});

it('filters only after aggregation and returns at most ten positive quantities descending', () => {
  const rows = [
    { DishId: 'returned', DishAmountInt: 200 },
    { DishId: 'returned', DishAmountInt: -200 },
    { DishId: 'negative', DishAmountInt: -5 },
    { DishId: 'missing', DishAmountInt: null },
    { DishId: 'invalid', DishAmountInt: 'not a number' },
    { DishId: 'infinite', DishAmountInt: Infinity },
    ...Array.from({ length: 15 }, (_, index) => ({
      DishId: String(index),
      DishName: `Product ${index}`,
      DishAmountInt: index + 0.5,
    })),
  ];
  const top = topDishes(rows);
  expect(top).toHaveLength(10);
  expect(top.map((row) => row.quantity)).toEqual([
    14.5, 13.5, 12.5, 11.5, 10.5, 9.5, 8.5, 7.5, 6.5, 5.5,
  ]);
  expect(top.every((row) => row.revenue === null)).toBe(true);
});

it('keeps missing-ID rows separate instead of merging unrelated products with matching names', () => {
  const rows = topDishes([
    { DishName: 'Same name', DishMeasureUnit: 'шт', DishAmountInt: 2 },
    { DishName: 'Same name', DishMeasureUnit: 'шт', DishAmountInt: 3 },
    { DishId: 'a', DishName: 'Same name', DishMeasureUnit: 'шт', DishAmountInt: 4 },
  ]);
  expect(rows.map((row) => row.quantity)).toEqual([4, 3, 2]);
  expect(new Set(rows.map((row) => row.key)).size).toBe(3);
});

it('keeps incomplete revenue unknown when any contributing quantity row lacks its revenue', () => {
  const rows = topDishes([
    { DishId: 'first-known', DishAmountInt: 3, DishDiscountSumInt: 1500 },
    { DishId: 'first-known', DishAmountInt: -1, DishDiscountSumInt: null },
    { DishId: 'first-missing', DishAmountInt: 2 },
    { DishId: 'first-missing', DishAmountInt: 1, DishDiscountSumInt: 500 },
  ]);
  expect(rows.map((row) => row.quantity)).toEqual([3, 2]);
  expect(rows.every((row) => row.revenue === null)).toBe(true);
});

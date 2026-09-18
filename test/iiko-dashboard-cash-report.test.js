const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCashReport } = require('../src/services/iiko-dashboard-cash-report');
const { cashReport } = require('../src/services/iiko-dashboard-cash-report');

test('cash report finds a product and keeps the complete check composition', () => {
  const common = {
    SessionNum: 14,
    Department: 'Актау 1',
    'UniqOrderId.Id': 'order-1',
    OrderNum: 125,
    'OpenDate.Typed': '2026-09-18',
    CloseTime: '12:30',
    Cashier: 'Алия',
  };
  const report = buildCashReport(
    {
      fetchedAt: 'now',
      rows: [
        {
          ...common,
          DishId: 'a',
          DishName: 'Синнабон',
          DishMeasureUnit: 'шт',
          DishAmountInt: 2,
          DishDiscountSumInt: 1800,
        },
        {
          ...common,
          DishId: 'b',
          DishName: 'Кофе',
          DishMeasureUnit: 'шт',
          DishAmountInt: 1,
          DishDiscountSumInt: 900,
        },
      ],
    },
    { shift: '14', search: 'синнабон' },
  );
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0].items.length, 2);
  assert.equal(report.checks[0].total, 2700);
  assert.equal(report.summary.quantity, 2);
  assert.equal(report.summary.revenue, 1800);
});

test('cash report sends a numeric shift filter to iiko', async () => {
  const queries = [];
  const service = {
    report: async (query) => {
      queries.push(query);
      if (queries.length === 1)
        return { fetchedAt: 'now', rows: [{ SessionNum: 106, UniqOrderId: 4 }] };
      return { fetchedAt: 'now', rows: [] };
    },
  };
  await cashReport(service, {
    serverId: 'astana-chain',
    from: '2026-09-18',
    to: '2026-09-18',
    department: 'Branch',
    shift: '106',
    search: 'кофе',
  });
  assert.deepEqual(queries[1].filters.at(-1), { field: 'SessionNum', values: [106] });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  writeoffControl,
  operationsControl,
  assortmentControl,
} = require('../src/services/iiko-dashboard-controls');
const { controls } = require('../src/services/iiko-dashboard-controls.service');
const { controlsQuery, controlsExportQuery } = require('../src/contracts/iiko-dashboard.contract');
const { controlsExport } = require('../src/services/iiko-dashboard-controls-export');
const input = {
  serverId: 'aktau-chain',
  mode: 'writeoffs',
  from: '2026-09-01',
  to: '2026-09-07',
  department: 'A',
  discountThreshold: 30,
  returnThreshold: 50000,
};
const report = (rows) => ({
  rows,
  columns: {},
  period: { from: input.from, to: input.to },
  serverId: input.serverId,
  fetchedAt: '2026-09-08T00:00:00Z',
});
test('write-off share uses matching revenue and frequency deduplicates documents; reversals retained', () => {
  const row = {
    Department: 'A',
    Store: 'S',
    Document: 'D',
    'DateTime.DateTyped': '2026-09-01',
    'Product.Id': 'P',
    'Product.Name': 'Bread',
    'Product.MeasureUnit': 'pcs',
    WriteoffQuantity: 3,
    WriteoffCost: 60,
  };
  const result = writeoffControl(
    input,
    report([
      row,
      {
        ...row,
        'Product.Id': 'Q',
        'Product.MeasureUnit': 'kg',
        WriteoffQuantity: 0.5,
        WriteoffCost: 40,
      },
      { ...row, Document: 'Correction', WriteoffQuantity: -1, WriteoffCost: -20 },
    ]),
    report([{ Department: 'A', 'OpenDate.Typed': '2026-09-01', DishDiscountSumInt: 1000 }]),
    report([{ WriteoffCost: 40 }]),
  );
  assert.equal(result.summary.cost, 80);
  assert.equal(result.summary.share, 8);
  assert.equal(result.summary.change, 100);
  assert.equal(result.tables.branches.rows[0].DocumentCount, 1);
  assert(!result.tables.branches.columns.WriteoffQuantity);
  assert.equal(
    result.tables.products.rows.find((r) => r['Product.Id'] === 'P').WriteoffQuantity,
    2,
  );
  assert.equal(result.tables.trend.rows.length, 7);
  assert.equal(result.tables.trend.rows[1].WriteoffShare, null);
  assert.equal(result.tables.reasons.rows[0].Reason, '');
});
test('check identity, totals and authorizers survive split rows; return flags are explicit', () => {
  const row = {
    Department: 'A',
    'UniqOrderId.Id': 'one',
    OrderNum: 1,
    'OpenDate.Typed': '2026-09-01',
    'Cashier.Id': 'C',
    Cashier: 'Cashier',
    AuthUser: 'Manager',
    DishSumInt: 100,
    DiscountSum: 40,
    DishReturnSum: 0,
  };
  const returned = Array.from({ length: 3 }, (_, index) => ({
    ...row,
    'UniqOrderId.Id': `return${index}`,
    DishReturnSum: index === 0 ? 60000 : 100,
    DiscountSum: 0,
  }));
  const result = operationsControl(
    input,
    report([row, { ...row, DishSumInt: 200, DiscountSum: 80, AuthUser: 'Other' }]),
    report(returned),
  );
  assert.equal(result.summary.discountChecks, 1);
  assert.equal(result.summary.discount, 120);
  assert.equal(result.summary.returnChecks, 3);
  assert.equal(result.tables.discounts.rows[0].DiscountRate, 40);
  assert.match(result.tables.discounts.rows[0].AuthUser, /Other/);
  assert.equal(result.tables.returns.rows[0].Flags, 'large_return|repeat_returns');
  assert.equal(result.tables.returns.rows[1].Flags, 'repeat_returns');
  const exportData = controlsExport(result.tables.discounts, { flaggedOnly: true });
  assert.equal(exportData.rows[0].Flags, 'Высокая скидка');
});
test('assortment uses exact product/unit/branch joins and observed daily demand, never sums incompatible units', () => {
  const sold = {
    Department: 'A',
    DishId: 'P',
    DishName: 'Bread',
    DishMeasureUnit: 'pcs',
    DishAmountInt: 70,
  };
  const waste = {
    Department: 'A',
    'Product.Id': 'P',
    'Product.MeasureUnit': 'pcs',
    WriteoffQuantity: 35,
    WriteoffCost: 50,
  };
  const result = assortmentControl(
    input,
    report([sold]),
    report([
      { ...sold, DishAmountInt: 35 },
      { ...sold, DishId: 'Q', DishName: 'Other', DishAmountInt: 14 },
    ]),
    report([waste, { ...waste, 'Product.MeasureUnit': 'kg', WriteoffQuantity: 100 }]),
  );
  const row = result.tables.assortment.rows.find((r) => r['Product.Name'] === 'Bread');
  assert.equal(row.Daily, 10);
  assert.equal(row.Growth, 100);
  assert.equal(row.WriteoffQuantity, 35);
  assert.equal(row.Advice, 'reduce_batch');
  assert.equal(row.SuggestedDaily, 10);
  assert.equal(result.summary.unmatchedWriteoffProducts, 1);
  assert.equal(
    result.tables.assortment.rows.find((r) => r['Product.Name'] === 'Other').Advice,
    'review_no_sales',
  );
  const short = assortmentControl(
    { ...input, to: '2026-09-02' },
    report([sold]),
    report([]),
    report([]),
  );
  assert.equal(short.tables.assortment.rows[0].Advice, 'short_period');
});
test('controls query binds return flag, scope and preceding equal-length period', async () => {
  const queries = [];
  const service = {
    report: async (q) => {
      queries.push(q);
      return report([]);
    },
    analytics: async (q) => {
      queries.push(q);
      return report([]);
    },
  };
  await controls(service, { ...input, mode: 'operations' });
  assert(
    queries.every((q) => q.filters.some((f) => f.field === 'Department' && f.values[0] === 'A')),
  );
  assert(
    queries.some((q) => q.filters.some((f) => f.field === 'Storned' && f.values[0] === 'TRUE')),
  );
  queries.length = 0;
  await controls(service, { ...input, mode: 'assortment' });
  assert(queries.some((q) => q.from === '2026-08-25' && q.to === '2026-08-31'));
});
test('control contracts reject arbitrary modes, parameters, scopes and invalid thresholds', () => {
  assert(controlsQuery.safeParse(input).success);
  for (const patch of [
    { serverId: 'private' },
    { mode: 'other' },
    { from: '2026-02-30' },
    { to: '2028-09-07' },
    { discountThreshold: 0 },
    { returnThreshold: -1 },
    { unexpected: true },
  ])
    assert(!controlsQuery.safeParse({ ...input, ...patch }).success);
  assert(!controlsExportQuery.safeParse({ query: input, table: 'private' }).success);
});

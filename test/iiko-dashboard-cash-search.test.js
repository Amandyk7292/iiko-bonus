const test = require('node:test');
const assert = require('node:assert/strict');
const { cashSearchAmount } = require('../src/services/iiko-dashboard-cash-search');
const { buildCashReport } = require('../src/services/iiko-dashboard-cash-report');

test('receipt amount accepts dot, comma, grouped spaces and currency suffixes as exact cents', () => {
  for (const value of [
    '3007.50',
    '3007,5',
    '3 007,50',
    '3\u00a0007,5',
    '3\u202f007.50',
    ' 3 007,50 ₸ ',
    '3007.5 тг',
    '3007,50 kzt',
  ]) {
    assert.equal(cashSearchAmount(value), 300750, value);
  }
  assert.equal(cashSearchAmount('180'), 18000);
  assert.equal(cashSearchAmount('0'), 0);
  assert.equal(cashSearchAmount('0,00 ₸'), 0);
  assert.equal(cashSearchAmount('1 234 567.89'), 123456789);
});

test('malformed numbers, ambiguous separators and ordinary product names do not become amounts', () => {
  for (const value of [
    '',
    ' ',
    null,
    'Кофе',
    '7up',
    '3007,5 Булочка',
    '3 07,50',
    '30 07',
    '3  007',
    '3\n007',
    '3,007.50',
    '3007,500',
    '180.',
    '.50',
    '180 руб',
    '₸ 180',
    '1e3',
    '-180',
    'Infinity',
    '9007199254740991',
  ]) {
    assert.equal(cashSearchAmount(value), null, String(value));
  }
});

const item = (receipt, amount, extra = {}) => ({
  SessionID: 'one',
  'UniqOrderId.Id': receipt,
  OrderNum: receipt,
  Cashier: 'Алия',
  DishId: 'bun',
  DishName: 'Булочка',
  DishAmountInt: 1,
  DishDiscountSumInt: amount,
  ...extra,
});

test('amount search matches the complete receipt total, not a single item, and totals all companion items', () => {
  const source = {
    fetchedAt: 'now',
    rows: [
      item('match', 2000, { DishAmountInt: 2 }),
      item('match', 1007.5, { DishId: 'coffee', DishName: 'Кофе' }),
      item('item-only', 3007.5),
      item('item-only', 500, { DishId: 'coffee', DishName: 'Кофе' }),
      item('other-cent', 3007.49),
      item('other-shift', 3007.5, { SessionID: 'two' }),
    ],
  };
  for (const search of ['3007.50', '3 007,5', '3\u00a0007.50 ₸']) {
    const result = buildCashReport(source, { shift: 'one', search });
    assert.deepEqual(result.checks.map((check) => check.id), ['match']);
    assert.equal(result.checks[0].total, 3007.5);
    assert.equal(result.checks[0].cashier, 'Алия');
    assert.deepEqual(result.checks[0].items.map((row) => row.name), ['Булочка', 'Кофе']);
    assert.deepEqual(result.summary, { checks: 1, quantity: 3, revenue: 3007.5 });
    assert.equal(result.fetchedAt, 'now');
  }
  assert.deepEqual(buildCashReport(source, { shift: 'one', search: '2000' }).summary, {
    checks: 0,
    quantity: 0,
    revenue: 0,
  });
});

test('zero and floating-point totals match at two decimal places without matching neighbouring cents', () => {
  const source = {
    rows: [
      item('zero', 0, { DishAmountInt: 2 }),
      item('fraction', 0.1),
      item('fraction', 0.2),
      item('round-up', 1.005),
      item('round-down', 1.004),
      item('different', 0.31),
    ],
  };
  const zero = buildCashReport(source, { shift: 'one', search: '0' });
  assert.deepEqual(zero.checks.map((check) => check.id), ['zero']);
  assert.deepEqual(zero.summary, { checks: 1, quantity: 2, revenue: 0 });
  assert.deepEqual(
    buildCashReport(source, { shift: 'one', search: '0,30' }).checks.map((check) => check.id),
    ['fraction'],
  );
  assert.deepEqual(
    buildCashReport(source, { shift: 'one', search: '1.01' }).checks.map((check) => check.id),
    ['round-up'],
  );
  assert.deepEqual(
    buildCashReport(source, { shift: 'one', search: '1.00' }).checks.map((check) => check.id),
    ['round-down'],
  );
});

test('explicit product ID wins over numeric text while product names and blank search retain their semantics', () => {
  const source = {
    rows: [
      item('numeric-name', 90, { DishId: 'numeric', DishName: '180' }),
      item('numeric-name', 500, { DishId: 'coffee', DishName: 'Кофе' }),
      item('amount', 180),
      item('malformed-name', 700, { DishName: '3007,5 Булочка' }),
    ],
  };
  const product = buildCashReport(source, { shift: 'one', search: '180', productId: 'numeric' });
  assert.deepEqual(product.checks.map((check) => check.id), ['numeric-name']);
  assert.equal(product.checks[0].items.length, 2);
  assert.equal(product.checks[0].total, 590);
  assert.deepEqual(product.summary, { checks: 1, quantity: 1, revenue: 90 });
  assert.deepEqual(
    buildCashReport(source, { shift: 'one', search: '180' }).checks.map((check) => check.id),
    ['amount'],
  );
  const coffee = buildCashReport(source, { shift: 'one', search: 'кофе' });
  assert.deepEqual(coffee.summary, { checks: 1, quantity: 1, revenue: 500 });
  assert.equal(coffee.checks[0].items.length, 2);
  assert.deepEqual(
    buildCashReport(source, { shift: 'one', search: '3007,5 Булочка' }).checks.map((check) => check.id),
    ['malformed-name'],
  );
  assert.deepEqual(buildCashReport(source, { shift: 'one', search: '  ' }).summary, {
    checks: 3,
    quantity: 4,
    revenue: 1470,
  });
});

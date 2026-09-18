const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRevision } = require('../src/services/iiko-dashboard-revision');

test('revision combines opening, incoming, sales, writeoffs and closing balance', () => {
  const rows = buildRevision({
    opening: [{ name: 'Синнабон', unit: 'шт', amount: 10 }],
    closing: [{ name: 'Синнабон', unit: 'шт', amount: 7 }],
    invoices: [{ Product: 'Синнабон', Unit: 'шт', Quantity: 5 }],
    sales: [{ DishName: 'Синнабон', DishMeasureUnit: 'шт', DishAmountInt: 6 }],
    writeoffs: [{ 'Product.Name': 'Синнабон', 'Product.MeasureUnit': 'шт', WriteoffQuantity: 2 }],
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(
    {
      opening: rows[0].opening,
      incoming: rows[0].incoming,
      sold: rows[0].sold,
      writtenOff: rows[0].writtenOff,
      expected: rows[0].expected,
      systemBalance: rows[0].systemBalance,
    },
    { opening: 10, incoming: 5, sold: 6, writtenOff: 2, expected: 7, systemBalance: 7 },
  );
});

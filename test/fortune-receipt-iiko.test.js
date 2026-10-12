const test = require('node:test');
const assert = require('node:assert/strict');
// Sanitized capture: all merchant, register and fiscal identities are synthetic.
// Shapes, 750 total, 2.394-second close delay and different counters are preserved.
const actual = require('./fixtures/fortune-webkassa-iiko-sale.json');
const actualTicket = require('./fixtures/fortune-webkassa-oofd-ticket.json');
const { verifiedOofdTicket } = require('../src/services/fortune-receipt-provider');
const { exactIikoSale, verifyFortuneReceipt } = require('../src/services/fortune-receipt.service');
const {
  receiptReportBody,
  loadFortuneReceiptReport,
} = require('../src/services/fortune-receipt-iiko');
const fiscal = verifiedOofdTicket(actualTicket, actual.fiscalQr);
const columns = Object.fromEntries(
  Object.keys(actual.row).map((field) => [
    field,
    { groupingAllowed: true, filteringAllowed: true },
  ]),
);
columns.DishDiscountSumInt.aggregationAllowed = true;
const query = {
  serverId: actual.binding.serverId,
  reportType: 'SALES',
  from: '2026-07-14',
  to: '2026-10-12',
  filters: [
    { field: 'Department.Id', values: [actual.binding.departmentId] },
    { field: 'CashRegisterName', values: [fiscal.registerSerial] },
  ],
  groupBy: Object.keys(actual.row).filter((field) => field !== 'DishDiscountSumInt'),
  aggregate: ['DishDiscountSumInt'],
  closeTimeRange: { from: '2026-10-12T08:18:06.000', to: '2026-10-12T08:18:26.000' },
};

test('sanitized Webkassa OOFD capture preserves real iiko serial, time and counter anomalies', async () => {
  assert.equal(fiscal.providerDocumentNumber, '781234');
  assert.equal(actual.row.FiscalChequeNumber, '12345');
  assert.equal(fiscal.fiscalOrdinal, undefined);
  assert.equal(fiscal.registerSerial, 'SWK00345678');
  assert.equal(actual.row['CashRegisterName.CashRegisterSerialNumber'], '345678');
  assert.equal(
    exactIikoSale({ rows: [actual.row] }, fiscal, actual.binding).saleGuid,
    actual.row['UniqOrderId.Id'],
  );
  let requests = 0;
  const verified = await verifyFortuneReceipt(
    { branchId: actual.branchId, image: Buffer.from('decoded fixture') },
    {
      now: () => Date.parse('2026-10-12T17:00:00Z'),
      decode: async () => actual.fiscalQr,
      lookup: async () => fiscal,
      loadBinding: async () => actual.binding,
      reports: {
        getSchema: async () => ({ columns }),
        report: () => {
          throw new Error('must not read cached report');
        },
        loadReport: () => {
          throw new Error('must use actual-time bounded request');
        },
        client: {
          withSession: async (serverId, work) => {
            assert.equal(serverId, actual.binding.serverId);
            return work(async (endpoint, body) => {
              requests++;
              assert.equal(endpoint, 'v2/reports/olap');
              assert.deepEqual(body.filters['Department.Id'].values, [actual.binding.departmentId]);
              assert.deepEqual(body.filters.CashRegisterName.values, ['SWK00345678']);
              assert.equal(body.filters.CloseTime.from, '2026-10-12T08:18:06.000');
              assert.equal(body.filters.CloseTime.to, '2026-10-12T08:18:26.000');
              assert.equal(body.filters.CloseTime.includeLow, true);
              assert.equal(body.filters.CloseTime.includeHigh, true);
              assert.equal(body.filters['OpenDate.Typed'].from, '2026-07-14T00:00:00.000');
              assert(!body.groupByRowFields.includes('FiscalChequeNumber'));
              return { data: [actual.row], summary: [] };
            });
          },
        },
      },
    },
  );
  assert.equal(requests, 1);
  assert.equal(verified.saleGuid, actual.row['UniqOrderId.Id']);
  assert.equal(verified.registerSerial, fiscal.registerSerial);
  assert.equal(verified.total, 750);
});

test('OOFD SWK identity requires exact register name and exact literal or normalized serial', () => {
  const sale = (changes) => ({ rows: [{ ...actual.row, ...changes }] });
  assert.equal(
    exactIikoSale(
      sale({ 'CashRegisterName.CashRegisterSerialNumber': fiscal.registerSerial }),
      fiscal,
      actual.binding,
    ).saleGuid,
    actual.row['UniqOrderId.Id'],
  );
  for (const changes of [
    { CashRegisterName: 'SWK00345679' },
    { CashRegisterName: 'SWK00345678 forged suffix' },
    { CashRegisterName: '' },
    {
      CashRegisterName: 'SWK00345679',
      'CashRegisterName.CashRegisterSerialNumber': fiscal.registerSerial,
    },
    { 'CashRegisterName.CashRegisterSerialNumber': '345679' },
    { 'CashRegisterName.CashRegisterSerialNumber': '00345678' },
    { 'CashRegisterName.CashRegisterSerialNumber': 'arbitrary' },
    { CloseTime: '2026-10-12T08:18:26.001' },
    { CloseTime: '2026-10-12T08:18:05.999' },
    { 'Department.Id': '11111111-2222-4333-8444-555555555555' },
    { DishDiscountSumInt: 750.01 },
    { Storned: 'TRUE' },
  ])
    assert.throws(() => exactIikoSale(sale(changes), fiscal, actual.binding), {
      code: 'FORTUNE_RECEIPT_NOT_FOUND',
    });
  assert.throws(() => exactIikoSale(sale({}), { ...fiscal, provider: 'wofd' }, actual.binding), {
    code: 'FORTUNE_RECEIPT_NOT_FOUND',
  });
  const other = { ...actual.row, 'UniqOrderId.Id': '99999999-8888-4777-8666-555555555555' };
  assert.throws(() => exactIikoSale({ rows: [actual.row, other] }, fiscal, actual.binding), {
    code: 'FORTUNE_RECEIPT_AMBIGUOUS',
  });
});

test('receipt-only report bounds actual CloseTime and rejects malformed ranges or raw reports', async () => {
  const body = receiptReportBody(query, columns);
  assert.equal(body.filters.CloseTime.filterType, 'DateRange');
  assert.equal(body.filters.CloseTime.includeHigh, true);
  for (const closeTimeRange of [
    undefined,
    { from: 'bad', to: query.closeTimeRange.to },
    { from: query.closeTimeRange.to, to: query.closeTimeRange.from },
    { from: query.closeTimeRange.from, to: '2026-10-12T08:20:00.000' },
  ])
    assert.throws(() => receiptReportBody({ ...query, closeTimeRange }, columns), {
      code: 'FORTUNE_RECEIPT_UNAVAILABLE',
    });
  assert.throws(
    () => receiptReportBody(query, { ...columns, CloseTime: { filteringAllowed: false } }),
    { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
  );
  for (const response of [
    { rows: [actual.row] },
    { data: null },
    { data: Array(25001).fill(actual.row) },
  ])
    await assert.rejects(
      () =>
        loadFortuneReceiptReport({ client: { withSession: async () => response } }, query, columns),
      { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
    );
  await assert.rejects(
    () =>
      loadFortuneReceiptReport(
        {
          report: () => {
            throw new Error('must not use cache');
          },
        },
        query,
        columns,
      ),
    { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
  );
});

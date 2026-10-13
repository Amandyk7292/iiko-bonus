const test = require('node:test');
const assert = require('node:assert/strict');
// Sanitized capture: all merchant, register and fiscal identities are synthetic.
// Shapes, 750 total, 2.394-second close delay and different counters are preserved.
const actual = require('./fixtures/fortune-webkassa-iiko-sale.json');
const actualTicket = require('./fixtures/fortune-webkassa-oofd-ticket.json');
const { parseReceiptQr } = require('../src/services/fortune-receipt-qr');
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
    {
      field: 'CashRegisterName.CashRegisterSerialNumber',
      values: [fiscal.registerSerial, '345678'],
    },
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
              assert.deepEqual(body.filters['CashRegisterName.CashRegisterSerialNumber'].values, [
                'SWK00345678',
                '345678',
              ]);
              assert.equal(body.filters.CashRegisterName, undefined);
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

test('a driver newline in the register name does not hide a verified receipt from iiko', async () => {
  // Sanitized second driver capture: identities are synthetic; the newline,
  // numeric FR serial, 1210 total and 2.513-second POS close delay are retained.
  const qr = parseReceiptQr(
    'http://consumer.oofd.kz?i=1234567891&f=430600000002&s=1210.00&t=20261013T110316',
  );
  const ticket = structuredClone(actualTicket);
  ticket.kkmFnsId = qr.registrationNumber;
  ticket.kkmSerialNumber = 'SWK00345679';
  Object.assign(ticket.ticket, {
    fiscalId: qr.fiscalSign,
    transactionDate: qr.localClosedAt + '.000',
    totalSum: 1210,
    items: [330, 520, 360].map((sum) => ({
      itemType: 1,
      commodity: { quantity: 1, sum, taxes: [] },
    })),
  });
  const source = verifiedOofdTicket(ticket, qr);
  const sale = {
    ...actual.row,
    'UniqOrderId.Id': 'bbbbbbbb-cccc-4ddd-8eee-fffffffffff1',
    CashRegisterName: 'SWK00345679\n',
    'CashRegisterName.CashRegisterSerialNumber': '345679',
    CloseTime: '2026-10-13T11:03:18.513',
    'OpenDate.Typed': '2026-10-01',
    DishDiscountSumInt: 1210,
  };
  let requests = 0;
  const verified = await verifyFortuneReceipt(
    { branchId: actual.branchId, image: Buffer.from('synthetic decoded photo') },
    {
      now: () => Date.parse('2026-10-13T12:00:00Z'),
      decode: async () => qr,
      lookup: async () => source,
      loadBinding: async () => actual.binding,
      reports: {
        getSchema: async () => ({ columns }),
        client: {
          withSession: async (_serverId, work) =>
            work(async (endpoint, body) => {
              requests++;
              assert.equal(endpoint, 'v2/reports/olap');
              assert.deepEqual(body.filters['Department.Id'].values, [actual.binding.departmentId]);
              assert.deepEqual(body.filters['CashRegisterName.CashRegisterSerialNumber'].values, [
                'SWK00345679',
                '345679',
              ]);
              assert.equal(body.filters.CashRegisterName, undefined);
              assert(body.groupByRowFields.includes('CashRegisterName'));
              assert.equal(body.filters.CloseTime.from, '2026-10-13T11:03:01.000');
              assert.equal(body.filters.CloseTime.to, '2026-10-13T11:03:21.000');
              return { data: [sale], summary: [] };
            }),
        },
      },
    },
  );
  assert.equal(requests, 1);
  assert.equal(verified.saleGuid, sale['UniqOrderId.Id']);
  assert.equal(verified.accountingDate, '2026-10-01');
  assert.equal(verified.registerSerial, 'SWK00345679');
  assert.equal(verified.total, 1210);
});

test('OOFD serial filtering is required but display-name filtering is unnecessary', async () => {
  const verify = (schema, loadReport) =>
    verifyFortuneReceipt(
      { branchId: actual.branchId, image: Buffer.from('decoded fixture') },
      {
        now: () => Date.parse('2026-10-12T17:00:00Z'),
        decode: async () => actual.fiscalQr,
        lookup: async () => fiscal,
        loadBinding: async () => actual.binding,
        reports: { getSchema: async () => ({ columns: schema }), loadReport },
      },
    );
  const noNameFilter = {
    ...columns,
    CashRegisterName: { groupingAllowed: true, filteringAllowed: false },
  };
  let loads = 0;
  const result = await verify(noNameFilter, async (query) => {
    loads++;
    assert.deepEqual(query.filters[1], {
      field: 'CashRegisterName.CashRegisterSerialNumber',
      values: ['SWK00345678', '345678'],
    });
    return { rows: [actual.row] };
  });
  assert.equal(result.saleGuid, actual.row['UniqOrderId.Id']);
  assert.equal(loads, 1);
  for (const replacement of [
    { groupingAllowed: true, filteringAllowed: false },
    { groupingAllowed: false, filteringAllowed: true },
    undefined,
  ])
    await assert.rejects(
      () =>
        verify({ ...columns, 'CashRegisterName.CashRegisterSerialNumber': replacement }, () => {
          throw new Error('schema mismatch must never query a broader report');
        }),
      { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
    );
  await assert.rejects(
    () =>
      verify(
        { ...columns, CashRegisterName: { groupingAllowed: false, filteringAllowed: true } },
        () => {
          throw new Error('full register identity must remain required');
        },
      ),
    { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
  );
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
    { CashRegisterName: fiscal.registerSerial + '\n' },
    { CashRegisterName: '\r\n ' + fiscal.registerSerial + '\t ' },
    { 'CashRegisterName.CashRegisterSerialNumber': ' 345678\r\n' },
    { 'CashRegisterName.CashRegisterSerialNumber': '\t' + fiscal.registerSerial + ' ' },
  ])
    assert.equal(
      exactIikoSale(sale(changes), fiscal, actual.binding).saleGuid,
      actual.row['UniqOrderId.Id'],
    );
  for (const changes of [
    { CashRegisterName: 'SWK00345679' },
    { CashRegisterName: 'SWK00345678 forged suffix' },
    { CashRegisterName: 'WebKassa SWK00345678' },
    { CashRegisterName: 'SWK00345678 (Касса 1)' },
    { CashRegisterName: 'SWK0034\n5678' },
    { CashRegisterName: 'SWK 00345678' },
    { CashRegisterName: '' },
    {
      CashRegisterName: 'SWK00345679',
      'CashRegisterName.CashRegisterSerialNumber': fiscal.registerSerial,
    },
    { 'CashRegisterName.CashRegisterSerialNumber': '345679' },
    { 'CashRegisterName.CashRegisterSerialNumber': '345 678' },
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

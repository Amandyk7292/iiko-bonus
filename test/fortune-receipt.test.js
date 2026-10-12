const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReceiptQr } = require('../src/services/fortune-receipt-qr');
const {
  verifyFortuneReceipt,
  revalidateFortuneReceipt,
  exactIikoSale,
  loadReceiptBinding,
} = require('../src/services/fortune-receipt.service');
const branchId = '62fa7ada-3d67-4f85-bb37-5b13f0e1345c';
const binding = { serverId: 'aktau-chain', departmentId: '8bae2e42-50e7-4124-be3c-f837fc165ba7' };
const receipt = {
  ...parseReceiptQr(
    'https://consumer.wofd.kz/?i=527035232&f=090500022375&s=3007.50&t=20261010T191800',
  ),
  registerSerial: 'SWK00534409',
};
const saleGuid = 'dcac8aec-4e85-45f6-a677-0ad7dda5f87c';
const row = (changes = {}) => ({
  'UniqOrderId.Id': saleGuid,
  'Department.Id': binding.departmentId,
  'CashRegisterName.CashRegisterSerialNumber': receipt.registerSerial,
  CloseTime: '2026-10-10T19:18:00.571',
  'OpenDate.Typed': '2026-09-24',
  SessionID: 'df8e1b4c-e45d-4f67-85df-bef48f1292bf',
  OrderDeleted: 'NOT_DELETED',
  DeletedWithWriteoff: 'NOT_DELETED',
  Storned: 'FALSE',
  DishDiscountSumInt: 3007.5,
  ...changes,
});
const schema = () =>
  Object.fromEntries(
    [
      'UniqOrderId.Id',
      'Department.Id',
      'CashRegisterName.CashRegisterSerialNumber',
      'CloseTime',
      'OpenDate.Typed',
      'SessionID',
      'OrderDeleted',
      'DeletedWithWriteoff',
      'Storned',
    ]
      .map((field) => [field, { groupingAllowed: true, filteringAllowed: true }])
      .concat([['DishDiscountSumInt', { aggregationAllowed: true }]]),
  );
const deps = (changes = {}) => ({
  now: () => Date.parse('2026-10-11T12:00:00Z'),
  decode: async () => receipt,
  lookup: async () => receipt,
  loadBinding: async () => binding,
  reports: {
    getSchema: async () => ({ columns: schema() }),
    loadReport: async () => ({ rows: [row()] }),
  },
  ...changes,
});

test('verified fiscal proof yields exact actual sale, independent of stale accounting day', async () => {
  const result = await verifyFortuneReceipt(
    { branchId, image: Buffer.from('photo') },
    deps({
      reports: {
        getSchema: async () => ({ columns: schema() }),
        report: () => {
          throw new Error('cached report must not be used');
        },
        loadReport: async (query) => {
          assert.equal(query.from, '2026-07-13');
          assert.equal(query.to, '2026-10-11');
          assert.deepEqual(query.filters, [
            { field: 'Department.Id', values: [binding.departmentId] },
            {
              field: 'CashRegisterName.CashRegisterSerialNumber',
              values: [receipt.registerSerial],
            },
          ]);
          assert(!query.groupBy.includes('PayTypes'));
          assert(query.groupBy.includes('Storned'));
          assert.deepEqual(query.closeTimeRange, {
            from: '2026-10-10T19:17:45.000',
            to: '2026-10-10T19:18:05.000',
          });
          return { rows: [row()] };
        },
      },
    }),
  );
  assert.equal(result.saleGuid, saleGuid);
  assert.equal(result.accountingDate, '2026-09-24');
  assert.equal(result.total, 3007.5);
  assert.equal(result.branchId, branchId);
  assert.equal(result.receiptIdentity, receipt.receiptIdentity);
  assert.equal(result.verificationMethod, 'provider_correlated');
  assert.deepEqual(
    result.fiscalQr,
    parseReceiptQr(
      'https://consumer.wofd.kz/?i=527035232&f=090500022375&s=3007.50&t=20261010T191800',
    ),
  );
});

test('revalidation queries current OFD and uncached iiko from the stored canonical QR without an image', async () => {
  const verified = await verifyFortuneReceipt({ branchId, image: Buffer.from('photo') }, deps());
  let lookups = 0;
  let loads = 0;
  const current = await revalidateFortuneReceipt(
    { branchId, receipt: verified, maxAgeDays: 7 },
    deps({
      decode: () => {
        throw new Error('revalidation must not decode an image');
      },
      lookup: async (qr) => {
        lookups++;
        assert.deepEqual(qr, verified.fiscalQr);
        return receipt;
      },
      reports: {
        getSchema: async () => ({ columns: schema() }),
        report: () => {
          throw new Error('must not read stale report cache');
        },
        loadReport: async () => {
          loads++;
          return { rows: [row()] };
        },
      },
    }),
  );
  assert.equal(lookups, 1);
  assert.equal(loads, 1);
  assert.deepEqual(current, verified);
});

test('revalidation rejects a sale cancelled after upload and refuses changed current source or sale', async () => {
  const verified = await verifyFortuneReceipt({ branchId, image: Buffer.from('photo') }, deps());
  for (const changes of [
    { Storned: 'TRUE' },
    { OrderDeleted: 'DELETED' },
    { 'UniqOrderId.Id': 'd54c26ad-6ee8-457b-8a59-40a9f1357e0a' },
  ]) {
    await assert.rejects(
      () =>
        revalidateFortuneReceipt(
          { branchId, receipt: verified },
          deps({
            reports: {
              getSchema: async () => ({ columns: schema() }),
              loadReport: async () => ({ rows: [row(changes)] }),
            },
          }),
        ),
      { code: 'FORTUNE_RECEIPT_NOT_FOUND' },
    );
  }
  await assert.rejects(
    () =>
      revalidateFortuneReceipt(
        { branchId, receipt: verified },
        deps({
          loadBinding: async () => ({ ...binding, serverId: 'astana-chain' }),
        }),
      ),
    { code: 'FORTUNE_RECEIPT_NOT_FOUND' },
  );
  await assert.rejects(
    () =>
      revalidateFortuneReceipt(
        { branchId, receipt: verified },
        deps({
          lookup: async () => {
            throw Object.assign(new Error('OFD cancelled'), {
              code: 'FORTUNE_RECEIPT_NOT_FOUND',
            });
          },
        }),
      ),
    { code: 'FORTUNE_RECEIPT_NOT_FOUND' },
  );
});

test('stored fiscal proof must be canonical and internally consistent before any lookup', async () => {
  const verified = await verifyFortuneReceipt({ branchId, image: Buffer.from('photo') }, deps());
  const snapshots = [
    { ...verified, fiscalQr: undefined },
    { ...verified, fiscalQr: { ...verified.fiscalQr, provider: 'attacker.example' } },
    { ...verified, fiscalQr: { ...verified.fiscalQr, totalCents: '300750' } },
    { ...verified, fiscalQr: { ...verified.fiscalQr, totalCents: 300751 } },
    { ...verified, fiscalQr: { ...verified.fiscalQr, url: 'https://attacker.example/' } },
    { ...verified, fiscalQr: { ...verified.fiscalQr, localClosedAt: '2026-10-10T19:18:01' } },
    { ...verified, fiscalQr: { ...verified.fiscalQr, receiptIdentity: '0'.repeat(64) } },
    { ...verified, total: 3008.5 },
    { ...verified, closedAt: '2026-10-10T14:18:01.000Z' },
    { ...verified, fiscalSign: '527035233' },
    { ...verified, registrationNumber: '090500022376' },
    { ...verified, branchId: 'd54c26ad-6ee8-457b-8a59-40a9f1357e0a' },
    { ...verified, saleGuid: 'not-a-sale' },
    { ...verified, registerSerial: 'https://attacker.example' },
  ];
  let lookups = 0;
  for (const snapshot of snapshots)
    await assert.rejects(
      () =>
        revalidateFortuneReceipt(
          { branchId, receipt: snapshot },
          deps({
            lookup: async () => {
              lookups++;
              return receipt;
            },
          }),
        ),
      { code: 'FORTUNE_RECEIPT_INVALID' },
    );
  assert.equal(lookups, 0);
});

test('revalidation cannot extend the receipt age limit', async () => {
  const verified = await verifyFortuneReceipt({ branchId, image: Buffer.from('photo') }, deps());
  await assert.rejects(
    () =>
      revalidateFortuneReceipt(
        { branchId, receipt: verified, maxAgeDays: 1 },
        deps({
          now: () => Date.parse('2026-10-12T12:00:00Z'),
        }),
      ),
    { code: 'FORTUNE_RECEIPT_EXPIRED' },
  );
});

test('wrong branch/register/time/sum, deleted/storno rows and unknown flags are rejected', () => {
  for (const changes of [
    { 'Department.Id': '33e68e1d-a7bd-4ba7-992a-e3e8a960b1f3' },
    { 'CashRegisterName.CashRegisterSerialNumber': 'SWK99999999' },
    { CloseTime: '2026-10-10T19:18:05.001' },
    { DishDiscountSumInt: 3007.49 },
    { OrderDeleted: 'DELETED' },
    { DeletedWithWriteoff: 'DELETED' },
    { Storned: 'TRUE' },
    { Storned: null },
    { SessionID: '' },
  ])
    assert.throws(() => exactIikoSale({ rows: [row(changes)] }, receipt, binding), {
      code: 'FORTUNE_RECEIPT_NOT_FOUND',
    });
});

test('fiscal issue may follow POS close briefly; every candidate in the bounded window must be unique', () => {
  for (const CloseTime of [
    '2026-10-10T19:17:45.000',
    '2026-10-10T19:17:56.571',
    '2026-10-10T19:18:05.000',
  ])
    assert.equal(
      exactIikoSale({ rows: [row({ CloseTime })] }, receipt, binding).saleGuid,
      saleGuid,
    );
  for (const CloseTime of ['2026-10-10T19:17:44.999', '2026-10-10T19:18:05.001'])
    assert.throws(() => exactIikoSale({ rows: [row({ CloseTime })] }, receipt, binding), {
      code: 'FORTUNE_RECEIPT_NOT_FOUND',
    });
  const other = row({
    'UniqOrderId.Id': 'd54c26ad-6ee8-457b-8a59-40a9f1357e0a',
    CloseTime: '2026-10-10T19:17:49',
  });
  assert.throws(() => exactIikoSale({ rows: [row(), other] }, receipt, binding), {
    code: 'FORTUNE_RECEIPT_AMBIGUOUS',
  });
});

test('only explicit zero-value removed items may accompany an otherwise valid paid sale', () => {
  const removed = (changes = {}) =>
    row({ DeletedWithWriteoff: 'DELETED_WITHOUT_WRITEOFF', DishDiscountSumInt: 0, ...changes });
  assert.equal(exactIikoSale({ rows: [row(), removed()] }, receipt, binding).saleGuid, saleGuid);
  for (const changes of [
    { DishDiscountSumInt: 0.01 },
    { DishDiscountSumInt: -0.01 },
    { DishDiscountSumInt: null },
    { DeletedWithWriteoff: 'DELETED_WITH_WRITEOFF' },
    { DeletedWithWriteoff: 'UNKNOWN' },
    { DeletedWithWriteoff: null },
    { OrderDeleted: 'DELETED' },
    { Storned: 'TRUE' },
  ])
    assert.throws(() => exactIikoSale({ rows: [row(), removed(changes)] }, receipt, binding), {
      code: 'FORTUNE_RECEIPT_NOT_FOUND',
    });
  assert.throws(() => exactIikoSale({ rows: [removed()] }, receipt, binding), {
    code: 'FORTUNE_RECEIPT_NOT_FOUND',
  });
  assert.throws(
    () =>
      exactIikoSale(
        { rows: [row(), removed({ CloseTime: '2026-10-10T19:18:01' })] },
        receipt,
        binding,
      ),
    { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
  );
});

test('when fiscal ordinals exist on both sides they must match', () => {
  const numbered = { ...receipt, fiscalOrdinal: '3784' };
  assert.equal(
    exactIikoSale({ rows: [row({ FiscalChequeNumber: '3784' })] }, numbered, binding).saleGuid,
    saleGuid,
  );
  assert.throws(
    () => exactIikoSale({ rows: [row({ FiscalChequeNumber: '3785' })] }, numbered, binding),
    { code: 'FORTUNE_RECEIPT_NOT_FOUND' },
  );
  assert.throws(
    () => exactIikoSale({ rows: [row({ FiscalChequeNumber: 'unknown' })] }, numbered, binding),
    { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
  );
  assert.equal(
    exactIikoSale({ rows: [row({ FiscalChequeNumber: '' })] }, numbered, binding).saleGuid,
    saleGuid,
  );
});

test('branch source loads only actual DB mapping, independent of production enable flags', async () => {
  const db = (data, error) => ({
    from: (table) => {
      assert.equal(table, 'cashier_iiko_production_bindings');
      return {
        select: (columns) => {
          assert.equal(columns, 'server_id,department_id');
          return {
            eq: (field, id) => {
              assert.equal(field, 'branch_id');
              assert.equal(id, branchId);
              return { maybeSingle: async () => ({ data, error }) };
            },
          };
        },
      };
    },
  });
  assert.deepEqual(
    await loadReceiptBinding(branchId, {
      db: db({ server_id: binding.serverId, department_id: binding.departmentId, enabled: false }),
    }),
    binding,
  );
  assert.equal(await loadReceiptBinding(branchId, { db: db(null) }), null);
  await assert.rejects(() => loadReceiptBinding(branchId, { db: db(null, { code: '42P01' }) }), {
    code: 'FORTUNE_RECEIPT_UNAVAILABLE',
  });
});

test('ambiguous same-second receipts cannot consume a prize and untrusted sums fail closed', () => {
  const other = row({ 'UniqOrderId.Id': 'd54c26ad-6ee8-457b-8a59-40a9f1357e0a' });
  assert.throws(() => exactIikoSale({ rows: [row(), other] }, receipt, binding), {
    code: 'FORTUNE_RECEIPT_AMBIGUOUS',
  });
  assert.throws(
    () => exactIikoSale({ rows: [row({ DishDiscountSumInt: null })] }, receipt, binding),
    { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
  );
  assert.throws(
    () =>
      exactIikoSale({ rows: [row(), row({ CloseTime: '2026-10-10T19:19:00' })] }, receipt, binding),
    { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
  );
});

test('age/future, missing source binding and schema capability never fall back to amount/order', async () => {
  const photo = { branchId, image: Buffer.from('photo') };
  await assert.rejects(
    () => verifyFortuneReceipt(photo, deps({ now: () => Date.parse('2026-10-20T12:00:00Z') })),
    { code: 'FORTUNE_RECEIPT_EXPIRED' },
  );
  await assert.rejects(
    () => verifyFortuneReceipt(photo, deps({ now: () => Date.parse('2026-10-09T12:00:00Z') })),
    { code: 'FORTUNE_RECEIPT_EXPIRED' },
  );
  await assert.rejects(() => verifyFortuneReceipt(photo, deps({ loadBinding: async () => null })), {
    code: 'FORTUNE_RECEIPT_UNAVAILABLE',
  });
  const columns = schema();
  delete columns['CashRegisterName.CashRegisterSerialNumber'];
  await assert.rejects(
    () =>
      verifyFortuneReceipt(
        photo,
        deps({
          reports: {
            getSchema: async () => ({ columns }),
            report: () => {
              throw new Error('must not call');
            },
          },
        }),
      ),
    { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
  );
  await assert.rejects(
    () =>
      verifyFortuneReceipt(
        photo,
        deps({ lookup: async () => ({ ...receipt, totalCents: 18000 }) }),
      ),
    { code: 'FORTUNE_RECEIPT_NOT_FOUND' },
  );
});

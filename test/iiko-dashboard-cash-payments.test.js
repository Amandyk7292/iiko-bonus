const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCashPayments,
  cashPayments,
  paymentQuery,
} = require('../src/services/iiko-dashboard-cash-payments');
const { cashReport } = require('../src/services/iiko-dashboard-cash-report');
const { ReportCache } = require('../src/services/iiko-dashboard-cache');

const check = (id, total) => ({ id, shift: 'one', total, items: [{ name: 'Булочка', total }] });
const row = (id, name, group, value, methodId = name) => ({
  SessionID: 'one',
  'UniqOrderId.Id': id,
  PayTypes: name,
  'PayTypes.GUID': methodId,
  'PayTypes.Group': group,
  DishDiscountSumInt: value,
});
const scope = {
  serverId: 'aktau-chain',
  reportType: 'SALES',
  from: '2026-10-10',
  to: '2026-10-10',
  filters: [
    { field: 'OrderDeleted', values: ['NOT_DELETED'] },
    { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
    { field: 'Storned', values: ['FALSE'] },
    { field: 'Department', values: ['18а/1дом'] },
    { field: 'SessionID', values: ['one'] },
  ],
};
const schema = {
  columns: {
    SessionID: { groupingAllowed: true },
    'UniqOrderId.Id': { groupingAllowed: true },
    PayTypes: { groupingAllowed: true },
    'PayTypes.GUID': { groupingAllowed: true },
    'PayTypes.Group': { groupingAllowed: true },
    DishDiscountSumInt: { aggregationAllowed: true },
  },
};
const unavailable = {
  status: 'unavailable',
  methods: [],
  receivedCash: null,
  change: null,
};

test('payment query keeps exact server, date, department and session scope without any item fields', () => {
  const query = paymentQuery(scope, schema);
  assert.deepEqual(query, {
    ...scope,
    groupBy: ['SessionID', 'UniqOrderId.Id', 'PayTypes', 'PayTypes.GUID', 'PayTypes.Group'],
    aggregate: ['DishDiscountSumInt'],
  });
  assert.equal(query.filters, scope.filters);
  for (const field of ['SessionID', 'UniqOrderId.Id', 'PayTypes', 'DishDiscountSumInt']) {
    const incomplete = { columns: { ...schema.columns, [field]: undefined } };
    assert.equal(paymentQuery(scope, incomplete), null);
  }
  assert.equal(paymentQuery(scope, undefined), null);
});

test('optional payment metadata is requested only when supported and name remains usable without it', () => {
  const basic = {
    columns: { ...schema.columns, 'PayTypes.GUID': undefined, 'PayTypes.Group': undefined },
  };
  assert.deepEqual(paymentQuery(scope, basic).groupBy, ['SessionID', 'UniqOrderId.Id', 'PayTypes']);
  const payment = buildCashPayments(
    [check('one', 100)],
    {
      rows: [
        {
          SessionID: 'one',
          'UniqOrderId.Id': 'one',
          PayTypes: 'Наличные',
          DishDiscountSumInt: 100,
        },
      ],
    },
    'one',
  )[0].payment;
  assert.deepEqual(payment.methods, [
    { id: '', name: 'Наличные', group: '', kind: 'other', amount: 100 },
  ]);
  assert.equal(payment.status, 'available');
});

test('cash, card, mixed and other settled methods preserve names without inventing received cash or change', () => {
  const checks = [check('cash', 100), check('card', 200), check('mixed', 300), check('other', 90)];
  const result = buildCashPayments(
    checks,
    {
      rows: [
        row('cash', 'Наличные', 'CASH', 100, 'cash-id'),
        row('card', 'Банковские карты', 'CARD', 200, 'card-id'),
        row('mixed', 'Наличные', 'CASH', 100, 'cash-id'),
        row('mixed', 'Банковские карты', 'CARD', 200, 'card-id'),
        row('other', 'Личный счёт Bulka', 'CREDIT', 90, 'account-id'),
      ],
    },
    'one',
  );
  assert.deepEqual(
    result.map((receipt) => receipt.payment.methods.map((method) => method.kind)),
    [['cash'], ['card'], ['cash', 'card'], ['other']],
  );
  assert.equal(result[3].payment.methods[0].name, 'Личный счёт Bulka');
  for (let index = 0; index < checks.length; index++) {
    const payment = result[index].payment;
    assert.equal(payment.status, 'available');
    assert.equal(
      payment.methods.reduce((sum, method) => sum + method.amount, 0),
      checks[index].total,
    );
    assert.equal(payment.receivedCash, null);
    assert.equal(payment.change, null);
    assert.equal(result[index].items, checks[index].items);
    assert.equal(result[index].total, checks[index].total);
    assert.equal(Object.hasOwn(checks[index], 'payment'), false);
  }
});

test('unknown and writeoff groups retain exact names and never pretend to be cash or a bank card', () => {
  for (const group of ['WRITEOFF', 'CREDIT', 'FUTURE_METHOD', '']) {
    const payment = buildCashPayments(
      [check('other', 10)],
      {
        rows: [row('other', 'Оплата наличными по договору', group, '10.00')],
      },
      'one',
    )[0].payment;
    assert.equal(payment.status, 'available');
    assert.equal(payment.methods[0].kind, 'other');
    assert.equal(payment.methods[0].group, group);
    assert.equal(payment.methods[0].name, 'Оплата наличными по договору');
  }
});

test('duplicate method rows combine their amounts but overcounted totals are never exposed', () => {
  const result = buildCashPayments(
    [check('split', 100), check('duplicate', 100)],
    {
      rows: [
        row('split', 'Наличные', 'CASH', 35, 'same-id'),
        row('split', 'Наличные', 'CASH', 65, 'same-id'),
        row('duplicate', 'Карта', 'CARD', 100, 'same-id'),
        row('duplicate', 'Карта', 'CARD', 100, 'same-id'),
      ],
    },
    'one',
  );
  assert.deepEqual(result[0].payment.methods, [
    { id: 'same-id', name: 'Наличные', group: 'CASH', kind: 'cash', amount: 100 },
  ]);
  assert.deepEqual(result[1].payment, unavailable);
});

test('one method ID cannot silently merge conflicting names or groups and distinct IDs stay distinct', () => {
  const result = buildCashPayments(
    [check('name', 100), check('group', 100), check('ids', 100)],
    {
      rows: [
        row('name', 'Карта', 'CARD', 40, 'a'),
        row('name', 'Другая карта', 'CARD', 60, 'a'),
        row('group', 'Оплата', 'CASH', 40, 'a'),
        row('group', 'Оплата', 'CARD', 60, 'a'),
        row('ids', 'Карта', 'CARD', 40, 'a'),
        row('ids', 'Карта', 'CARD', 60, 'b'),
      ],
    },
    'one',
  );
  assert.deepEqual(result[0].payment, unavailable);
  assert.deepEqual(result[1].payment, unavailable);
  assert.deepEqual(
    result[2].payment.methods.map((method) => method.id),
    ['a', 'b'],
  );
});

test('foreign sessions and receipt IDs cannot affect selected receipt payment amounts', () => {
  const payment = buildCashPayments(
    [check('receipt', 100)],
    {
      rows: [
        row('receipt', 'Наличные', 'CASH', 100, 'cash'),
        { ...row('receipt', 'Карта', 'CARD', 500, 'card'), SessionID: 'foreign' },
        row('unrelated', 'Карта', 'CARD', 800, 'card'),
        row('', 'Карта', 'CARD', 500, 'card'),
      ],
    },
    'one',
  )[0].payment;
  assert.equal(payment.status, 'available');
  assert.deepEqual(
    payment.methods.map((method) => method.amount),
    [100],
  );
});

test('bad, missing and nonfinite payment data hide only affected receipt details', () => {
  const badValues = [
    undefined,
    null,
    '',
    ' ',
    'not a number',
    NaN,
    Infinity,
    -Infinity,
    true,
    {},
    [],
  ];
  const checks = badValues.map((_, index) => check(`bad-${index}`, 100));
  checks.push(
    check('good', 100),
    check('missing', 100),
    check('missing-name', 100),
    check('missing-session', 100),
    check('bad-group', 100),
  );
  const result = buildCashPayments(
    checks,
    {
      rows: [
        ...badValues.map((value, index) => row(`bad-${index}`, 'Наличные', 'CASH', value)),
        row('good', 'Наличные', 'CASH', 100),
        row('missing-name', '', 'CASH', 100),
        { ...row('missing-session', 'Карта', 'CARD', 100), SessionID: '' },
        { ...row('bad-group', 'Карта', 'CARD', 100), 'PayTypes.Group': {} },
      ],
    },
    'one',
  );
  for (const receipt of result) {
    if (receipt.id === 'good') assert.equal(receipt.payment.status, 'available');
    else assert.deepEqual(receipt.payment, unavailable);
    assert.equal(receipt.total, 100);
  }
});

test('rounding tolerance supports zero amounts and cents while rejecting mismatched or invalid check totals', () => {
  const checks = [
    check('zero', 0),
    check('round', 100),
    check('mismatch', 100),
    check('invalid', NaN),
    check('raw-round-mismatch', 100),
  ];
  const result = buildCashPayments(
    checks,
    {
      rows: [
        row('zero', 'Карта', 'CARD', 0),
        row('round', 'Карта', 'CARD', 99.98),
        row('mismatch', 'Карта', 'CARD', 99.97),
        row('invalid', 'Карта', 'CARD', 100),
        row('raw-round-mismatch', 'Карта', 'CARD', 99.979),
      ],
    },
    'one',
  );
  assert.equal(result[0].payment.status, 'available');
  assert.equal(result[0].payment.methods[0].amount, 0);
  assert.equal(result[1].payment.status, 'available');
  assert.deepEqual(result[2].payment, unavailable);
  assert.deepEqual(result[3].payment, unavailable);
  assert.deepEqual(result[4].payment, unavailable);
});

test('live mixed payment example keeps the 2076 tenge receipt total with cash 1000 and card 1076', () => {
  const result = buildCashPayments(
    [check('mixed', 2076)],
    {
      rows: [
        row('mixed', 'Наличные', 'CASH', 1000),
        row('mixed', 'Банковские карты', 'CARD', 1076),
      ],
    },
    'one',
  )[0];
  assert.equal(result.total, 2076);
  assert.equal(result.payment.status, 'available');
  assert.deepEqual(
    result.payment.methods.map((method) => [method.kind, method.amount]),
    [
      ['cash', 1000],
      ['card', 1076],
    ],
  );
});

test('unsupported schema, schema failure, source failure and missing rows preserve the original receipts', async () => {
  const checks = [check('one', 100)];
  const cases = [
    {},
    { getSchema: async () => ({ columns: {} }) },
    {
      getSchema: async () => {
        throw new Error('schema unavailable');
      },
    },
    {
      getSchema: async () => schema,
      report: async () => {
        throw new Error('query unavailable');
      },
    },
    { getSchema: async () => schema, report: async () => ({ rows: null }) },
    { getSchema: async () => schema, report: async () => ({ rows: [] }) },
  ];
  for (const service of cases) {
    const result = await cashPayments(service, scope, checks);
    assert.deepEqual(result[0].payment, unavailable);
    assert.equal(result[0].total, 100);
    assert.equal(result[0].items, checks[0].items);
  }
});

test('separate payment query reuses the full shift cache through searches and never multiplies receipt items or totals', async () => {
  const queries = [];
  const cache = new ReportCache();
  const service = {
    getSchema: async () => schema,
    report: (query) =>
      cache.get(JSON.stringify(query), async () => {
        queries.push(query);
        if (query.groupBy.includes('PayTypes'))
          return {
            rows: [row('receipt', 'Наличные', 'CASH', 80), row('receipt', 'Карта', 'CARD', 20)],
          };
        if (query.groupBy.includes('DishName'))
          return {
            fetchedAt: 'items',
            rows: [
              {
                SessionID: 'one',
                'UniqOrderId.Id': 'receipt',
                DishId: 'bun',
                DishName: 'Булочка',
                DishAmountInt: 1,
                DishDiscountSumInt: 70,
              },
              {
                SessionID: 'one',
                'UniqOrderId.Id': 'receipt',
                DishId: 'coffee',
                DishName: 'Кофе',
                DishAmountInt: 1,
                DishDiscountSumInt: 30,
              },
            ],
          };
        return {
          fetchedAt: 'shifts',
          rows: [
            {
              SessionID: 'one',
              SessionNum: 336,
              'OpenDate.Typed': '2026-10-10',
              UniqOrderId: 1,
              DishDiscountSumInt: 100,
            },
          ],
        };
      }),
  };
  const input = {
    serverId: scope.serverId,
    from: '2026-10-09',
    to: '2026-10-11',
    department: '18а/1дом',
    shift: '336',
    search: '',
  };
  const all = await cashReport(service, input);
  const filtered = await cashReport(service, { ...input, search: 'Кофе', productId: 'coffee' });
  const cleared = await cashReport(service, { ...input, search: '  ' });
  assert.equal(queries.length, 3);
  const paymentQuery = queries.find((query) => query.groupBy.includes('PayTypes'));
  const itemQuery = queries.find((query) => query.groupBy.includes('DishName'));
  assert.equal(paymentQuery.from, '2026-10-10');
  assert.equal(paymentQuery.to, '2026-10-10');
  assert.equal(paymentQuery.serverId, scope.serverId);
  assert.deepEqual(paymentQuery.filters, itemQuery.filters);
  assert.deepEqual(paymentQuery.filters, scope.filters);
  assert.deepEqual(itemQuery.aggregate, ['DishAmountInt', 'DishDiscountSumInt']);
  assert(!itemQuery.groupBy.some((field) => field.startsWith('PayTypes')));
  assert.deepEqual(all.summary, { checks: 1, quantity: 2, revenue: 100 });
  assert.deepEqual(filtered.summary, { checks: 1, quantity: 1, revenue: 30 });
  assert.deepEqual(cleared.summary, all.summary);
  for (const result of [all, filtered, cleared]) {
    assert.equal(result.checks[0].total, 100);
    assert.equal(result.checks[0].items.length, 2);
    assert.equal(result.checks[0].payment.status, 'available');
    assert.deepEqual(
      result.checks[0].payment.methods.map((method) => method.amount),
      [80, 20],
    );
  }
});

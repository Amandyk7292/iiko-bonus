const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCashReport } = require('../src/services/iiko-dashboard-cash-report');
const { cashReport } = require('../src/services/iiko-dashboard-cash-report');
const { buildCashShifts } = require('../src/services/iiko-dashboard-cash-report');
const { buildCashProducts } = require('../src/services/iiko-dashboard-cash-report');
const { cashReportQuery } = require('../src/contracts/iiko-dashboard.contract');
const { ReportCache } = require('../src/services/iiko-dashboard-cache');

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

test('cash report resolves a legacy number to the unique session and limits the receipt period', async () => {
  const queries = [];
  const service = {
    report: async (query) => {
      queries.push(query);
      if (queries.length === 1)
        return {
          fetchedAt: 'now',
          rows: [
            {
              SessionID: 'session-106',
              SessionNum: 106,
              UniqOrderId: 4,
              'OpenDate.Typed': '2026-09-18',
            },
          ],
        };
      return { fetchedAt: 'now', rows: [] };
    },
  };
  await cashReport(service, {
    serverId: 'astana-chain',
    from: '2026-09-12',
    to: '2026-09-19',
    department: 'Branch',
    shift: '106',
    search: 'кофе',
  });
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1].filters.at(-1), { field: 'SessionID', values: ['session-106'] });
  assert.equal(queries[1].from, '2026-09-18');
  assert.equal(queries[1].to, '2026-09-18');
  assert(queries[1].groupBy.includes('DishName'));
  assert(queries[1].groupBy.includes('UniqOrderId.Id'));
});

test('shift options keep repeated numbers separate and sort recent accounting dates first', () => {
  const shifts = buildCashShifts({
    rows: [
      {
        SessionID: 'one',
        SessionNum: 15,
        Department: 'Актау',
        CashRegisterName: 'Касса 1',
        'OpenDate.Typed': '2026-09-17',
        UniqOrderId: 3,
        DishDiscountSumInt: 3000,
      },
      {
        SessionID: 'two',
        SessionNum: 15,
        Department: 'Астана',
        CashRegisterName: 'Касса 2',
        'OpenDate.Typed': '2026-09-19',
        UniqOrderId: 4,
        DishDiscountSumInt: 4000,
      },
      {
        SessionID: 'one',
        SessionNum: 15,
        Department: 'Актау',
        CashRegisterName: 'Касса 1',
        'OpenDate.Typed': '2026-09-18',
        UniqOrderId: 2,
        DishDiscountSumInt: 2000,
      },
    ],
  });
  assert.deepEqual(
    shifts.map((shift) => shift.id),
    ['two', 'one'],
  );
  assert.deepEqual(shifts[1], {
    id: 'one',
    number: '15',
    department: 'Актау',
    register: 'Касса 1',
    dateFrom: '2026-09-17',
    dateTo: '2026-09-18',
    checks: 5,
    revenue: 5000,
  });
});

test('product searches reuse one full shift report and retain more than 500 complete receipts', async () => {
  const queries = [];
  const cache = new ReportCache();
  const service = {
    report: (query) =>
      cache.get(JSON.stringify(query), async () => {
        queries.push(query);
        if (!query.groupBy.includes('DishName'))
          return {
            fetchedAt: 'now',
            rows: [
              {
                SessionID: 'session-106',
                SessionNum: 106,
                'OpenDate.Typed': '2026-09-18',
                UniqOrderId: 501,
              },
            ],
          };
        return {
          fetchedAt: 'now',
          rows: Array.from({ length: 501 }, (_, index) => [
            {
              SessionID: 'session-106',
              SessionNum: 106,
              'UniqOrderId.Id': `order-${index}`,
              DishId: 'coffee',
              DishName: 'Кофе Американо',
              DishAmountInt: 2,
              DishDiscountSumInt: 1980,
            },
            {
              SessionID: 'session-106',
              SessionNum: 106,
              'UniqOrderId.Id': `order-${index}`,
              DishId: 'bun',
              DishName: 'Булочка',
              DishAmountInt: 1,
              DishDiscountSumInt: 500,
            },
          ]).flat(),
        };
      }),
  };
  const input = {
    serverId: 'astana-chain',
    from: '2026-09-12',
    to: '2026-09-19',
    department: 'Branch',
    shift: 'session-106',
    search: 'кофе',
  };
  const first = await cashReport(service, input);
  const suggestions = await cashReport(service, { ...input, search: '' });
  const second = await cashReport(service, { ...input, search: 'булочка' });
  const absent = await cashReport(service, { ...input, search: 'неизвестно' });
  assert.equal(queries.length, 2);
  assert.deepEqual(suggestions.products, [
    { id: 'bun', name: 'Булочка' },
    { id: 'coffee', name: 'Кофе Американо' },
  ]);
  assert.equal(suggestions.checks.length, 0);
  assert.equal(suggestions.summary.checks, 0);
  assert.equal(first.checks.length, 501);
  assert.equal(first.checks[0].items.length, 2);
  assert.equal(first.checks[0].total, 2480);
  assert.equal(first.summary.quantity, 1002);
  assert.equal(first.summary.revenue, 501 * 1980);
  assert.equal(second.summary.quantity, 501);
  assert.equal(second.summary.revenue, 501 * 500);
  assert.equal(absent.checks.length, 0);
  assert(
    queries[1].filters.some(
      (filter) => filter.field === 'Department' && filter.values[0] === 'Branch',
    ),
  );
  assert.equal(queries[1].serverId, 'astana-chain');
});

test('cash product suggestions are unique, sorted and limited to valid receipts of the selected session', () => {
  const row = { SessionID: 'one', 'UniqOrderId.Id': 'receipt' };
  assert.deepEqual(
    buildCashProducts(
      {
        rows: [
          { ...row, DishId: 'coffee', DishName: ' Кофе ' },
          { ...row, DishId: 'bun', DishName: 'Булочка' },
          { ...row, DishId: 'coffee', DishName: 'Кофе' },
          { ...row, DishId: 'other', DishName: 'Другой город', SessionID: 'two' },
          { ...row, DishId: 'no-receipt', DishName: 'Нет чека', 'UniqOrderId.Id': '' },
          { ...row, DishId: 'empty', DishName: '  ' },
        ],
      },
      'one',
    ),
    [
      { id: 'bun', name: 'Булочка' },
      { id: 'coffee', name: 'Кофе' },
    ],
  );
});

test('choosing a product matches its ID, keeps companion items and does not total similar names', () => {
  const common = { SessionID: 'one', DishAmountInt: 1 };
  const source = {
    rows: [
      {
        ...common,
        'UniqOrderId.Id': 'a',
        DishId: 'coffee',
        DishName: 'Кофе',
        DishDiscountSumInt: 990,
      },
      {
        ...common,
        'UniqOrderId.Id': 'a',
        DishId: 'large',
        DishName: 'Кофе большой',
        DishDiscountSumInt: 1200,
      },
      {
        ...common,
        'UniqOrderId.Id': 'b',
        DishId: 'large',
        DishName: 'Кофе большой',
        DishDiscountSumInt: 1200,
      },
    ],
  };
  const exact = buildCashReport(source, { shift: 'one', search: 'Кофе', productId: 'coffee' });
  assert.deepEqual(exact.summary, { checks: 1, quantity: 1, revenue: 990 });
  assert.equal(exact.checks[0].items.length, 2);
  assert.equal(exact.checks[0].total, 2190);
  assert.deepEqual(buildCashReport(source, { shift: 'one', search: 'Кофе' }).summary, {
    checks: 2,
    quantity: 3,
    revenue: 3390,
  });
});

test('cash report contract accepts product selection and preserves free text queries', () => {
  const input = {
    serverId: 'astana-chain',
    from: '2026-09-18',
    to: '2026-09-19',
    shift: 'one',
    search: 'Кофе',
  };
  assert.equal(cashReportQuery.parse(input).productId, '');
  assert.equal(cashReportQuery.parse({ ...input, productId: 'coffee' }).productId, 'coffee');
  assert.equal(cashReportQuery.safeParse({ ...input, productId: 'a'.repeat(81) }).success, false);
});

test('cash report never combines different sessions that have the same number', async () => {
  const queries = [];
  const service = {
    report: async (query) => {
      queries.push(query);
      return {
        fetchedAt: 'now',
        rows: [
          { SessionID: 'till-1', SessionNum: 106, 'OpenDate.Typed': '2026-09-18' },
          { SessionID: 'till-2', SessionNum: 106, 'OpenDate.Typed': '2026-09-18' },
        ],
      };
    },
  };
  const input = {
    serverId: 'aktau-chain',
    from: '2026-09-18',
    to: '2026-09-18',
    shift: '106',
    search: 'кофе',
  };
  assert.equal((await cashReport(service, input)).checks.length, 0);
  assert.equal(queries.length, 1);
  await cashReport(service, { ...input, shift: 'till-2' });
  assert.deepEqual(queries.at(-1).filters.at(-1), { field: 'SessionID', values: ['till-2'] });
});

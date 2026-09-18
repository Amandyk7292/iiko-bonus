const clean = (value) => String(value ?? '').trim();
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function buildCashReport(report, input) {
  const checks = new Map();
  const shifts = new Map();
  for (const row of report.rows) {
    const shift = clean(row.SessionNum) || 'Без номера';
    const orderId = clean(row['UniqOrderId.Id']);
    if (!orderId) continue;
    if (!shifts.has(shift)) shifts.set(shift, { id: shift, checks: new Set(), revenue: 0 });
    const shiftItem = shifts.get(shift);
    shiftItem.checks.add(orderId);
    shiftItem.revenue += number(row.DishDiscountSumInt);
    if (!checks.has(orderId)) {
      checks.set(orderId, {
        id: orderId,
        shift,
        number: row.OrderNum,
        date: row['OpenDate.Typed'],
        time: row.CloseTime,
        department: clean(row.Department),
        cashier: clean(row.Cashier),
        total: 0,
        items: [],
      });
    }
    const check = checks.get(orderId);
    check.total += number(row.DishDiscountSumInt);
    check.items.push({
      id: clean(row.DishId),
      name: clean(row.DishName),
      unit: clean(row.DishMeasureUnit),
      quantity: number(row.DishAmountInt),
      total: number(row.DishDiscountSumInt),
    });
  }
  const query = input.search.toLocaleLowerCase('ru');
  const selected = [...checks.values()].filter(
    (check) =>
      (!input.shift || check.shift === input.shift) &&
      (!query || check.items.some((item) => item.name.toLocaleLowerCase('ru').includes(query))),
  );
  selected.sort((a, b) => String(b.date + b.time).localeCompare(String(a.date + a.time)));
  return {
    shifts: [...shifts.values()].map(({ checks: ids, ...shift }) => ({
      ...shift,
      checks: ids.size,
    })),
    checks: selected,
    summary: {
      checks: selected.length,
      quantity: selected.reduce(
        (sum, check) =>
          sum +
          check.items
            .filter((item) => !query || item.name.toLocaleLowerCase('ru').includes(query))
            .reduce((n, item) => n + item.quantity, 0),
        0,
      ),
      revenue: selected.reduce(
        (sum, check) =>
          sum +
          check.items
            .filter((item) => !query || item.name.toLocaleLowerCase('ru').includes(query))
            .reduce((n, item) => n + item.total, 0),
        0,
      ),
    },
    fetchedAt: report.fetchedAt,
  };
}

async function cashReport(service, input) {
  const filters = [
    { field: 'OrderDeleted', values: ['NOT_DELETED'] },
    { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
    { field: 'Storned', values: ['FALSE'] },
    ...(input.department ? [{ field: 'Department', values: [input.department] }] : []),
  ];
  const base = {
    serverId: input.serverId,
    reportType: 'SALES',
    from: input.from,
    to: input.to,
    filters,
  };
  const shiftReport = await service.report({
    ...base,
    groupBy: ['SessionNum'],
    aggregate: ['UniqOrderId', 'DishDiscountSumInt'],
  });
  const shifts = shiftReport.rows.map((row) => ({
    id: clean(row.SessionNum) || 'Без номера',
    checks: number(row.UniqOrderId),
    revenue: number(row.DishDiscountSumInt),
  }));
  if (!input.shift || !input.search)
    return {
      shifts,
      checks: [],
      summary: { checks: 0, quantity: 0, revenue: 0 },
      fetchedAt: shiftReport.fetchedAt,
    };

  const shiftFilters = [...filters, { field: 'SessionNum', values: [input.shift] }];
  const products = await service.report({
    ...base,
    filters: shiftFilters,
    groupBy: ['DishId', 'DishName'],
    aggregate: ['DishAmountInt'],
  });
  const needle = input.search.toLocaleLowerCase('ru');
  const productIds = products.rows
    .filter((row) => clean(row.DishName).toLocaleLowerCase('ru').includes(needle))
    .map((row) => clean(row.DishId))
    .filter(Boolean);
  if (!productIds.length)
    return {
      shifts,
      checks: [],
      summary: { checks: 0, quantity: 0, revenue: 0 },
      fetchedAt: products.fetchedAt,
    };

  const hits = await service.report({
    ...base,
    filters: [...shiftFilters, { field: 'DishId', values: productIds.slice(0, 100) }],
    groupBy: ['UniqOrderId.Id'],
    aggregate: ['DishAmountInt'],
  });
  const orderIds = hits.rows
    .map((row) => clean(row['UniqOrderId.Id']))
    .filter(Boolean)
    .slice(0, 500);
  const reports = [];
  for (let index = 0; index < orderIds.length; index += 100) {
    reports.push(
      await service.report({
        ...base,
        filters: [
          ...shiftFilters,
          { field: 'UniqOrderId.Id', values: orderIds.slice(index, index + 100) },
        ],
        groupBy: [
          'SessionNum',
          'Department',
          'UniqOrderId.Id',
          'OrderNum',
          'OpenDate.Typed',
          'CloseTime',
          'Cashier',
          'DishId',
          'DishName',
          'DishMeasureUnit',
        ],
        aggregate: ['DishAmountInt', 'DishDiscountSumInt'],
      }),
    );
  }
  const result = buildCashReport(
    {
      rows: reports.flatMap((report) => report.rows),
      fetchedAt: reports[0]?.fetchedAt || products.fetchedAt,
    },
    input,
  );
  return { ...result, shifts };
}

module.exports = { cashReport, buildCashReport };

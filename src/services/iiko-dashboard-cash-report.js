const clean = (value) => String(value ?? '').trim();
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function buildCashShifts(report) {
  const shifts = new Map();
  for (const row of report.rows) {
    const id = clean(row.SessionID);
    if (!id) continue;
    const date = clean(row['OpenDate.Typed']).slice(0, 10);
    if (!shifts.has(id)) {
      shifts.set(id, {
        id,
        number: clean(row.SessionNum) || 'Без номера',
        department: clean(row.Department),
        register: clean(row.CashRegisterName),
        dateFrom: date,
        dateTo: date,
        checks: 0,
        revenue: 0,
      });
    }
    const shift = shifts.get(id);
    if (date && (!shift.dateFrom || date < shift.dateFrom)) shift.dateFrom = date;
    if (date > shift.dateTo) shift.dateTo = date;
    shift.checks += number(row.UniqOrderId);
    shift.revenue += number(row.DishDiscountSumInt);
  }
  return [...shifts.values()].sort(
    (a, b) =>
      b.dateTo.localeCompare(a.dateTo) ||
      b.number.localeCompare(a.number, 'ru', { numeric: true }) ||
      a.department.localeCompare(b.department, 'ru') ||
      a.register.localeCompare(b.register, 'ru'),
  );
}

function buildCashReport(report, input) {
  const checks = new Map();
  for (const row of report.rows) {
    const shift = clean(row.SessionID) || clean(row.SessionNum) || 'Без номера';
    const orderId = clean(row['UniqOrderId.Id']);
    if (!orderId) continue;
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
  const query = clean(input.search).toLocaleLowerCase('ru');
  const productId = clean(input.productId);
  const matches = (item) =>
    productId ? item.id === productId : !query || item.name.toLocaleLowerCase('ru').includes(query);
  const selected = [...checks.values()].filter(
    (check) => (!input.shift || check.shift === input.shift) && check.items.some(matches),
  );
  selected.sort((a, b) => String(b.date + b.time).localeCompare(String(a.date + a.time)));
  return {
    checks: selected,
    summary: {
      checks: selected.length,
      quantity: selected.reduce(
        (sum, check) => sum + check.items.filter(matches).reduce((n, item) => n + item.quantity, 0),
        0,
      ),
      revenue: selected.reduce(
        (sum, check) => sum + check.items.filter(matches).reduce((n, item) => n + item.total, 0),
        0,
      ),
    },
    fetchedAt: report.fetchedAt,
  };
}

function buildCashProducts(report, shift) {
  const products = new Map();
  for (const row of report.rows) {
    if (clean(row.SessionID) !== shift || !clean(row['UniqOrderId.Id'])) continue;
    const id = clean(row.DishId);
    const name = clean(row.DishName);
    if (name) products.set(id || name, { id, name });
  }
  return [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
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
    groupBy: ['SessionID', 'SessionNum', 'OpenDate.Typed', 'Department', 'CashRegisterName'],
    aggregate: ['UniqOrderId', 'DishDiscountSumInt'],
  });
  const shifts = buildCashShifts(shiftReport);
  const empty = {
    shifts,
    products: [],
    checks: [],
    summary: { checks: 0, quantity: 0, revenue: 0 },
    fetchedAt: shiftReport.fetchedAt,
  };
  if (!input.shift) return empty;

  // Older tabs submit a number. Accept it only when it identifies one shift;
  // numbers repeat between tills and departments, whereas SessionID is unique.
  const candidates = shifts.filter(
    (shift) => shift.id === input.shift || shift.number === input.shift,
  );
  if (candidates.length !== 1) return empty;
  const selected = candidates[0];

  // Load the full shift once. The report cache shares this query between product
  // suggestions and searches, preserving complete receipts without item limits.
  const report = await service.report({
    ...base,
    from: selected.dateFrom || input.from,
    to: selected.dateTo || input.to,
    filters: [...filters, { field: 'SessionID', values: [selected.id] }],
    groupBy: [
      'SessionID',
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
  });
  const products = buildCashProducts(report, selected.id);
  if (!clean(input.search) && !clean(input.productId))
    return { ...empty, products, fetchedAt: report.fetchedAt };
  const result = buildCashReport(report, { ...input, shift: selected.id });
  return { ...result, shifts, products };
}

module.exports = { cashReport, buildCashReport, buildCashShifts, buildCashProducts };

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const unavailable = () => ({
  status: 'unavailable',
  methods: [],
  receivedCash: null,
  change: null,
});

function amount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function paymentQuery(input, schema) {
  const columns = schema?.columns;
  const groupBy = ['SessionID', 'UniqOrderId.Id', 'PayTypes'];
  if (
    !groupBy.every((field) => columns?.[field]?.groupingAllowed) ||
    !columns?.DishDiscountSumInt?.aggregationAllowed
  ) {
    return null;
  }
  for (const field of ['PayTypes.GUID', 'PayTypes.Group']) {
    if (columns[field]?.groupingAllowed) groupBy.push(field);
  }
  return { ...input, groupBy, aggregate: ['DishDiscountSumInt'] };
}

function buildCashPayments(checks, report, sessionId) {
  const keyFor = (session, id) => JSON.stringify([session, id]);
  const payments = new Map(
    checks.map((check) => [keyFor(sessionId, check.id), { methods: new Map(), invalid: false }]),
  );
  for (const row of Array.isArray(report?.rows) ? report.rows : []) {
    const id = clean(row?.['UniqOrderId.Id']);
    const session = clean(row?.SessionID);
    if (session && session !== sessionId) continue;
    const payment = payments.get(keyFor(sessionId, id));
    if (!payment) continue;
    const name = clean(row?.PayTypes);
    const methodId = clean(row?.['PayTypes.GUID']);
    const group = clean(row?.['PayTypes.Group']);
    const value = amount(row?.DishDiscountSumInt);
    if (
      !session ||
      !name ||
      value === null ||
      (row['PayTypes.GUID'] != null && typeof row['PayTypes.GUID'] !== 'string') ||
      (row['PayTypes.Group'] != null && typeof row['PayTypes.Group'] !== 'string')
    ) {
      payment.invalid = true;
      continue;
    }
    const key = methodId ? `id:${methodId}` : JSON.stringify([group, name]);
    const existing = payment.methods.get(key);
    if (existing && (existing.name !== name || existing.group !== group)) {
      payment.invalid = true;
      continue;
    }
    if (existing) existing.amount += value;
    else {
      payment.methods.set(key, {
        id: methodId,
        name,
        group,
        kind: group === 'CASH' ? 'cash' : group === 'CARD' ? 'card' : 'other',
        amount: value,
      });
    }
  }
  return checks.map((check) => {
    const source = payments.get(keyFor(sessionId, check.id));
    const rawTotal = [...source.methods.values()].reduce((sum, method) => sum + method.amount, 0);
    const methods = [...source.methods.values()].map((method) => ({
      ...method,
      amount: Number(method.amount.toFixed(2)),
    }));
    const total = methods.reduce((sum, method) => sum + method.amount, 0);
    const valid =
      !source.invalid &&
      methods.length > 0 &&
      Number.isFinite(check.total) &&
      Number.isFinite(rawTotal) &&
      Number.isFinite(total) &&
      methods.every((method) => Number.isFinite(method.amount)) &&
      Math.abs(rawTotal - check.total) <= 0.020000001 &&
      Math.abs(total - check.total) <= 0.020000001;
    return {
      ...check,
      payment: valid
        ? {
            status: 'available',
            methods,
            // SALES describes settled amounts, not banknotes handed to the
            // cashier. It cannot establish cash received or change given.
            receivedCash: null,
            change: null,
          }
        : unavailable(),
    };
  });
}

async function cashPayments(service, input, checks) {
  let report;
  try {
    if (typeof service.getSchema === 'function') {
      const schema = await service.getSchema({ serverId: input.serverId, reportType: 'SALES' });
      const query = paymentQuery(input, schema);
      if (query) report = await service.report(query);
    }
  } catch (_error) {
    // A missing payment capability must not hide otherwise valid receipts.
  }
  const sessionId = input.filters.find((filter) => filter.field === 'SessionID')?.values[0];
  return buildCashPayments(checks, report, sessionId);
}

module.exports = { cashPayments, buildCashPayments, paymentQuery };

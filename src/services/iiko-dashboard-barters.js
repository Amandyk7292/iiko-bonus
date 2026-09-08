const { createHash } = require('node:crypto');
const { servers } = require('../config/iiko-dashboard');
const { failure } = require('./iiko-dashboard-client');
const column = (name, type = 'STRING') => ({ name, type });
const columns = {
  Blogger: column('Блогер'),
  Counteragent: column('Контрагент iiko'),
  Department: column('Филиал'),
  Document: column('Накладная №'),
  Date: column('Дата и время'),
  Product: column('Товар'),
  Unit: column('Единица'),
  Quantity: column('Количество', 'AMOUNT'),
  Total: column('Сумма, ₸', 'MONEY'),
};
const label = (value) => String(value ?? '').trim();
const list = (value) =>
  value == null || value === '' ? [] : Array.isArray(value) ? value : [value];
const numeric = (value) =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const sum = (rows, field) =>
  rows.every((row) => row[field] !== null)
    ? Math.round(rows.reduce((total, row) => total + row[field], 0) * 100) / 100
    : null;
const mapById = (rows) => new Map(rows.map((row) => [row.id, row]));

function barterReport(data, input) {
  const city = servers.find((server) => server.id === input.serverId)?.city;
  if (!city) throw failure('IIKO_REPORT_SERVER', 400);
  const products = mapById(data.products),
    units = mapById(data.units);
  const stores = mapById(data.stores),
    departments = mapById(data.departments);
  const sources = mapById(data.sources),
    seen = new Set(),
    checks = [];
  for (const document of data.documents) {
    // The export endpoint includes non-posted documents too. Never count drafts or other suppliers.
    if (
      document.status !== 'PROCESSED' ||
      !sources.has(document.counteragentId) ||
      seen.has(document.id)
    )
      continue;
    const date = label(document.dateIncoming);
    if (!document.id || !document.documentNumber || !Number.isFinite(Date.parse(date)))
      throw failure('IIKO_REPORT_RESPONSE');
    if (date.slice(0, 10) < input.from || date.slice(0, 10) > input.to) continue;
    seen.add(document.id);
    const items = list(document.items?.item)
      .map((item) => {
        const store = stores.get(item.storeId || document.defaultStoreId);
        const department = departments.get(store?.parentId);
        const product = products.get(item.productId);
        return {
          Department: label(department?.name || store?.name),
          Product: label(product?.name || item.productArticle || item.productId),
          Unit: label(units.get(product?.mainUnit)?.name),
          Quantity: numeric(item.amount),
          // The invoiced sum can differ from current price × quantity. Do not use stock cost or ledger entries.
          Total: numeric(item.sum),
        };
      })
      .filter((item) => !input.department || item.Department === input.department);
    if (!items.length) continue;
    checks.push({
      identity: createHash('sha256')
        .update(JSON.stringify([city, document.id]))
        .digest('hex'),
      city,
      Blogger: '',
      Counteragent: label(sources.get(document.counteragentId)?.name),
      Department: [...new Set(items.map((item) => item.Department))].join(' · '),
      Document: label(document.documentNumber),
      Date: date,
      Total: sum(items, 'Total'),
      items,
    });
  }
  if (checks.reduce((count, row) => count + row.items.length, 0) > 25000)
    throw failure('IIKO_REPORT_TOO_LARGE', 422);
  checks.sort((a, b) => Date.parse(b.Date) - Date.parse(a.Date));
  return {
    rows: [],
    columns,
    checks,
    city,
    sources: data.sources,
    serverId: input.serverId,
    period: { from: input.from, to: input.to },
    fetchedAt: new Date().toISOString(),
  };
}

function withPeople(report, names = []) {
  const assignments = new Map(names.map((row) => [row.document_key, label(row.blogger_name)]));
  const checks = report.checks.map((check) => ({
    ...check,
    Blogger: assignments.get(check.identity) || '',
  }));
  const groups = new Map();
  for (const check of checks) {
    const groupKey = check.Blogger.normalize('NFKC').toLocaleLowerCase('ru');
    if (!groups.has(groupKey))
      groups.set(groupKey, { groupKey, Blogger: check.Blogger, checks: [] });
    groups.get(groupKey).checks.push(check);
    check.groupKey = groupKey;
  }
  const bloggers = [...groups.values()]
    .map(({ checks: own, ...group }) => ({
      ...group,
      Checks: own.length,
      Total: sum(own, 'Total'),
      LastVisit: own[0].Date,
    }))
    .sort((a, b) => (b.Total || 0) - (a.Total || 0));
  return {
    ...report,
    checks,
    bloggers,
    rows: checks.flatMap(({ items, ...check }) => items.map((item) => ({ ...check, ...item }))),
    summary: {
      bloggers: bloggers.filter((row) => row.Blogger).length,
      checks: checks.length,
      total: sum(checks, 'Total'),
      unnamed: checks.filter((row) => !row.Blogger).length,
    },
  };
}

async function barters(service, input) {
  const data = await service.reports.get(
    `barter-documents:${JSON.stringify([input.serverId, input.from, input.to])}`,
    () =>
      service.client.withSession(input.serverId, (request) =>
        require('./iiko-dashboard-barter-documents').loadDocuments(request, input),
      ),
  );
  return barterReport(data, input);
}
module.exports = { barters, barterReport, withPeople, list };

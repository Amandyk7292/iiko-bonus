const { failure } = require('./iiko-dashboard-client-errors');
const { reportSource } = require('./iiko-dashboard-source');

const productIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const normalizeSearch = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replaceAll('ө', 'о')
    .replace(/\s+/g, ' ');

function retailDepartments(city, departments = []) {
  if (!['aktau', 'astana'].includes(city)) throw failure('IIKO_REPORT_SERVER', 400);
  return departments
    .filter((department) => {
      const name = String(department.name || '').trim();
      if (!/^Bulka\s/iu.test(name)) return false;
      if (city === 'aktau')
        return !/^Bulka\s+(?:Ozen|Атырау|Астана|Доставка|ЦО|ЦЕХ)(?:\s|$)/iu.test(name);
      return /^Bulka\s+Астана(?:\s|$)/iu.test(name) && !/\sЦО(?:\s|$)/iu.test(name);
    })
    .map((department) => String(department.name).trim())
    .sort((a, b) => a.localeCompare(b, 'ru-RU'));
}

async function productCatalog(service, serverId) {
  await reportSource(service, serverId);
  return service.reports.get(`product-sales-catalog:${serverId}`, async () => {
    const products = await service.client.withSession(serverId, (request) =>
      request('v2/entities/products/list'),
    );
    if (!Array.isArray(products)) throw failure('IIKO_REPORT_RESPONSE');
    return products
      .filter(
        (product) => productIdPattern.test(String(product.id || '')) && product.type !== 'SERVICE',
      )
      .map((product) => ({
        id: String(product.id),
        name: String(product.name || '').trim(),
        archived: product.deleted === true,
      }))
      .filter((product) => product.name);
  });
}

async function searchProducts(service, input) {
  const products = await productCatalog(service, input.serverId);
  const query = normalizeSearch(input.search);
  return {
    products: products
      .filter((product) => normalizeSearch(product.name).includes(query))
      .sort((a, b) => {
        const aStarts = normalizeSearch(a.name).startsWith(query);
        const bStarts = normalizeSearch(b.name).startsWith(query);
        return Number(bStarts) - Number(aStarts) || a.name.localeCompare(b.name, 'ru-RU');
      })
      .slice(0, 40),
  };
}

const amount = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw failure('IIKO_REPORT_RESPONSE');
  return value;
};
const money = (value) => Number(value.toFixed(2));
const emptyTotals = () => ({ quantity: 0, net: 0, gross: 0 });
const addTotals = (target, row) => {
  target.quantity += row.quantity;
  target.net = money(target.net + row.net);
  target.gross = money(target.gross + row.gross);
};

async function productSales(service, input) {
  const source = await reportSource(service, input.serverId);
  const product = (await productCatalog(service, input.serverId)).find(
    (candidate) => candidate.id === input.productId,
  );
  if (!product) throw failure('IIKO_REPORT_FIELD', 404);
  const names = retailDepartments(
    source.city,
    (await service.departments({ serverId: input.serverId })).departments,
  );
  if (!names.length) throw failure('IIKO_REPORT_UNAVAILABLE', 409);
  if (input.department && !names.includes(input.department))
    throw failure('IIKO_REPORT_FIELD', 400);
  const selectedDepartments = input.department ? [input.department] : names;
  const selectedNames = new Set(selectedDepartments);
  const sourceReport = await service.report({
    serverId: input.serverId,
    reportType: 'SALES',
    from: input.from,
    to: input.to,
    groupBy: ['OpenDate.Typed', 'Department', 'DishId', 'DishName', 'DishMeasureUnit'],
    aggregate: ['DishAmountInt', 'DishDiscountSumInt', 'DishSumInt'],
    filters: [
      { field: 'DishId', values: [input.productId] },
      { field: 'OrderDeleted', values: ['NOT_DELETED'] },
      { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
      ...(input.department ? [{ field: 'Department', values: [input.department] }] : []),
    ],
  });
  const byDayDepartment = new Map();
  const units = new Set();
  for (const sourceRow of sourceReport.rows) {
    if (String(sourceRow.DishId || '') !== input.productId) continue;
    const department = String(sourceRow.Department || '');
    if (!selectedNames.has(department)) continue;
    const date = String(sourceRow['OpenDate.Typed'] || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < input.from || date > input.to)
      throw failure('IIKO_REPORT_RESPONSE');
    const unit = String(sourceRow.DishMeasureUnit || '').trim();
    if (unit) units.add(unit);
    const key = `${date}\u0000${department}`;
    const current = byDayDepartment.get(key) || emptyTotals();
    addTotals(current, {
      quantity: amount(sourceRow.DishAmountInt),
      net: amount(sourceRow.DishDiscountSumInt),
      gross: amount(sourceRow.DishSumInt),
    });
    byDayDepartment.set(key, current);
  }
  if (units.size > 1) throw failure('IIKO_REPORT_RESPONSE');
  const rows = [];
  const daily = [];
  const byDepartment = new Map(
    selectedDepartments.map((department) => [department, emptyTotals()]),
  );
  const summary = emptyTotals();
  for (let date = input.from; date <= input.to;) {
    const day = emptyTotals();
    for (const department of selectedDepartments) {
      const row = {
        date,
        department,
        ...(byDayDepartment.get(`${date}\u0000${department}`) || emptyTotals()),
      };
      rows.push(row);
      addTotals(day, row);
      addTotals(byDepartment.get(department), row);
    }
    daily.push({ date, ...day });
    addTotals(summary, day);
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  return {
    period: { from: input.from, to: input.to },
    product,
    city: source.city,
    selectedDepartment: input.department || '',
    unit: [...units][0] || '',
    rows,
    daily,
    byDepartment: [...byDepartment].map(([department, totals]) => ({ department, ...totals })),
    summary,
    fetchedAt: sourceReport.fetchedAt,
  };
}

function exportProductSales(report) {
  const date = (value) => `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
  return {
    columns: {
      date: { name: 'Дата iiko' },
      department: { name: 'Точка' },
      product: { name: 'Товар' },
      unit: { name: 'Единица' },
      quantity: { name: 'Количество' },
      net: { name: 'Выручка после скидок, ₸' },
      gross: { name: 'Сумма до скидок, ₸' },
    },
    rows: [
      ...report.rows.map((row) => ({
        date: date(row.date),
        department: row.department,
        product: report.product.name,
        unit: report.unit,
        quantity: row.quantity,
        net: row.net,
        gross: row.gross,
      })),
      {
        date: 'Итого',
        department: report.selectedDepartment || report.city,
        product: report.product.name,
        unit: report.unit,
        ...report.summary,
      },
    ],
  };
}

module.exports = { exportProductSales, productSales, retailDepartments, searchProducts };

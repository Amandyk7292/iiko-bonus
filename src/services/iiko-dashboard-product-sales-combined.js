const cents = (value) => Math.round(value * 100);
const bucket = () => ({ net: 0, gross: 0, quantities: new Map() });

function add(target, row) {
  target.net += cents(row.net);
  target.gross += cents(row.gross);
  target.quantities.set(row.unit, (target.quantities.get(row.unit) ?? 0) + row.quantity);
}

function totals({ net, gross, quantities }) {
  return {
    net: net / 100,
    gross: gross / 100,
    quantities: [...quantities].map(([unit, quantity]) => ({ unit, quantity })),
  };
}

function combinedSales(scope, products, departments, days, rows) {
  const summary = bucket();
  const byDay = new Map(days.map((day) => [day, bucket()]));
  const byPoint = new Map(departments.map((department) => [department, bucket()]));
  const byProduct = new Map(products.map(({ id }) => [id, bucket()]));
  for (const row of rows) {
    add(summary, row);
    add(byDay.get(row.date), row);
    add(byPoint.get(row.department), row);
    add(byProduct.get(row.productId), row);
  }
  return {
    ...scope,
    products,
    rows,
    summary: totals(summary),
    daily: [...byDay].map(([date, value]) => ({ date, ...totals(value) })),
    byDepartment: [...byPoint].map(([department, value]) => ({ department, ...totals(value) })),
    byProduct: products.map((product) => ({ product, ...totals(byProduct.get(product.id)) })),
  };
}

const financeColumns = {
  gross: { name: 'Сумма до скидок, ₸', width: 24 },
  discount: { name: 'Скидки, ₸', width: 19 },
  net: { name: 'Выручка после скидок, ₸', width: 28 },
};
const financials = ({ gross, net }) => ({
  gross,
  discount: (cents(gross) - cents(net)) / 100,
  net,
});

function combinedExport(report, view) {
  const units = report.summary.quantities
    .map(({ unit }) => unit)
    .sort((a, b) => a.localeCompare(b, 'ru'));
  if (!units.length) units.push('');
  const quantityColumns = Object.fromEntries(
    units.map((unit, i) => [
      `qty${i}`,
      { name: unit ? `Количество, ${unit}` : 'Количество без ед. изм.', width: 27 },
    ]),
  );
  function values(row) {
    const quantities = new Map(row.quantities.map(({ unit, quantity }) => [unit, quantity]));
    return {
      ...Object.fromEntries(units.map((unit, i) => [`qty${i}`, quantities.get(unit) ?? 0])),
      ...financials(row),
    };
  }
  function summarySheet(name, label, items, dimension, extra = {}) {
    return {
      name,
      columns: {
        label: { name: label, width: 42 },
        ...extra,
        ...quantityColumns,
        ...financeColumns,
      },
      rows: [
        ...items.map((row) => ({ ...dimension(row), ...values(row) })),
        { label: 'Итого', ...values(report.summary) },
      ],
    };
  }
  const day = summarySheet('По дням', 'Дата iiko', report.daily, ({ date }) => ({ label: date }));
  const points = summarySheet('По точкам', 'Точка', report.byDepartment, ({ department }) => ({
    label: department,
  }));
  const products = summarySheet(
    'По товарам',
    'Товар iiko',
    report.byProduct,
    ({ product }) => ({
      label: product.name,
      productId: product.id,
    }),
    { productId: { name: 'ID товара iiko', width: 39 } },
  );
  if (view === 'daily') return [day, products];
  if (view === 'points') return [points, products];

  const catalog = new Map(report.products.map(({ id, name }) => [id, name]));
  return [
    products,
    points,
    day,
    {
      name: 'Детализация',
      columns: {
        date: { name: 'Дата iiko', width: 15 },
        department: { name: 'Точка', width: 40 },
        product: { name: 'Товар iiko', width: 42 },
        unit: { name: 'Ед. изм.', width: 14 },
        quantity: { name: 'Количество', width: 17 },
        ...financeColumns,
        productId: { name: 'ID товара iiko', width: 39 },
      },
      rows: [...report.rows]
        .sort(
          (a, b) => a.date.localeCompare(b.date) || a.department.localeCompare(b.department, 'ru'),
        )
        .map((row) => ({ ...row, product: catalog.get(row.productId), ...financials(row) })),
    },
  ];
}

module.exports = { combinedSales, combinedExport };

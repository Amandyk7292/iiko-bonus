const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru')
    .replace(/\s+/g, ' ');
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function buildRevision({ opening, closing, invoices, sales, writeoffs }) {
  const products = new Map();
  const touch = (name, unit = '') => {
    // iiko balance rows may omit the unit while sales and invoices include it.
    // The product name is the common stable value across these report sources.
    const key = normalize(name);
    if (!products.has(key))
      products.set(key, {
        key,
        name: String(name || '—'),
        unit: String(unit || ''),
        opening: 0,
        incoming: 0,
        sold: 0,
        writtenOff: 0,
        systemBalance: 0,
      });
    const product = products.get(key);
    if (!product.unit && unit) product.unit = String(unit);
    return product;
  };
  for (const row of opening) touch(row.name, row.unit).opening += number(row.amount);
  for (const row of closing) touch(row.name, row.unit).systemBalance += number(row.amount);
  for (const row of invoices) touch(row.Product, row.Unit).incoming += number(row.Quantity);
  for (const row of sales)
    touch(row.DishName, row.DishMeasureUnit).sold += number(row.DishAmountInt);
  for (const row of writeoffs)
    touch(row['Product.Name'], row['Product.MeasureUnit']).writtenOff += number(
      row.WriteoffQuantity,
    );
  return [...products.values()]
    .map((row) => ({ ...row, expected: row.opening + row.incoming - row.sold - row.writtenOff }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function balanceRows(data, department) {
  const names = new Map(data.products.map((item) => [String(item.id), item]));
  const stores = new Map(data.stores.map((item) => [String(item.id), item.name]));
  return data.rows
    .filter((row) => !department || stores.get(String(row.store)) === department)
    .map((row) => ({
      name: names.get(String(row.product))?.name || row.product,
      unit: row.measureUnitName || row.unit || '',
      amount: row.amount,
    }));
}

async function revision(service, input) {
  const before = new Date(Date.parse(input.from) - 86400000).toISOString().slice(0, 10);
  const [opening, closing, invoices, sales, writeoffs] = await Promise.all([
    service.balances({ serverId: input.serverId, date: before }),
    service.balances({ serverId: input.serverId, date: input.to }),
    service.invoices({ ...input, supplier: '' }),
    service.report({
      serverId: input.serverId,
      reportType: 'SALES',
      from: input.from,
      to: input.to,
      groupBy: ['Department', 'DishId', 'DishName', 'DishMeasureUnit'],
      aggregate: ['DishAmountInt'],
      filters: [
        { field: 'OrderDeleted', values: ['NOT_DELETED'] },
        { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
        { field: 'Storned', values: ['FALSE'] },
        ...(input.department ? [{ field: 'Department', values: [input.department] }] : []),
      ],
    }),
    service.analytics({
      serverId: input.serverId,
      from: input.from,
      to: input.to,
      view: 'writeoffProducts',
      department: input.department,
      cashierId: '',
      productId: '',
    }),
  ]);
  return {
    rows: buildRevision({
      opening: balanceRows(opening, input.department),
      closing: balanceRows(closing, input.department),
      invoices: invoices.rows,
      sales: sales.rows,
      writeoffs: writeoffs.rows,
    }),
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { revision, buildRevision };

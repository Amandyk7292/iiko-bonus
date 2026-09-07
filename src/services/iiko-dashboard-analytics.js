const salesFields = [
  'DishDiscountSumInt',
  'DishSumInt',
  'UniqOrderId',
  'DishAmountInt',
  'DiscountSum',
  'ItemSaleEventDiscountType.DiscountAmount',
  'ProductCostBase.ProductCost',
];
const dimensions = {
  branches: ['Department'],
  cashiers: ['Cashier.Id', 'Cashier', 'Department'],
  products: ['DishId', 'DishName', 'DishMeasureUnit', 'DishGroup'],
  discounts: ['ItemSaleEventDiscountType', 'Department', 'DishName', 'DishMeasureUnit'],
  cashierProducts: ['Cashier', 'Department', 'DishName', 'DishMeasureUnit'],
  productBranches: ['Department', 'DishName', 'DishMeasureUnit'],
};

function analyticsQuery(input) {
  const filters = input.department ? [{ field: 'Department', values: [input.department] }] : [];
  const common = { serverId: input.serverId, from: input.from, to: input.to };
  if (input.view.startsWith('writeoff')) {
    return {
      ...common,
      reportType: 'TRANSACTIONS',
      groupBy:
        input.view === 'writeoffDocuments'
          ? [
              'Department',
              'Store',
              'Product.Id',
              'Product.Name',
              'Product.MeasureUnit',
              'Document',
              'DateTime.DateTyped',
              'Contr-Account.Name',
              'Comment',
            ]
          : ['Department', 'Store', 'Product.Id', 'Product.Name', 'Product.MeasureUnit'],
      aggregate: ['Amount', 'Sum.ResignedSum'],
      // Only the stock side of write-off acts: never count the matching accounting entry twice.
      filters: [
        ...filters,
        { field: 'TransactionType', values: ['WRITEOFF'] },
        { field: 'Account.StoreOrAccount', values: ['STORE'] },
      ],
    };
  }
  if (input.cashierId) filters.push({ field: 'Cashier.Id', values: [input.cashierId] });
  if (input.productId) filters.push({ field: 'DishId', values: [input.productId] });
  return {
    ...common,
    reportType: 'SALES',
    groupBy: dimensions[input.view],
    aggregate: salesFields,
    filters: [
      ...filters,
      { field: 'OrderDeleted', values: ['NOT_DELETED'] },
      { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
    ],
  };
}
const column = (name, type = 'MONEY') => ({ name, type });
function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function ratio(a, b, scale = 1) {
  return a !== null && b !== null && b > 0 ? (a / b) * scale : null;
}

function analyticsReport(report, input) {
  if (!input.view.startsWith('writeoff')) {
    const rows = report.rows
      .map((row) => ({
        ...row,
        AverageCheck: ratio(numeric(row.DishDiscountSumInt), numeric(row.UniqOrderId)),
        DiscountRate: ratio(numeric(row.DiscountSum), numeric(row.DishSumInt), 100),
      }))
      .filter((row) => input.view !== 'discounts' || (numeric(row.DiscountSum) ?? 0) > 0);
    return {
      ...report,
      rows,
      columns: {
        ...report.columns,
        AverageCheck: column(
          ['products', 'productBranches', 'cashierProducts', 'discounts'].includes(input.view)
            ? 'Выручка выбранных товаров на чек, ₸'
            : 'Средний чек, ₸',
        ),
        DiscountRate: column('Скидка от суммы до скидок, %', 'NUMBER'),
      },
    };
  }
  const groups =
    input.view === 'writeoffBranches'
      ? ['Department']
      : input.view === 'writeoffProducts'
        ? ['Product.Id', 'Product.Name', 'Product.MeasureUnit']
        : [
            'Department',
            'Store',
            'Document',
            'DateTime.DateTyped',
            'Product.Id',
            'Product.Name',
            'Product.MeasureUnit',
            'Contr-Account.Name',
            'Comment',
          ];
  const grouped = new Map();
  for (const row of report.rows) {
    const key = JSON.stringify(groups.map((field) => row[field] ?? null));
    if (!grouped.has(key))
      grouped.set(key, {
        row: Object.fromEntries(groups.map((field) => [field, row[field]])),
        quantities: new Map(),
        sum: 0,
        hasSum: false,
      });
    const entry = grouped.get(key);
    const sum = numeric(row['Sum.ResignedSum']);
    const amount = numeric(row.Amount);
    // Signed amounts retain corrections/reversals; abs() would incorrectly inflate losses.
    if (sum !== null) {
      entry.sum -= sum;
      entry.hasSum = true;
    }
    if (amount !== null) {
      const unit = String(row['Product.MeasureUnit'] || '—');
      entry.quantities.set(unit, (entry.quantities.get(unit) || 0) - amount);
    }
  }
  return {
    ...report,
    columns: {
      ...Object.fromEntries(groups.map((field) => [field, report.columns[field]])),
      WriteoffQuantity: column(
        'Списано (ед. iiko)',
        input.view === 'writeoffBranches' ? 'STRING' : 'AMOUNT',
      ),
      WriteoffCost: column('Стоимость списаний, ₸'),
    },
    rows: [...grouped.values()].map(({ row, quantities, sum, hasSum }) => ({
      ...row,
      WriteoffQuantity:
        input.view === 'writeoffBranches'
          ? [...quantities]
              .map(([unit, amount]) => `${Number(amount.toFixed(3))} ${unit}`)
              .join(' · ')
          : quantities.size
            ? [...quantities.values()][0]
            : null,
      WriteoffCost: hasSum ? sum : null,
    })),
  };
}
module.exports = { analyticsQuery, analyticsReport };

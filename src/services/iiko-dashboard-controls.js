const col = (name, type = 'STRING') => ({ name, type });
const n = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const pct = (value, total) => (total > 0 ? (value / total) * 100 : null);
const change = (value, previous) => (previous > 0 ? ((value - previous) / previous) * 100 : null);
const key = (...parts) => JSON.stringify(parts);
const sum = (rows, field) => rows.reduce((total, row) => total + n(row[field]), 0);
const names = {
  Department: col('Филиал'),
  'Product.Name': col('Товар'),
  'Product.MeasureUnit': col('Единица'),
  WriteoffCost: col('Стоимость списаний, ₸', 'MONEY'),
  WriteoffQuantity: col('Списано', 'AMOUNT'),
  Revenue: col('Выручка, ₸', 'MONEY'),
  WriteoffShare: col('Списания / выручка, %', 'PERCENT'),
  DocumentCount: col('Документов', 'INTEGER'),
  Reason: col('Статья списания'),
  Comment: col('Комментарий'),
  Day: col('Дата'),
  Store: col('Склад'),
  Document: col('Документ'),
  Cashier: col('Кассир'),
  AuthUser: col('Авторизовал в iiko'),
  OrderNum: col('Номер чека'),
  SourceOrderNum: col('Исходный чек'),
  CloseTime: col('Время'),
  DiscountName: col('Скидка'),
  DiscountSum: col('Сумма скидки, ₸', 'MONEY'),
  DiscountRate: col('Скидка на позиции, %', 'PERCENT'),
  ReturnSum: col('Сумма возврата, ₸', 'MONEY'),
  Flags: col('Сигналы проверки'),
  Sold: col('Продано', 'AMOUNT'),
  PreviousSold: col('Продано ранее', 'AMOUNT'),
  Daily: col('Продаж в день', 'AMOUNT'),
  Growth: col('Изменение продаж, %', 'PERCENT'),
  LossRate: col('Доля списаний в движении, %', 'PERCENT'),
  Advice: col('Рекомендация'),
  Pace: col('Спрос'),
  SuggestedDaily: col('Ориентир на день', 'AMOUNT'),
};
function table(source, rows, fields) {
  return {
    ...source,
    rows,
    columns: Object.fromEntries(fields.map((field) => [field, names[field] || col(field)])),
  };
}
function groupWriteoffs(rows, fields) {
  const groups = new Map();
  for (const row of rows) {
    const id = key(...fields.map((field) => row[field] ?? ''));
    if (!groups.has(id))
      groups.set(id, {
        ...Object.fromEntries(fields.map((field) => [field, row[field] ?? ''])),
        WriteoffCost: 0,
        WriteoffQuantity: 0,
        documents: new Set(),
      });
    const group = groups.get(id);
    group.WriteoffCost += n(row.WriteoffCost);
    group.WriteoffQuantity += n(row.WriteoffQuantity);
    if (n(row.WriteoffQuantity) > 0 || n(row.WriteoffCost) > 0)
      group.documents.add(key(row.Department, row.Store, row.Document, row.Day));
  }
  return [...groups.values()].map(({ documents, ...row }) => ({
    ...row,
    DocumentCount: documents.size,
  }));
}
function writeoffControl(input, documents, revenue, previous) {
  const rows = documents.rows.map((row) => ({
    ...row,
    Day: row['DateTime.DateTyped']?.slice(0, 10),
    Reason: row['Contr-Account.Name'] || '',
    Comment: row.Comment || '',
  }));
  const byBranch = new Map();
  const byDay = new Map();
  for (const row of revenue.rows) {
    byBranch.set(row.Department, (byBranch.get(row.Department) || 0) + n(row.DishDiscountSumInt));
    const date = row['OpenDate.Typed']?.slice(0, 10);
    byDay.set(date, (byDay.get(date) || 0) + n(row.DishDiscountSumInt));
  }
  const cost = sum(rows, 'WriteoffCost'),
    sales = sum(revenue.rows, 'DishDiscountSumInt');
  const priorCost = sum(previous.rows, 'WriteoffCost');
  const branchRows = groupWriteoffs(rows, ['Department']).map((row) => ({
    ...row,
    Revenue: byBranch.get(row.Department) || 0,
    WriteoffShare: pct(row.WriteoffCost, byBranch.get(row.Department) || 0),
  }));
  const groupedDays = new Map(groupWriteoffs(rows, ['Day']).map((row) => [row.Day, row]));
  const days = [];
  for (let day = input.from; day <= input.to;) {
    const row = groupedDays.get(day) || { WriteoffCost: 0, DocumentCount: 0 };
    const total = byDay.get(day) || 0;
    days.push({
      Day: day,
      WriteoffCost: row.WriteoffCost,
      Revenue: total,
      WriteoffShare: pct(row.WriteoffCost, total),
      DocumentCount: row.DocumentCount,
    });
    day = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
  }
  return {
    summary: {
      cost,
      revenue: sales,
      share: pct(cost, sales),
      change: change(cost, priorCost),
      documents: new Set(rows.map((r) => key(r.Department, r.Store, r.Document, r.Day))).size,
    },
    tables: {
      branches: table(documents, branchRows, [
        'Department',
        'WriteoffCost',
        'Revenue',
        'WriteoffShare',
        'DocumentCount',
      ]),
      products: table(
        documents,
        groupWriteoffs(rows, ['Product.Id', 'Product.Name', 'Product.MeasureUnit']).sort(
          (a, b) => b.DocumentCount - a.DocumentCount,
        ),
        [
          'Product.Name',
          'Product.MeasureUnit',
          'WriteoffQuantity',
          'WriteoffCost',
          'DocumentCount',
        ],
      ),
      reasons: table(
        documents,
        groupWriteoffs(rows, ['Reason', 'Comment']).sort((a, b) => b.WriteoffCost - a.WriteoffCost),
        ['Reason', 'Comment', 'WriteoffCost', 'DocumentCount'],
      ),
      documents: table(documents, rows, [
        'Department',
        'Store',
        'Document',
        'Day',
        'Product.Name',
        'Product.MeasureUnit',
        'WriteoffQuantity',
        'WriteoffCost',
        'Reason',
        'Comment',
      ]),
      trend: table(documents, days, [
        'Day',
        'WriteoffCost',
        'Revenue',
        'WriteoffShare',
        'DocumentCount',
      ]),
    },
  };
}
function checkRows(report, kind) {
  const checks = new Map();
  for (const row of report.rows) {
    const id = key(
      row.Department,
      row['UniqOrderId.Id'] || [row.OrderNum, row['OpenDate.Typed'], row.CloseTime],
    );
    if (!checks.has(id))
      checks.set(id, {
        ...row,
        DiscountSum: 0,
        ReturnSum: 0,
        Gross: 0,
        authors: new Set(),
        cashiers: new Set(),
        discounts: new Set(),
      });
    const check = checks.get(id);
    check.DiscountSum += n(row.DiscountSum);
    check.ReturnSum += n(row.DishReturnSum);
    check.Gross += n(row.DishSumInt);
    if (row.AuthUser) check.authors.add(row.AuthUser);
    if (row.Cashier) check.cashiers.add(row.Cashier);
    if (row['OrderDiscount.Type']) check.discounts.add(row['OrderDiscount.Type']);
  }
  return [...checks.values()]
    .map(({ authors, cashiers, discounts, Gross, ...row }) => ({
      ...row,
      AuthUser: [...authors].join(' · '),
      Cashier: [...cashiers].join(' · '),
      DiscountName: [...discounts].join(' · '),
      DiscountRate: pct(row.DiscountSum, Gross),
      Kind: kind,
    }))
    .filter((row) => (kind === 'discounts' ? row.DiscountSum > 0 : row.ReturnSum !== 0));
}
function operationsControl(input, discounts, returns) {
  const discounted = checkRows(discounts, 'discounts');
  const refunded = checkRows(returns, 'returns');
  const cashierDays = new Map();
  for (const row of refunded) {
    const id = key(row.Department, row['Cashier.Id'], row['OpenDate.Typed']);
    if (row['Cashier.Id']) cashierDays.set(id, (cashierDays.get(id) || 0) + 1);
  }
  const flag = (row) => ({
    ...row,
    Flags: [
      row.DiscountRate >= input.discountThreshold ? 'high_discount' : null,
      Math.abs(row.ReturnSum) >= input.returnThreshold ? 'large_return' : null,
      row.Kind === 'returns' &&
      (cashierDays.get(key(row.Department, row['Cashier.Id'], row['OpenDate.Typed'])) || 0) >= 3
        ? 'repeat_returns'
        : null,
    ]
      .filter(Boolean)
      .join('|'),
  });
  const discountRows = discounted.map(flag),
    returnRows = refunded.map(flag);
  const fields = ['Department', 'OrderNum', 'SourceOrderNum', 'CloseTime', 'Cashier', 'AuthUser'];
  return {
    summary: {
      discount: sum(discountRows, 'DiscountSum'),
      discountChecks: discountRows.length,
      returns: sum(returnRows, 'ReturnSum'),
      returnChecks: returnRows.length,
      flagged: [...discountRows, ...returnRows].filter((row) => row.Flags).length,
    },
    tables: {
      discounts: table(discounts, discountRows, [
        ...fields,
        'DiscountName',
        'DiscountSum',
        'DiscountRate',
        'Flags',
      ]),
      returns: table(returns, returnRows, [...fields, 'ReturnSum', 'Flags']),
    },
  };
}
function assortmentControl(input, current, previous, writeoffs) {
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000 + 1;
  const products = new Map();
  const idFor = (row) =>
    key(
      row.Department,
      row.DishId || row['Product.Id'],
      row.DishMeasureUnit || row['Product.MeasureUnit'],
    );
  for (const row of [...current.rows, ...previous.rows]) {
    const id = idFor(row);
    if (!products.has(id))
      products.set(id, {
        Department: row.Department,
        'Product.Name': row.DishName,
        'Product.MeasureUnit': row.DishMeasureUnit,
        Sold: 0,
        PreviousSold: 0,
        WriteoffQuantity: 0,
        WriteoffCost: 0,
      });
  }
  for (const [report, field] of [
    [current, 'Sold'],
    [previous, 'PreviousSold'],
  ])
    for (const row of report.rows) products.get(idFor(row))[field] += n(row.DishAmountInt);
  const unmatchedProducts = new Set();
  for (const row of writeoffs.rows) {
    const product = products.get(idFor(row));
    if (product) {
      product.WriteoffQuantity += n(row.WriteoffQuantity);
      product.WriteoffCost += n(row.WriteoffCost);
    } else unmatchedProducts.add(idFor(row));
  }
  const rows = [...products.values()].map((row) => {
    const growth = change(row.Sold, row.PreviousSold),
      daily = row.Sold / days;
    const loss = pct(
      Math.max(0, row.WriteoffQuantity),
      Math.max(0, row.Sold) + Math.max(0, row.WriteoffQuantity),
    );
    const advice =
      days < 7
        ? 'short_period'
        : loss !== null && loss >= 15
          ? 'reduce_batch'
          : row.Sold === 0 && row.PreviousSold > 0
            ? 'review_no_sales'
            : growth !== null && growth <= -30
              ? 'review_decline'
              : growth !== null && growth >= 20 && (loss === null || loss < 5)
                ? 'review_increase'
                : 'keep';
    return {
      ...row,
      Daily: daily,
      Growth: growth,
      LossRate: loss,
      Advice: advice,
      SuggestedDaily: Number(Math.max(0, daily).toFixed(3)),
      Pace: '',
    };
  });
  const unitGroups = new Map();
  for (const row of rows) {
    const id = key(row.Department, row['Product.MeasureUnit']);
    if (!unitGroups.has(id)) unitGroups.set(id, []);
    unitGroups.get(id).push(row);
  }
  for (const group of unitGroups.values()) {
    group.sort((a, b) => b.Daily - a.Daily);
    group.forEach((row, index) => {
      row.Pace =
        row.Sold === 0
          ? 'no_sales'
          : group.length >= 4 && index < Math.ceil(group.length / 4)
            ? 'fast'
            : group.length >= 4 && index >= Math.floor((group.length * 3) / 4)
              ? 'slow'
              : 'regular';
    });
  }
  return {
    summary: {
      products: rows.length,
      increase: rows.filter((r) => r.Advice === 'review_increase').length,
      reduce: rows.filter((r) =>
        ['reduce_batch', 'review_decline', 'review_no_sales'].includes(r.Advice),
      ).length,
      unmatchedWriteoffProducts: unmatchedProducts.size,
    },
    tables: {
      assortment: table(
        current,
        rows.sort((a, b) => a.Advice.localeCompare(b.Advice) || b.Daily - a.Daily),
        [
          'Department',
          'Product.Name',
          'Product.MeasureUnit',
          'Sold',
          'PreviousSold',
          'Daily',
          'Growth',
          'WriteoffQuantity',
          'WriteoffCost',
          'LossRate',
          'Pace',
          'Advice',
          'SuggestedDaily',
        ],
      ),
    },
  };
}
module.exports = { writeoffControl, operationsControl, assortmentControl };

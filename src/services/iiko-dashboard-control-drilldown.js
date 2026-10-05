const { createHash } = require('node:crypto');

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const identity = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const compare = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ru');
const checkIdentity = (row) =>
  identity(
    row.Department ?? '',
    row['UniqOrderId.Id'] || [row.OrderNum, row['OpenDate.Typed'], row.CloseTime],
  );
const cashierIdentity = (row) =>
  identity(
    row.Department ?? '',
    row['Cashier.Id'] ? ['id', row['Cashier.Id']] : ['name', row.Cashier || ''],
  );
const documentIdentity = (row) =>
  identity(row.Department ?? '', row.Store ?? '', row.Document ?? '', row.Day ?? '');

function ranked(rows, amount, label) {
  const ordered = [...rows].sort(
    (a, b) =>
      number(b[amount]) - number(a[amount]) ||
      compare(a[label], b[label]) ||
      compare(a.Department, b.Department) ||
      compare(a.CashierKey, b.CashierKey),
  );
  let rank = 0;
  return ordered.map((row, index) => {
    if (!index || number(row[amount]) !== number(ordered[index - 1][amount])) rank = index + 1;
    return { ...row, Rank: rank };
  });
}

function writeoffDocuments(rows) {
  const headers = new Map();
  const items = rows.map((row) => ({ ...row, DocumentKey: documentIdentity(row) }));
  for (const row of items) {
    if (!headers.has(row.DocumentKey)) {
      headers.set(row.DocumentKey, {
        DocumentKey: row.DocumentKey,
        Department: row.Department,
        Store: row.Store,
        Document: row.Document,
        Day: row.Day,
        WriteoffCost: 0,
        reasons: new Set(),
        comments: new Set(),
      });
    }
    const document = headers.get(row.DocumentKey);
    document.WriteoffCost += number(row.WriteoffCost);
    if (row.Reason) document.reasons.add(row.Reason);
    if (row.Comment) document.comments.add(row.Comment);
  }
  return {
    items,
    headers: [...headers.values()]
      .map(({ reasons, comments, ...row }) => ({
        ...row,
        Reason: [...reasons].sort(compare).join(' · '),
        Comment: [...comments].sort(compare).join(' · '),
      }))
      .sort(
        (a, b) =>
          b.WriteoffCost - a.WriteoffCost ||
          compare(b.Day, a.Day) ||
          compare(a.DocumentKey, b.DocumentKey),
      ),
  };
}

// Attribute only a cashier's own OLAP rows, never the entire shared receipt to its first cashier.
// The full receipt remains available by its original UUID, department and date.
function discountCheckRows(report, eligibleChecks) {
  const eligible = new Set(eligibleChecks.map(checkIdentity));
  const checks = new Map();
  for (const row of report.rows) {
    const CheckKey = checkIdentity(row);
    if (!eligible.has(CheckKey)) continue;
    const CashierKey = cashierIdentity(row);
    const key = identity(CheckKey, CashierKey);
    if (!checks.has(key))
      checks.set(key, {
        ...row,
        CheckKey,
        CashierKey,
        DiscountSum: 0,
        ReturnSum: 0,
        Gross: 0,
        authors: new Set(),
        cashiers: new Set(),
        discounts: new Set(),
      });
    const check = checks.get(key);
    check.DiscountSum += number(row.DiscountSum);
    check.Gross += number(row.DishSumInt);
    if (row.AuthUser) check.authors.add(row.AuthUser);
    if (row.Cashier) check.cashiers.add(row.Cashier);
    if (row['OrderDiscount.Type']) check.discounts.add(row['OrderDiscount.Type']);
  }
  return [...checks.values()].map(({ authors, cashiers, discounts, Gross, ...row }) => ({
    ...row,
    AuthUser: [...authors].sort(compare).join(' · '),
    Cashier: [...cashiers].sort(compare).join(' · '),
    DiscountName: [...discounts].sort(compare).join(' · '),
    DiscountRate: Gross > 0 ? (row.DiscountSum / Gross) * 100 : null,
    Kind: 'discounts',
  }));
}

function discountCashiers(rows) {
  const cashiers = new Map();
  for (const row of rows) {
    if (!cashiers.has(row.CashierKey))
      cashiers.set(row.CashierKey, {
        CashierKey: row.CashierKey,
        'Cashier.Id': row['Cashier.Id'],
        Department: row.Department,
        names: new Set(),
        checks: new Set(),
        flags: new Set(),
        DiscountSum: 0,
      });
    const cashier = cashiers.get(row.CashierKey);
    cashier.DiscountSum += number(row.DiscountSum);
    cashier.checks.add(row.CheckKey);
    if (row.Cashier) cashier.names.add(row.Cashier);
    for (const flag of String(row.Flags || '')
      .split('|')
      .filter(Boolean))
      cashier.flags.add(flag);
  }
  return ranked(
    [...cashiers.values()].map(({ names, checks, flags, ...row }) => ({
      ...row,
      Cashier: [...names].sort(compare).join(' · '),
      CheckCount: checks.size,
      Flags: [...flags].sort(compare).join('|'),
    })),
    'DiscountSum',
    'Cashier',
  );
}

module.exports = {
  ranked,
  documentIdentity,
  writeoffDocuments,
  discountCheckRows,
  discountCashiers,
};

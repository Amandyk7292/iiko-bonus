import { offsetDate, salesFilters, validRange, valueFor, type Query, type Report } from './model';

export interface DishSalesScope {
  serverId: string;
  from: string;
  to: string;
  department: string;
  productId: string;
  unit: string;
}
export interface DishSalesTotals {
  quantity: number | null;
  revenue: number | null;
}
export interface DishSalesDay extends DishSalesTotals {
  date: string;
}
export interface DishSalesPoint extends DishSalesTotals {
  department: string;
  daily: DishSalesDay[];
}
const add = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
const empty = (): DishSalesTotals => ({ quantity: 0, revenue: 0 });

export function dishSalesQuery(scope: DishSalesScope): Query {
  return {
    serverId: scope.serverId,
    reportType: 'SALES',
    from: scope.from,
    to: scope.to,
    groupBy: ['OpenDate.Typed', 'Department', 'DishMeasureUnit'],
    aggregate: ['DishAmountInt', 'DishDiscountSumInt'],
    filters: [
      ...salesFilters,
      { field: 'DishId', values: [scope.productId], exclude: false },
      ...(scope.department
        ? [{ field: 'Department', values: [scope.department], exclude: false }]
        : []),
    ],
  };
}

export function dishSalesDetails(rows: Report['rows'], scope: DishSalesScope) {
  const dates: string[] = [];
  if (validRange(scope.from, scope.to)) {
    for (let date = scope.from; date <= scope.to; date = offsetDate(date, 1)) dates.push(date);
  }
  const byPoint = new Map<string, Map<string, DishSalesTotals>>();
  if (scope.department) byPoint.set(scope.department, new Map());
  rows.forEach((row) => {
    if (String(row.DishMeasureUnit ?? '').trim() !== scope.unit) return;
    const rawDate = String(row['OpenDate.Typed'] ?? '');
    if (!/^\d{4}-\d{2}-\d{2}(?:$|[T ])/u.test(rawDate)) return;
    const date = rawDate.slice(0, 10);
    if (date < scope.from || date > scope.to || !dates.includes(date)) return;
    const department = String(row.Department ?? '');
    if (scope.department && department !== scope.department) return;
    let daily = byPoint.get(department);
    if (!daily) {
      daily = new Map();
      byPoint.set(department, daily);
    }
    const previous = daily.get(date) ?? empty();
    daily.set(date, {
      quantity: add(previous.quantity, valueFor(row, 'DishAmountInt')),
      revenue: add(previous.revenue, valueFor(row, 'DishDiscountSumInt')),
    });
  });
  const totals = (daily: DishSalesDay[]): DishSalesTotals =>
    daily.reduce(
      (sum, row) => ({
        quantity: add(sum.quantity, row.quantity),
        revenue: add(sum.revenue, row.revenue),
      }),
      empty(),
    );
  const points: DishSalesPoint[] = [...byPoint]
    .map(([department, rowsByDay]) => {
      const daily = dates.map((date) => ({ date, ...(rowsByDay.get(date) ?? empty()) }));
      return { department, daily, ...totals(daily) };
    })
    .sort(
      (a, b) =>
        (b.quantity ?? -Infinity) - (a.quantity ?? -Infinity) ||
        a.department.localeCompare(b.department),
    );
  const daily = dates.map((date, index) => ({
    date,
    ...points.reduce(
      (sum, point) => ({
        quantity: add(sum.quantity, point.daily[index].quantity),
        revenue: add(sum.revenue, point.daily[index].revenue),
      }),
      empty(),
    ),
  }));
  return { points, daily, ...totals(daily) };
}

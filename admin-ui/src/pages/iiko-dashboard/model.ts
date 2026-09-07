export interface Server {
  id: string;
  city: 'aktau' | 'astana';
  kind: 'chain' | 'rms';
  host: string;
  configured: boolean;
  active: boolean;
}
export interface Column {
  name: string;
  type: string;
  aggregationAllowed?: boolean;
  groupingAllowed?: boolean;
  filteringAllowed?: boolean;
}
export type Columns = Record<string, Column>;
export interface Report {
  period?: { from: string; to: string };
  rows: Record<string, unknown>[];
  columns: Columns;
  fetchedAt: string;
  serverId: string;
}
export interface Filter {
  field: string;
  values: (string | number | boolean)[];
  exclude: boolean;
}
export interface Query {
  serverId: string;
  reportType: 'SALES' | 'TRANSACTIONS' | 'DELIVERIES';
  from: string;
  to: string;
  groupBy: string[];
  aggregate: string[];
  filters: Filter[];
}
export const metrics = [
  { id: 'revenue', field: 'DishDiscountSumInt', money: true },
  { id: 'checks', field: 'UniqOrderId', money: false },
  { id: 'average', field: 'average', money: true },
  { id: 'discount', field: 'DiscountSum', money: true },
  { id: 'cost', field: 'ProductCostBase.ProductCost', money: true },
  { id: 'guests', field: 'GuestNum', money: false },
  { id: 'items', field: 'DishAmountInt', money: false },
];
export const defaultMetrics = ['revenue', 'checks', 'average', 'discount'];
export function valueFor(row: Record<string, unknown> | undefined, field: string): number | null {
  if (!row) return null;
  if (field === 'average') {
    const sum = valueFor(row, 'DishDiscountSumInt');
    const count = valueFor(row, 'UniqOrderId');
    return sum !== null && count !== null && count > 0 ? sum / count : null;
  }
  const raw = row[field];
  if (raw === null || raw === undefined || raw === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Aqtau',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function offsetDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function comparisonRange(from: string, to: string, comparison: string) {
  if (comparison === 'year') {
    const shift = (value: string) => {
      const [year, month, day] = value.split('-').map(Number);
      return `${year - 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, new Date(Date.UTC(year - 1, month, 0)).getUTCDate())).padStart(2, '0')}`;
    };
    return { from: shift(from), to: shift(to) };
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  return { from: offsetDate(from, -days), to: offsetDate(to, -days) };
}
export function validRange(from: string, to: string) {
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && days >= 0 && days <= 366
  );
}
export function errorKey(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === 'IIKO_REPORT_NOT_CONFIGURED') return 'id.notConfigured';
  if (code === 'IIKO_REPORT_ACCESS' || code === 'IIKO_REPORT_UNAVAILABLE') return 'id.unavailable';
  if (code === 'IIKO_REPORT_QUERY' || code === 'IIKO_REPORT_FIELD' || code === 'VALIDATION_ERROR')
    return 'id.invalidQuery';
  if (code === 'IIKO_REPORT_TOO_LARGE') return 'id.tooLarge';
  return 'id.error';
}
export function datedRows(report: Report) {
  if (!report.period || !validRange(report.period.from, report.period.to)) return report.rows;
  const rows = new Map(report.rows.map((row) => [String(row['OpenDate.Typed']).slice(0, 10), row]));
  const result: Record<string, unknown>[] = [];
  for (let date = report.period.from; date <= report.period.to; date = offsetDate(date, 1)) {
    result.push(rows.get(date) || { 'OpenDate.Typed': date });
  }
  return result;
}
export const salesFilters: Filter[] = [
  { field: 'OrderDeleted', values: ['NOT_DELETED'], exclude: false },
  { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'], exclude: false },
];

export type CashierPayrollPayment = {
  id: string;
  amount: number;
  registrations: number;
  paidAt: string;
  paidBy: string;
};

export type CashierPayrollRow = {
  rowKey: string;
  id: string;
  name: string;
  pointId: string | null;
  branchName: string;
  city: string;
  isArchived: boolean;
  completed: number;
  rewardAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  outstandingCount: number;
  snapshot: string;
  payments: CashierPayrollPayment[];
};

export type CashierPayrollResponse = {
  success: boolean;
  month: string;
  canMarkPaid: boolean;
  items: CashierPayrollRow[];
  totals: {
    completed: number;
    rewardAmount: number;
    paidAmount: number;
    outstandingAmount: number;
  };
};

export type PayrollFilters = { month: string; city: string; pointId: string; search: string };

export function validPayrollMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) > 0;
}

export function payrollPoints(rows: CashierPayrollRow[], city: string, unassignedLabel = 'Точка не указана') {
  const points = new Map<string, string>();
  for (const row of rows) {
    if (row.city === city) points.set(row.pointId || '__unassigned__', row.pointId ? row.branchName : unassignedLabel);
  }
  const names = new Map<string, number>();
  for (const name of points.values()) names.set(name, (names.get(name) || 0) + 1);
  return [...points].map(([id, label]) => ({
    id,
    label: (names.get(label) || 0) > 1 ? `${label} · № ${id}` : label,
  })).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function filterPayroll(rows: CashierPayrollRow[], filters: PayrollFilters) {
  const query = filters.search.trim().toLocaleLowerCase('ru');
  return rows.filter((row) =>
    (!filters.city || row.city === filters.city) &&
    (!filters.pointId || (filters.pointId === '__unassigned__' ? !row.pointId : row.pointId === filters.pointId)) &&
    (!query || `${row.name} ${row.id} ${row.branchName} ${row.city}`.toLocaleLowerCase('ru').includes(query)),
  ).sort((a, b) => a.name.localeCompare(b.name) || a.branchName.localeCompare(b.branchName) || a.rowKey.localeCompare(b.rowKey));
}

export function payrollTime(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-KZ', {
    timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

export function payrollMonthLabel(month: string, locale: string) {
  if (!validPayrollMonth(month)) return month;
  return new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-KZ', {
    month: 'long', year: 'numeric', timeZone: 'Asia/Almaty',
  }).format(new Date(`${month}-01T12:00:00+05:00`));
}

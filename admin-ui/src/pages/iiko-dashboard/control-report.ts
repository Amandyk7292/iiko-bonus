import type { Report } from './model';

export function controlReport(
  raw: Report,
  text: (key: string) => string,
  formatTime: (value: string) => string,
  include: (row: Record<string, unknown>) => boolean = () => true,
): Report {
  return {
    ...raw,
    columns: Object.fromEntries(
      Object.entries(raw.columns).map(([key, column]) => [key, { ...column, name: text(key) }]),
    ),
    rows: raw.rows.filter(include).map((row) => ({
      ...row,
      ...(raw.columns.Flags
        ? {
            Flags: String(row.Flags || '')
              .split('|')
              .filter(Boolean)
              .map(text)
              .join(' · '),
          }
        : {}),
      ...(raw.columns.Advice
        ? { Advice: text(String(row.Advice)), Pace: text(String(row.Pace)) }
        : {}),
      ...(raw.columns.Cashier ? { Cashier: row.Cashier || text('notSpecified') } : {}),
      ...(raw.columns.Reason
        ? {
            Reason: row.Reason || text('notSpecified'),
            Comment: row.Comment || text('notSpecified'),
          }
        : {}),
      ...(row.CloseTime ? { CloseTime: formatTime(String(row.CloseTime)) } : {}),
    })),
  };
}

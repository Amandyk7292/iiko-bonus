import { ApiError, request } from '../../lib/api';
import type { AnalyticsQuery } from './Rankings';
import type { Columns, Query, Report, Server } from './model';
const base = '/iiko-dashboard';
export const dashboardApi = {
  analytics: (query: AnalyticsQuery, signal?: AbortSignal) =>
    request<Report>(`${base}/analytics`, { method: 'POST', body: JSON.stringify(query), signal }),
  servers: () => request<{ servers: Server[] }>(`${base}/servers`),
  schema: (serverId: string, reportType: string, signal?: AbortSignal) =>
    request<{ columns: Columns; dateField: string }>(
      `${base}/schema?${new URLSearchParams({ serverId, reportType })}`,
      { signal },
    ),
  report: (query: Query, signal?: AbortSignal) =>
    request<Report>(`${base}/report`, { method: 'POST', body: JSON.stringify(query), signal }),
  balances: (serverId: string, date: string, signal?: AbortSignal) =>
    request<{
      rows: Record<string, unknown>[];
      products: Record<string, unknown>[];
      stores: { id: string; name: string }[];
      groups: { id: string; name: string; parent: string | null }[];
      fetchedAt: string;
    }>(`${base}/balances?${new URLSearchParams({ serverId, date })}`, { signal }),
};
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportReport(query: Query | AnalyticsQuery) {
  const response = await fetch(
    `/admin/api${base}/${'view' in query ? 'analytics/export' : 'export'}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError('', response.status, body.code);
  }
  download(await response.blob(), `iiko-${query.from}-${query.to}.xlsx`);
}

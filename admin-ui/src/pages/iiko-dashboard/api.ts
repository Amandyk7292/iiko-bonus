import { ApiError, request } from '../../lib/api';
import type { AnalyticsQuery } from './Rankings';
import type {
  Columns,
  ProductChoice,
  ProductSalesQuery,
  ProductSalesResult,
  Query,
  Report,
  Server,
  ServerMutation,
} from './model';
const base = '/iiko-dashboard';
export const dashboardApi = {
  analytics: (query: AnalyticsQuery, signal?: AbortSignal) =>
    request<Report>(`${base}/analytics`, { method: 'POST', body: JSON.stringify(query), signal }),
  productSearch: (serverId: string, search: string, signal?: AbortSignal) =>
    request<{ products: ProductChoice[] }>(
      `${base}/product-sales/products?${new URLSearchParams({ serverId, search })}`,
      { signal },
    ),
  productSales: (query: ProductSalesQuery, signal?: AbortSignal) =>
    request<ProductSalesResult>(`${base}/product-sales`, {
      method: 'POST',
      body: JSON.stringify(query),
      signal,
    }),
  servers: () => request<{ servers: Server[] }>(`${base}/servers`),
  departments: (serverId: string, signal?: AbortSignal) =>
    request<{ serverId: string; departments: { id: string; name: string }[] }>(
      `${base}/departments?${new URLSearchParams({ serverId })}`,
      { signal },
    ),
  saveServer: (server: ServerMutation) =>
    request<{ servers: Server[] }>(`${base}/servers`, {
      method: 'POST',
      body: JSON.stringify(server),
    }),
  deleteServer: (id: string) =>
    request<{ servers: Server[] }>(`${base}/servers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
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
declare global {
  interface Window {
    BulkaFileShare?: { shareFile(file: { name: string; base64: string }): Promise<void> };
  }
}
export async function download(blob: Blob, name: string) {
  if (window.BulkaFileShare) {
    if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error('Invalid export size');
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Could not read export'));
      reader.readAsDataURL(blob);
    });
    await window.BulkaFileShare.shareFile({ name, base64 });
    return;
  }
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
  await download(await response.blob(), `iiko-${query.from}-${query.to}.xlsx`);
}
export async function exportProductSales(query: ProductSalesQuery) {
  const response = await fetch(`/admin/api${base}/product-sales/export`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError('', response.status, body.code);
  }
  await download(await response.blob(), `iiko-product-sales-${query.from}-${query.to}.xlsx`);
}

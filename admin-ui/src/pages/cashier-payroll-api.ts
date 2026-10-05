import { ApiError, adminApiErrorMessage, applyAdminScopeHeaders, composeRequestAbortSignal } from '../lib/api';
import type { PayrollFilters } from './cashier-payroll-model';

async function downloadPayroll(blob: Blob, name: string, signal: AbortSignal) {
  if (signal.aborted) return;
  if (window.BulkaFileShare) {
    if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error('Invalid export size');
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Could not read export'));
      reader.readAsDataURL(blob);
    });
    if (signal.aborted) return;
    await window.BulkaFileShare.shareFile({ name, base64 });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportCashierPayroll(filters: PayrollFilters, scope: string, signal: AbortSignal) {
  const query = new URLSearchParams({ month: filters.month });
  if (filters.city) query.set('city', filters.city);
  if (filters.pointId) query.set('pointId', filters.pointId);
  if (filters.search.trim()) query.set('search', filters.search.trim());
  const endpoint = `/bonus/cashier-payroll/export?${query}`;
  const headers = new Headers({ Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  applyAdminScopeHeaders(headers, endpoint, scope);
  const requestAbort = composeRequestAbortSignal(signal, 90_000);
  try {
    const response = await fetch(`/admin/api${endpoint}`, {
      credentials: 'same-origin', headers, signal: requestAbort.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) window.dispatchEvent(new Event('unauthorized'));
      throw new ApiError(adminApiErrorMessage(body, response.status), response.status, body.code);
    }
    if (!response.headers.get('Content-Type')?.includes('spreadsheetml.sheet')) {
      throw new ApiError('Не удалось скачать Excel', 502, 'INVALID_XLSX_RESPONSE');
    }
    const blob = await response.blob();
    if (requestAbort.signal.aborted) return;
    if (!blob.size) throw new ApiError('Не удалось скачать Excel', 502, 'INVALID_XLSX_RESPONSE');
    await downloadPayroll(blob, `bulka-cashier-payroll-${filters.month}.xlsx`, requestAbort.signal);
  } finally {
    requestAbort.cleanup();
  }
}

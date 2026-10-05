import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportCashierPayroll } from './cashier-payroll-api';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('xlsx-binary', {
    status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  })));
  URL.createObjectURL = vi.fn(() => 'blob:payroll');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('authenticated cashier payroll XLSX download', () => {
  it('sends exact trimmed filters, cookies and authorized global branch scope and downloads the server XLSX blob', async () => {
    await exportCashierPayroll({ month: '2026-10', city: 'Актау', pointId: '__unassigned__', search: ' Алия ' }, 'branch-global', new AbortController().signal);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    const parsed = new URL(String(url), 'https://bulka.com.kz');
    expect(parsed.pathname).toBe('/admin/api/bonus/cashier-payroll/export');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ month: '2026-10', city: 'Актау', pointId: '__unassigned__', search: 'Алия' });
    expect(options?.credentials).toBe('same-origin');
    expect(new Headers(options?.headers).get('X-Bulka-Branch-Id')).toBe('branch-global');
    expect(new Headers(options?.headers).get('Accept')).toContain('spreadsheetml');
    expect(vi.mocked(URL.createObjectURL).mock.calls[0][0]).toHaveProperty('size', 11);
    const click = vi.mocked(HTMLAnchorElement.prototype.click);
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('bulka-cashier-payroll-2026-10.xlsx');
  });

  it('omits empty filters and does not download a rejected API response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Нет доступа', code: 'FORBIDDEN' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    }));
    await expect(exportCashierPayroll({ month: '2026-10', city: '', pointId: '', search: ' ' }, '', new AbortController().signal)).rejects.toMatchObject({ status: 403 });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/admin/api/bonus/cashier-payroll/export?month=2026-10');
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it('does not save a stale download after its filter scope was aborted', async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementationOnce(async () => {
      controller.abort();
      return new Response('xlsx-binary', { status: 200,
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
    });
    await exportCashierPayroll({ month: '2026-10', city: '', pointId: '', search: '' }, '', controller.signal);
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('rejects a successful HTML or JSON fallback instead of saving it as an XLSX file', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>Login</html>', { status: 200,
      headers: { 'Content-Type': 'text/html' } }));
    await expect(exportCashierPayroll({ month: '2026-10', city: '', pointId: '', search: '' }, '', new AbortController().signal))
      .rejects.toMatchObject({ code: 'INVALID_XLSX_RESPONSE' });
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
});

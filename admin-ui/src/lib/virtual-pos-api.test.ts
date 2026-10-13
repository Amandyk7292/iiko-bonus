import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

const branchId = '11111111-1111-4111-8111-111111111111';
const requestId = '33333333-3333-4333-8333-333333333333';
const sale = {
  requestId, terminalId: 'terminal', snapshotRevision: 'revision', cashShiftId: 'shift',
  paymentTypeId: 'cash', items: [{ productId: 'bun', quantity: 1 }], expectedTotal: 500,
};
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('pins every POS request to its explicit branch despite shared admin scope changes', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ sale: { id: requestId } }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  localStorage.setItem('adminSelectedBranchId', '22222222-2222-4222-8222-222222222222');
  await api.getVirtualPosCatalog(branchId);
  localStorage.setItem('adminSelectedBranchId', '44444444-4444-4444-8444-444444444444');
  await api.createVirtualPosSale(branchId, sale);
  await api.getVirtualPosSale(branchId, requestId);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  for (const [, options] of fetchMock.mock.calls) {
    expect((options.headers as Headers).get('X-Bulka-Branch-Id')).toBe(branchId);
    expect((options.headers as Headers).has('X-Bulka-Branch-Ids')).toBe(false);
  }
  expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify(sale));
});

it('preserves only an explicit server declaration of safe preflight rejection', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: 'Смена изменилась', code: 'VIRTUAL_POS_SHIFT_CHANGED', safelyRejected: true,
  }), { status: 409, headers: { 'Content-Type': 'application/json' } })));
  await expect(api.createVirtualPosSale(branchId, sale)).rejects.toMatchObject({ status: 409, safelyRejected: true });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  try { await api.createVirtualPosSale(branchId, sale); } catch (caught) {
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 0, safelyRejected: false });
  }
});

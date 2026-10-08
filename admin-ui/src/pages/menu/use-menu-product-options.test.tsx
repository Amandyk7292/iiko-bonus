import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMenuProductOptions } from './use-menu-product-options';
const api = vi.hoisted(() => ({ getProductOptions: vi.fn(), saveProductOptions: vi.fn() }));
vi.mock('../../lib/api', () => ({ api }));
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); api.saveProductOptions.mockResolvedValue({ success: true }); });
const pending = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((res) => { resolve = res; });
  return { resolve, promise };
};
const options = (kind: string, minLeadHours: number) => ({ configuration: {
  productKind: kind, enabled: true, minLeadHours, maxAdvanceDays: 30,
  weightOptions: [], fillingOptions: [], designOptions: [],
}, modifierGroups: [] });
it('blocks saving until existing options load, then preserves the loaded cake', async () => {
  const load = pending(); api.getProductOptions.mockReturnValue(load.promise);
  const { result } = renderHook(() => useMenuProductOptions(vi.fn()));
  let opening: Promise<void>;
  act(() => { opening = result.current.openOptionsModal({ id: 'cake-A', name: 'Cake A', price: 1000 }); });
  expect(result.current.optionsProduct?.id).toBe('cake-A');
  expect(result.current.optionsLoading).toBe(true);
  await act(async () => { await result.current.saveOptions(); });
  expect(api.saveProductOptions).not.toHaveBeenCalled();
  await act(async () => { load.resolve({ products: { 'cake-A': options('cake', 24) } }); await opening!; });
  expect(result.current.optionsLoading).toBe(false);
  await act(async () => { await result.current.saveOptions(); });
  expect(api.saveProductOptions).toHaveBeenCalledWith('cake-A', expect.objectContaining({
    configuration: expect.objectContaining({ productKind: 'cake', minLeadHours: 24 }), modifierGroups: [],
  }));
});
it('ignores late product A options after closing A and opening B', async () => {
  const loadA = pending(); const loadB = pending();
  api.getProductOptions.mockImplementation((id) => id === 'cake-A' ? loadA.promise : loadB.promise);
  const { result } = renderHook(() => useMenuProductOptions(vi.fn()));
  let openingA: Promise<void>; let openingB: Promise<void>;
  act(() => { openingA = result.current.openOptionsModal({ id: 'cake-A', name: 'Cake A', price: 1000 }); });
  act(() => { result.current.setOptionsProduct(null); });
  act(() => { openingB = result.current.openOptionsModal({ id: 'cake-B', name: 'Cake B', price: 2000 }); });
  await act(async () => { loadB.resolve({ products: { 'cake-B': options('bakery', 3) } }); await openingB!; });
  expect(result.current.optionsDraft.configuration.minLeadHours).toBe(3);
  await act(async () => { loadA.resolve({ products: { 'cake-A': options('cake', 24) } }); await openingA!; });
  expect(result.current.optionsProduct?.id).toBe('cake-B');
  expect(result.current.optionsDraft.configuration.minLeadHours).toBe(3);
  await act(async () => { await result.current.saveOptions(); });
  expect(api.saveProductOptions).toHaveBeenCalledWith('cake-B', expect.objectContaining({
    configuration: expect.objectContaining({ productKind: 'bakery', minLeadHours: 3 }),
  }));
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
import { useMenuPageController } from './use-menu-page-controller';

const mocks = vi.hoisted(() => ({
  getAdminMenu: vi.fn(), setProductOverride: vi.fn(),
  t: (key: string) => key, toast: vi.fn(), confirm: vi.fn(), setParams: vi.fn(),
}));
vi.mock('../../lib/api', () => ({ api: mocks }));
vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: mocks.t }) }));
vi.mock('../../components/Feedback', () => ({ useFeedback: () => mocks }));
vi.mock('../../lib/router', () => ({ useSearchParams: () => [new URLSearchParams(), mocks.setParams] }));

beforeEach(() => vi.clearAllMocks());

it('persists reset after reload and follows subsequent iiko price changes', async () => {
  let price = 300;
  const stored: Record<string, unknown> = {
    iiko_product_id: 'p', custom_price: 500, custom_name: 'Ручное название',
    custom_image_url: 'https://example.com/manual.webp',
  };
  mocks.getAdminMenu.mockImplementation(async () => ({
    rawMenu: { products: [{ id: 'p', name: 'Товар', price }], groups: [] },
    overrides: { products: [stored], categories: [], customProducts: [] },
  }));
  mocks.setProductOverride.mockImplementation(async (_id, patch) => {
    Object.assign(stored, patch);
    return { success: true };
  });
  const { result } = renderHook(() => useMenuPageController({
    scopeLocations: [], selectedBranchId: 'branch', onBranchChange: vi.fn(),
  }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.openEditModal({ id: 'p', name: 'Товар', price }));
  expect(result.current.editForm.price).toBe(500);
  act(() => result.current.setEditForm((current) => ({ ...current, price: 300, name: 'Товар', imageUrl: '' })));
  await act(async () => result.current.handleSaveProductEdit({ preventDefault() {} } as FormEvent));
  expect(mocks.setProductOverride).toHaveBeenCalledWith('p', expect.objectContaining({
    custom_price: null, custom_name: null, custom_image_url: null,
  }));
  await act(async () => result.current.fetchMenu());
  act(() => result.current.openEditModal({ id: 'p', name: 'Товар', price }));
  expect(result.current.editForm.price).toBe(300);
  expect(result.current.editForm.name).toBe('Товар');
  expect(result.current.editForm.imageUrl).toBe('');
  price = 350;
  await act(async () => result.current.fetchMenu());
  act(() => result.current.openEditModal({ id: 'p', name: 'Товар', price }));
  expect(result.current.editForm.price).toBe(350);
});

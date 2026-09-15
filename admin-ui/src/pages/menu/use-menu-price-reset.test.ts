import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
import { useMenuPageController } from './use-menu-page-controller';

const mocks = vi.hoisted(() => ({
  getAdminMenu: vi.fn(),
  setProductOverride: vi.fn(),
  t: (key: string) => key,
  toast: vi.fn(),
  confirm: vi.fn(),
  setParams: vi.fn(),
}));
vi.mock('../../lib/api', () => ({ api: mocks }));
vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: mocks.t }) }));
vi.mock('../../components/Feedback', () => ({ useFeedback: () => mocks }));
vi.mock('../../components/MenuPhotoUploads', () => ({
  useMenuPhotoUploads: () => ({ jobs: [], enqueue: vi.fn() }),
}));
vi.mock('../../lib/admin-realtime', () => ({ useAdminRealtimeEvents: vi.fn() }));
vi.mock('../../lib/router', () => ({
  useSearchParams: () => [new URLSearchParams(), mocks.setParams],
}));

beforeEach(() => vi.clearAllMocks());

it('an earlier menu response cannot replace the newly uploaded photo', async () => {
  let finishOld!: (data: unknown) => void;
  const menu = (url: string) => ({
    rawMenu: { products: [], groups: [] },
    overrides: { products: [{ iiko_product_id: 'p', custom_image_url: url }] },
  });
  mocks.getAdminMenu
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    )
    .mockResolvedValueOnce(menu('https://example.com/new.jpg'));
  const { result } = renderHook(() =>
    useMenuPageController({ scopeLocations: [], selectedBranchId: 'a', onBranchChange: vi.fn() }),
  );
  await act(async () => result.current.fetchMenu(true));
  await act(async () => finishOld(menu('https://example.com/old.jpg')));
  expect(result.current.productOverrides.p.custom_image_url).toBe('https://example.com/new.jpg');
  expect(result.current.loading).toBe(false);
});

it('a response from the previous city cannot overwrite the current menu', async () => {
  let finishOld!: (data: unknown) => void;
  mocks.getAdminMenu
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    )
    .mockResolvedValueOnce({
      rawMenu: { products: [{ id: 'b', name: 'Город Б' }] },
      profileKey: 'astana',
    });
  const { result, rerender } = renderHook(
    ({ branch }) =>
      useMenuPageController({
        scopeLocations: [],
        selectedBranchId: branch,
        onBranchChange: vi.fn(),
      }),
    { initialProps: { branch: 'a' } },
  );
  rerender({ branch: 'b' });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () =>
    finishOld({ rawMenu: { products: [{ id: 'a', name: 'Город А' }] }, profileKey: 'default' }),
  );
  expect(result.current.activeProfileKey).toBe('astana');
  expect(result.current.rawProducts[0].id).toBe('b');
});

it('a price edit preserves fields changed by another administrator', async () => {
  const stored: Record<string, unknown> = {
    iiko_product_id: 'p',
    is_stop_listed: false,
    is_hidden: false,
    custom_description: 'Old description',
  };
  mocks.getAdminMenu.mockImplementation(async () => ({
    rawMenu: { products: [{ id: 'p', name: 'Товар', price: 300 }], groups: [] },
    overrides: { products: [structuredClone(stored)], categories: [], customProducts: [] },
  }));
  mocks.setProductOverride.mockImplementation(async (_id, patch) => {
    Object.assign(stored, patch);
    return { success: true };
  });
  const { result } = renderHook(() =>
    useMenuPageController({
      scopeLocations: [],
      selectedBranchId: 'branch',
      onBranchChange: vi.fn(),
    }),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.openEditModal({ id: 'p', name: 'Товар', price: 300 }));
  Object.assign(stored, {
    is_stop_listed: true,
    is_hidden: true,
    custom_description: 'New description',
  });
  act(() => result.current.setEditForm((current) => ({ ...current, price: 350 })));
  await act(async () => result.current.handleSaveProductEdit({ preventDefault() {} } as FormEvent));
  expect(mocks.setProductOverride).toHaveBeenCalledWith('p', { custom_price: 350 });
  expect(result.current.productOverrides.p).toMatchObject({
    custom_price: 350,
    is_stop_listed: true,
    is_hidden: true,
    custom_description: 'New description',
  });
});

it('persists reset after reload and follows subsequent iiko price changes', async () => {
  let price = 300;
  const stored: Record<string, unknown> = {
    iiko_product_id: 'p',
    custom_price: 500,
    custom_name: 'Ручное название',
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
  const { result } = renderHook(() =>
    useMenuPageController({
      scopeLocations: [],
      selectedBranchId: 'branch',
      onBranchChange: vi.fn(),
    }),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.openEditModal({ id: 'p', name: 'Товар', price }));
  expect(result.current.editForm.price).toBe(500);
  act(() =>
    result.current.setEditForm((current) => ({
      ...current,
      price: 300,
      name: 'Товар',
      imageUrl: '',
    })),
  );
  await act(async () => result.current.handleSaveProductEdit({ preventDefault() {} } as FormEvent));
  expect(mocks.setProductOverride).toHaveBeenCalledWith(
    'p',
    expect.objectContaining({
      custom_price: null,
      custom_name: null,
      custom_image_url: null,
    }),
  );
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

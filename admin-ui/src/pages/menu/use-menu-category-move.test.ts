import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useMenuCategoryMove } from './use-menu-category-move';
import { moveMenuProducts } from './menu-category-api';
import type { ProductOverride } from './menu-page.shared';
vi.mock('./menu-category-api', () => ({ moveMenuProducts: vi.fn() }));
vi.mock('../../components/Feedback', () => ({ useFeedback: () => ({ toast: vi.fn() }) }));
beforeEach(() => vi.clearAllMocks());
const setup = () =>
  renderHook(
    ({ scope }) => {
      const [overrides, setOverrides] = useState<Record<string, ProductOverride>>({
        a: { iiko_product_id: 'a', custom_price: 350 },
      });
      return { move: useMenuCategoryMove(scope, 'default', setOverrides), overrides };
    },
    { initialProps: { scope: 'aktau' } },
  );

it('moves selected products together and preserves custom price', async () => {
  vi.mocked(moveMenuProducts).mockResolvedValue({ success: true, productIds: ['a', 'b'] });
  const { result } = setup();
  act(() => result.current.move.toggleProduct('a'));
  act(() => result.current.move.toggleProduct('b'));
  await act(() => result.current.move.moveProducts('bread'));
  expect(moveMenuProducts).toHaveBeenCalledWith(['a', 'b'], 'bread', 'default');
  expect(result.current.overrides.a).toMatchObject({
    custom_price: 350,
    custom_category_id: 'bread',
  });
  expect(result.current.move.selectedIds).toEqual([]);
});

it('retains selection on failure, allowing retry', async () => {
  vi.mocked(moveMenuProducts).mockRejectedValue(new Error('offline'));
  const { result } = setup();
  act(() => result.current.move.toggleProduct('a'));
  await act(() => result.current.move.moveProducts('bread'));
  expect(result.current.move.selectedIds).toEqual(['a']);
  expect(result.current.overrides.a.custom_category_id).toBeUndefined();
});

it('clears selection on city changes, including switching back', () => {
  const { result, rerender } = setup();
  act(() => result.current.move.toggleProduct('a'));
  rerender({ scope: 'astana' });
  expect(result.current.move.selectedIds).toEqual([]);
  rerender({ scope: 'aktau' });
  expect(result.current.move.selectedIds).toEqual([]);
});

it('does not apply a delayed move response to another city', async () => {
  let resolve!: (result: { success: boolean; productIds: string[] }) => void;
  vi.mocked(moveMenuProducts).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result, rerender } = setup();
  act(() => result.current.move.toggleProduct('a'));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.move.moveProducts('bread');
  });
  rerender({ scope: 'astana' });
  await act(async () => {
    resolve({ success: true, productIds: ['a'] });
    await pending;
  });
  expect(result.current.overrides.a.custom_category_id).toBeUndefined();
});

import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import ProductInventoryUnit, { type ProductInventoryUnitHandle } from './ProductInventoryUnit';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../lib/api', () => ({ request: mocks.request }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ unit: 'шт', configured: true, canEdit: true });
});

async function open() {
  const user = userEvent.setup();
  const ref = createRef<ProductInventoryUnitHandle>();
  const onSaved = vi.fn();
  render(<ProductInventoryUnit ref={ref} productId="product/one" onSaved={onSaved} />);
  await user.click(screen.getByText(/Учёт количества/));
  await screen.findByRole('button', { name: 'Килограммы' });
  return { user, ref, onSaved };
}

it('uses the shared setting and saves only a changed unit through the editor save action', async () => {
  const { user, ref, onSaved } = await open();
  expect(mocks.request).toHaveBeenCalledWith('/menu/inventory-units/product%2Fone');
  await act(async () => {
    expect(await ref.current!.saveIfChanged()).toBe(true);
  });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Килограммы' }));
  await act(async () => {
    expect(await ref.current!.saveIfChanged()).toBe(true);
  });
  expect(mocks.request).toHaveBeenLastCalledWith('/menu/inventory-units/product%2Fone', {
    method: 'PUT',
    body: '{"unit":"кг"}',
  });
  expect(onSaved).toHaveBeenCalledOnce();
});

it('keeps a rejected unit draft open and prevents the editor from closing', async () => {
  const { user, ref } = await open();
  await user.click(screen.getByRole('button', { name: 'Килограммы' }));
  mocks.request.mockRejectedValueOnce(new Error('Сначала исправьте остатки'));
  await act(async () => {
    expect(await ref.current!.saveIfChanged()).toBe(false);
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Сначала исправьте остатки');
  expect(screen.getByRole('button', { name: 'Килограммы' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

it('offers no changes to users without global administration access', async () => {
  mocks.request.mockResolvedValue({ unit: 'кг', configured: true, canEdit: false });
  const { ref } = await open();
  expect(screen.getByRole('button', { name: 'Штуки' })).toBeDisabled();
  await act(async () => {
    expect(await ref.current!.saveIfChanged()).toBe(true);
  });
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

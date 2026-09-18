import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import InventoryPage from './InventoryPage';

const mocks = vi.hoisted(() => ({
  getInventory: vi.fn(),
  getFulfillmentLocations: vi.fn(),
  updateInventory: vi.fn(),
  syncInventory: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('../lib/api', () => ({ api: mocks }));
vi.mock('../lib/admin-realtime', () => ({ useAdminRealtimeEvents: vi.fn() }));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

const item = {
  branch_id: 'branch-1',
  product_id: 'coffee',
  product_name: 'Кофе Американо',
  source_quantity: 5,
  manual_stop: false,
  source: 'admin',
  quantity_step: 1,
  bulka_locations: { name: 'Астана' },
};
const page = (role = 'admin') => (
  <BrowserRouter>
    <I18nProvider>
      <InventoryPage role={role} />
    </I18nProvider>
  </BrowserRouter>
);

beforeEach(() => {
  window.history.replaceState({}, '', '/admin/inventory');
  localStorage.setItem('adminLocale', 'ru');
  mocks.getInventory.mockReset().mockResolvedValue({ inventory: [item] });
  mocks.getFulfillmentLocations
    .mockReset()
    .mockResolvedValue({ locations: [{ id: 'branch-1', name: 'Астана', active: true }] });
  mocks.updateInventory
    .mockReset()
    .mockResolvedValue({ inventory: { ...item, source_quantity: 7 } });
  mocks.toast.mockReset();
});

it('shows loading while inventory is being requested', () => {
  mocks.getInventory.mockReturnValue(new Promise(() => {}));
  render(page());
  expect(screen.getByRole('status')).toBeInTheDocument();
});

it('loads, filters, edits and saves inventory', async () => {
  render(page());
  const quantity = await screen.findByRole('spinbutton', { name: 'Остаток' });
  fireEvent.change(quantity, { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(mocks.updateInventory).toHaveBeenCalledWith('branch-1', 'coffee', {
      productName: 'Кофе Американо',
      sourceQuantity: 7,
      manualStop: false,
    }),
  );
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'нет товара' } });
  expect(await screen.findByText('Остатков пока нет')).toBeInTheDocument();
});

it('shows loading failures and keeps viewer inputs read-only', async () => {
  mocks.getInventory.mockRejectedValueOnce(new Error('offline'));
  const view = render(page());
  expect(await screen.findByText('offline')).toBeInTheDocument();
  view.unmount();
  mocks.getInventory.mockResolvedValue({ inventory: [item] });
  render(page('viewer'));
  expect(await screen.findByRole('spinbutton', { name: 'Остаток' })).toBeDisabled();
});

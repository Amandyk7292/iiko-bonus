import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import CustomersPage from './CustomersPage';
const api = vi.hoisted(() => ({ getCustomers: vi.fn(), deleteCustomer: vi.fn() }));
vi.mock('../lib/api', async (original) => ({ ...(await original<any>()), api }));
vi.mock('../lib/admin-realtime', () => ({ useAdminRealtimeEvents: vi.fn() }));
vi.mock('../components/Feedback', () => ({ useFeedback: () => ({ toast: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }) }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); localStorage.setItem('adminLocale', 'ru');
  window.history.replaceState({}, '', '/customers?page=2');
  api.getCustomers.mockResolvedValueOnce({ customers: [{ id: 'last-row', name: 'Последний клиент', phone: '+77000000000', balance: 0 }], total: 51 })
    .mockResolvedValue({ customers: [{ id: 'remaining', name: 'Оставшийся клиент', phone: '+77000000001', balance: 0 }], total: 50 });
  api.deleteCustomer.mockResolvedValue({ success: true });
});
it('deleting the only customer on the final page loads the last valid page', async () => {
  const user = userEvent.setup();
  const view = render(<BrowserRouter><I18nProvider><CustomersPage user={{ actions: ['customers:read', 'customers:delete'] } as any} /></I18nProvider></BrowserRouter>);
  await screen.findByText('Последний клиент');
  expect(view.container.querySelector('.table-pagination')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Удалить' }));
  await waitFor(() => expect(screen.queryByText('Последний клиент')).toBeNull());
  await screen.findByText('Оставшийся клиент');
  expect(window.location.search).toBe('');
  expect(api.getCustomers).toHaveBeenCalledTimes(2);
  expect(api.getCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }), expect.any(AbortSignal));
});

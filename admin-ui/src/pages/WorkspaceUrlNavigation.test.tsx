import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter, Link } from '../lib/router';
import CustomersPage from './CustomersPage';
import OrdersPage from './OrdersPage';
const api = vi.hoisted(() => ({ getCustomers: vi.fn(), getOrders: vi.fn() }));
vi.mock('../lib/api', async (original) => ({ ...(await original<any>()), api }));
vi.mock('../lib/admin-realtime', () => ({ useAdminRealtimeEvents: vi.fn() }));
vi.mock('../components/Feedback', () => ({ useFeedback: () => ({ toast: vi.fn(), confirm: vi.fn() }) }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); localStorage.setItem('adminLocale', 'ru');
  api.getCustomers.mockResolvedValue({ customers: [], total: 0 });
  api.getOrders.mockResolvedValue({ orders: [], total: 0 });
});
it.each(['orders', 'customers'] as const)('preserves typed whitespace in %s while adopting history navigation', async (page) => {
  const user = userEvent.setup();
  window.history.replaceState({}, '', `/${page}`);
  render(<BrowserRouter><I18nProvider>
    {page === 'orders' ? <OrdersPage role="viewer" /> : <CustomersPage user={null} />}
  </I18nProvider></BrowserRouter>);
  const input = await screen.findByRole('searchbox');
  await user.type(input, '  customer ');
  expect((input as HTMLInputElement).value).toBe('  customer ');
  expect(new URLSearchParams(window.location.search).get('search')).toBe('customer');
  const getRows = page === 'orders' ? api.getOrders : api.getCustomers;
  await waitFor(() => expect(getRows.mock.calls.at(-1)?.[0].search).toBe('  customer '));
  await act(async () => {
    window.history.replaceState({}, '', `/${page}?search=history&page=2`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await waitFor(() => expect(getRows.mock.calls.at(-1)?.[0]).toMatchObject({ search: 'history', page: 2 }));
  expect((input as HTMLInputElement).value).toBe('history');
  expect(window.location.search).toBe('?search=history&page=2');
});
it.each(['orders', 'customers'] as const)('adopts a same-route %s workspace link and loads its search', async (page) => {
  const user = userEvent.setup();
  window.history.replaceState({}, '', `/${page}?search=100`);
  render(<BrowserRouter><I18nProvider>
    <Link to={`/${page}?search=200`}>Открыть в разделе</Link>
    {page === 'orders' ? <OrdersPage role="viewer" /> : <CustomersPage user={null} />}
  </I18nProvider></BrowserRouter>);
  const getRows = page === 'orders' ? api.getOrders : api.getCustomers;
  await waitFor(() => expect(getRows).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('link', { name: 'Открыть в разделе' }));
  await waitFor(() => expect(getRows).toHaveBeenCalledTimes(2));
  expect(window.location.search).toBe('?search=200');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('200');
  expect(getRows.mock.calls[1][0].search).toBe('200');
});

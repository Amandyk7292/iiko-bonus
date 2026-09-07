import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import type { AdminUser } from '../lib/api';
import CustomersPage from './CustomersPage';

const api = vi.hoisted(() => ({ getCustomers: vi.fn(), addCustomerBonus: vi.fn() }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../lib/admin-realtime', () => ({ useAdminRealtimeEvents: vi.fn() }));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));
const customer = { id: 'test', name: 'Гость', balance: 100, bonus_expiration_enabled: false };
const show = () =>
  render(
    <BrowserRouter>
      <I18nProvider>
        <CustomersPage user={{ actions: ['customers:adjust-bonus'] } as AdminUser} />
      </I18nProvider>
    </BrowserRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.getCustomers.mockResolvedValue({ customers: [customer], total: 1 });
  api.addCustomerBonus.mockResolvedValue({ success: true });
});

it('shows disabled expiration and sends a negative adjustment through the explicit deduct action', async () => {
  const user = userEvent.setup();
  show();
  expect(await screen.findByText('Сгорание выключено')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Изменить бонусы' }));
  await user.selectOptions(screen.getByLabelText('Действие'), 'subtract');
  await user.type(screen.getByLabelText(/Сумма бонусов/), '25');
  expect(screen.getByText('Баланс после изменения: 75')).toBeInTheDocument();
  await user.type(screen.getByLabelText(/Причина/), 'Исправление ошибки');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(api.addCustomerBonus).toHaveBeenCalledWith('test', -25, 'Исправление ошибки'),
  );
});

it('shows the saved expiry date beside a positive balance', async () => {
  api.getCustomers.mockResolvedValue({
    customers: [
      { ...customer, bonus_expiration_enabled: true, bonus_expires_at: '2026-10-30T12:00:00Z' },
    ],
    total: 1,
  });
  show();
  expect(await screen.findByText(/Сгорание:.*2026/)).toBeInTheDocument();
  expect(screen.queryByText('Сгорание выключено')).not.toBeInTheDocument();
});

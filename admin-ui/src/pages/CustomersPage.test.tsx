import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import { ApiError, type AdminUser } from '../lib/api';
import CustomersPage from './CustomersPage';

const api = vi.hoisted(() => ({ getCustomers: vi.fn(), addCustomerBonus: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api,
}));
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
  localStorage.clear();
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
    expect(api.addCustomerBonus).toHaveBeenCalledWith(
      'test',
      -25,
      'Исправление ошибки',
      expect.any(String),
      '',
    ),
  );
});

it('restores an ambiguous adjustment after closing the form and reuses its identity and payload', async () => {
  const user = userEvent.setup();
  api.addCustomerBonus
    .mockRejectedValueOnce(new Error('Response lost'))
    .mockResolvedValueOnce({ success: true });
  const view = show();
  await user.click(await screen.findByRole('button', { name: 'Изменить бонусы' }));
  await user.type(screen.getByLabelText(/Сумма бонусов/), '25');
  await user.type(screen.getByLabelText(/Причина/), 'Исправление ошибки');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByText('Response lost')).toBeVisible();
  const first = api.addCustomerBonus.mock.calls[0];
  expect(screen.getByLabelText(/Сумма бонусов/)).toBeDisabled();
  view.unmount();
  show();
  await user.click(await screen.findByRole('button', { name: 'Изменить бонусы' }));
  expect(screen.getByLabelText(/Сумма бонусов/)).toHaveValue(25);
  expect(screen.getByLabelText(/Причина/)).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(api.addCustomerBonus).toHaveBeenCalledTimes(2));
  expect(api.addCustomerBonus.mock.calls[1]).toEqual(first);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'Изменить бонусы' }));
  expect(screen.getByLabelText(/Сумма бонусов/)).not.toBeDisabled();
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

it('allows correction after a definite validation rejection of the first attempt', async () => {
  const user = userEvent.setup();
  api.addCustomerBonus.mockRejectedValueOnce(
    new ApiError('Invalid amount', 400, 'VALIDATION_ERROR'),
  );
  show();
  await user.click(await screen.findByRole('button', { name: 'Изменить бонусы' }));
  await user.type(screen.getByLabelText(/Сумма бонусов/), '25');
  await user.type(screen.getByLabelText(/Причина/), 'Исправление ошибки');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByText('Invalid amount')).toBeVisible();
  expect(screen.getByLabelText(/Сумма бонусов/)).not.toBeDisabled();
  await user.clear(screen.getByLabelText(/Сумма бонусов/));
  await user.type(screen.getByLabelText(/Сумма бонусов/), '20');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(api.addCustomerBonus).toHaveBeenCalledTimes(2));
  expect(api.addCustomerBonus.mock.calls[1][3]).not.toBe(api.addCustomerBonus.mock.calls[0][3]);
});

it('retains a pending identity when a later retry is denied and when the branch changes', async () => {
  const user = userEvent.setup();
  localStorage.setItem('adminSelectedBranchId', 'branch-one');
  api.addCustomerBonus
    .mockRejectedValueOnce(new Error('Response lost'))
    .mockRejectedValueOnce(new ApiError('Access denied', 403));
  show();
  await user.click(await screen.findByRole('button', { name: 'Изменить бонусы' }));
  await user.type(screen.getByLabelText(/Сумма бонусов/), '25');
  await user.type(screen.getByLabelText(/Причина/), 'Исправление ошибки');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByText('Response lost')).toBeVisible();
  localStorage.setItem('adminSelectedBranchId', 'branch-two');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByText(/Вернитесь к филиалу/)).toBeVisible();
  expect(api.addCustomerBonus).toHaveBeenCalledTimes(1);
  localStorage.setItem('adminSelectedBranchId', 'branch-one');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByText('Access denied')).toBeVisible();
  expect(screen.getByLabelText(/Сумма бонусов/)).toBeDisabled();
  expect(api.addCustomerBonus.mock.calls[1]).toEqual(api.addCustomerBonus.mock.calls[0]);
});

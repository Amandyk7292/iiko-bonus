import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import DeliveryBudget from './DeliveryBudget';
import { I18nProvider } from '../lib/i18n';

const mocks = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));
vi.mock('../lib/api', () => ({ request: mocks.request }));
vi.mock('./Feedback', () => ({ useFeedback: () => mocks }));
const renderBudget = () =>
  render(
    <I18nProvider>
      <DeliveryBudget />
    </I18nProvider>,
  );
const balance = {
  balance: 5000,
  reserved: 1500,
  available: 3500,
  bufferPercent: 50,
  revision: 3,
  attentionCount: 0,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockResolvedValue(balance);
});

it('shows only the available budget after existing commitments', async () => {
  renderBudget();
  const card = await screen.findByRole('region', { name: 'Бюджет доставки' });
  expect(card).toHaveTextContent(/Остаток: 5\s000 ₸/);
  expect(card).toHaveTextContent(/В резерве: 1\s500 ₸/);
  expect(card).toHaveTextContent(/Доступно: 3\s500 ₸/);
});

it('requires credited-funds confirmation and sends the displayed revision', async () => {
  renderBudget();
  await userEvent.click(await screen.findByRole('button', { name: 'Учесть пополнение' }));
  const dialog = within(screen.getByRole('dialog'));
  await userEvent.type(dialog.getByRole('spinbutton'), '2000');
  expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await userEvent.click(dialog.getByRole('checkbox'));
  await userEvent.click(dialog.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  const body = JSON.parse(mocks.request.mock.calls[1][1].body);
  expect(body).toMatchObject({ revision: 3, amount: 2000, mode: 'top_up', confirmed: true });
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
});

it('a failed top-up keeps the same idempotency key for a deliberate retry', async () => {
  renderBudget();
  await userEvent.click(await screen.findByRole('button', { name: 'Учесть пополнение' }));
  await userEvent.type(screen.getByRole('spinbutton'), '2000');
  await userEvent.click(screen.getByRole('checkbox'));
  mocks.request.mockRejectedValueOnce(new Error('Ответ потерян'));
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Ответ потерян', 'error'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  const writes = mocks.request.mock.calls.filter((args) => args[1]?.method === 'PUT');
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes[0][1].body).requestId).toBe(JSON.parse(writes[1][1].body).requestId);
});

it('hides financial controls when access is denied', async () => {
  mocks.request.mockRejectedValue(new Error('Forbidden'));
  renderBudget();
  await waitFor(() => expect(mocks.request).toHaveBeenCalled());
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});

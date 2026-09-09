import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import DeliveryAvailabilityNotice from './DeliveryAvailabilityNotice';

const mocks = vi.hoisted(() => ({
  getDeliveryAvailability: vi.fn(),
  resumeDelivery: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../lib/api', () => ({ api: mocks }));
vi.mock('./Feedback', () => ({ useFeedback: () => mocks }));
const blocked = {
  config: { disabled: true, reason: 'insufficient_funds', revision: 'funds-error-v1' },
  canResume: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDeliveryAvailability.mockResolvedValue(blocked);
  mocks.confirm.mockResolvedValue(true);
});

it('cashier sees the shared delivery warning but cannot resume delivery', async () => {
  mocks.getDeliveryAvailability.mockResolvedValue({ ...blocked, canResume: false });
  render(<DeliveryAvailabilityNotice />);
  expect(
    await screen.findByText('Доставка временно отключена для всех клиентов'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('admin confirms the credited top-up and resumes the displayed revision', async () => {
  render(<DeliveryAvailabilityNotice />);
  const button = await screen.findByRole('button', { name: 'Включить после пополнения' });
  mocks.resumeDelivery.mockResolvedValue({ config: { disabled: false } });
  mocks.getDeliveryAvailability.mockResolvedValue({ config: { disabled: false }, canResume: true });
  await userEvent.click(button);
  await waitFor(() => expect(mocks.resumeDelivery).toHaveBeenCalledWith('funds-error-v1'));
  expect(mocks.confirm).toHaveBeenCalledWith(
    expect.objectContaining({ body: expect.stringContaining('не проверяет баланс') }),
  );
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
});

it('a failed resume keeps the warning and exposes the error', async () => {
  mocks.resumeDelivery.mockRejectedValue(new Error('Состояние доставки изменилось'));
  render(<DeliveryAvailabilityNotice />);
  await userEvent.click(await screen.findByRole('button'));
  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith('Состояние доставки изменилось', 'error'),
  );
  expect(screen.getByRole('status')).toBeInTheDocument();
});

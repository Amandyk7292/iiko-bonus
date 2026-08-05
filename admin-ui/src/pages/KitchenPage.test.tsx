import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import KitchenPage from './KitchenPage';

const apiMocks = vi.hoisted(() => ({
  getKitchenOrders: vi.fn(),
  updateKitchenStatus: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', () => ({ api: apiMocks }));
vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtimeEvents: vi.fn(),
}));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => ({ toast }),
}));

const queuedOrder = {
  id: 'queued-1',
  number: 100041,
  branch: 'ЖК Дукат',
  kitchenStatus: 'queued',
  createdAt: '2026-08-05T08:00:00.000Z',
  preparationMinutes: 15,
  items: [{ id: 'item-1', name: 'Круассан', quantity: 2 }],
  substitutionPreference: 'call_customer',
};

const preparingOrder = {
  ...queuedOrder,
  id: 'preparing-1',
  number: 100042,
  kitchenStatus: 'preparing',
  kitchenStartedAt: '2026-08-05T08:05:00.000Z',
};

const readyOrder = {
  ...queuedOrder,
  id: 'ready-1',
  number: 100043,
  kitchenStatus: 'ready',
};

const renderPage = () =>
  render(
    <I18nProvider>
      <KitchenPage />
    </I18nProvider>,
  );

describe('Kitchen optimistic workflow', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    vi.clearAllMocks();
    apiMocks.getKitchenOrders.mockResolvedValue({
      orders: [queuedOrder, preparingOrder, readyOrder],
    });
  });

  it('moves independent orders through start, ready and handoff without waiting for a reload', async () => {
    const user = userEvent.setup();
    let resolveStart!: (value: unknown) => void;
    const startRequest = new Promise((resolve) => {
      resolveStart = resolve;
    });
    apiMocks.updateKitchenStatus.mockImplementation((id: string, status: string, minutes?: number) => {
      if (id === 'queued-1') return startRequest;
      const source = id === 'preparing-1' ? preparingOrder : readyOrder;
      return Promise.resolve({ success: true, order: { ...source, kitchenStatus: status, preparationMinutes: minutes } });
    });
    renderPage();

    const queuedTicket = (await screen.findByText('№100041')).closest('article');
    expect(queuedTicket).not.toBeNull();
    await user.click(within(queuedTicket!).getByRole('button', { name: 'Начать' }));
    const minutes = await screen.findByLabelText('Время приготовления, минут');
    await user.clear(minutes);
    await user.type(minutes, '12');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Начать' }),
    );

    expect(apiMocks.updateKitchenStatus).toHaveBeenCalledWith('queued-1', 'preparing', 12);
    const preparingColumn = screen
      .getByText('Готовится')
      .closest<HTMLElement>('.kitchen-column');
    expect(within(preparingColumn!).getByText('№100041')).toBeInTheDocument();

    await user.click(
      within((screen.getByText('№100042').closest('article'))!).getByRole('button', {
        name: 'Готово',
      }),
    );
    await waitFor(() =>
      expect(apiMocks.updateKitchenStatus).toHaveBeenCalledWith(
        'preparing-1',
        'ready',
        undefined,
      ),
    );

    await user.click(
      within((screen.getByText('№100043').closest('article'))!).getByRole('button', {
        name: 'Передан',
      }),
    );
    await waitFor(() =>
      expect(apiMocks.updateKitchenStatus).toHaveBeenCalledWith(
        'ready-1',
        'handed_over',
        undefined,
      ),
    );
    expect(screen.queryByText('№100043')).not.toBeInTheDocument();

    await act(async () => {
      resolveStart({
        success: true,
        order: { ...queuedOrder, kitchenStatus: 'preparing', preparationMinutes: 12 },
      });
      await startRequest;
    });
  });

  it('rolls an optimistic transition back when the server rejects it', async () => {
    const user = userEvent.setup();
    apiMocks.updateKitchenStatus.mockRejectedValueOnce(new Error('kitchen conflict'));
    renderPage();

    const ticket = (await screen.findByText('№100042')).closest('article');
    await user.click(within(ticket!).getByRole('button', { name: 'Готово' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith('kitchen conflict', 'error'));
    const preparingColumn = screen
      .getByText('Готовится')
      .closest<HTMLElement>('.kitchen-column');
    expect(within(preparingColumn!).getByText('№100042')).toBeInTheDocument();
  });

  it('shows a retry state when the queue cannot load', async () => {
    const user = userEvent.setup();
    apiMocks.getKitchenOrders
      .mockRejectedValueOnce(new Error('queue offline'))
      .mockResolvedValueOnce({ orders: [] });
    renderPage();

    expect(await screen.findByText('queue offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Экран кухни' })).toBeInTheDocument();
  });
});

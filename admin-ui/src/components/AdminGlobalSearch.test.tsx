import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { api, type AdminGlobalDetail } from '../lib/api';
import { BrowserRouter } from '../lib/router';
import AdminGlobalSearch from './AdminGlobalSearch';

const orderDetail = (id: string, number: number): AdminGlobalDetail => ({
  type: 'order',
  id,
  title: `Заказ №${number}`,
  subtitle: 'Оплачен · Актау',
  status: 'new',
  branch: 'ЖК Дукат',
  customer: {
    id: 'customer-1',
    name: 'Меруерт',
    phone: '+7 747 000 00 00',
  },
  order: {
    id,
    number,
    paymentStatus: 'paid',
    paymentProvider: 'forte',
    orderStatus: 'new',
    amount: 280,
    subtotal: 280,
    discount: 0,
    branch: 'ЖК Дукат',
    items: [{ name: 'Булочка с яблоком', quantity: 1, price: 280 }],
    earnedBonus: 2,
    createdAt: '2026-07-29T10:00:00.000Z',
    updatedAt: '2026-07-29T10:05:00.000Z',
    customer: { name: 'Меруерт', phone: '+7 747 000 00 00' },
  },
  timeline: [
    {
      id: 'payment-1',
      kind: 'payment',
      title: 'Оплата подтверждена',
      description: 'ForteBank',
      status: 'paid',
      occurredAt: '2026-07-29T10:01:00.000Z',
      requestId: 'request-123',
    },
    {
      id: 'order-1',
      kind: 'order',
      title: 'Заказ создан',
      occurredAt: '2026-07-29T10:00:00.000Z',
    },
  ],
});

function renderSearch(url = '/admin/operations') {
  window.history.replaceState({}, '', url);
  return render(
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <AdminGlobalSearch />
      </I18nProvider>
    </BrowserRouter>,
  );
}

describe('AdminGlobalSearch', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens with Ctrl+K and selects a result with Arrow keys and Enter', async () => {
    vi.spyOn(api, 'globalSearch').mockResolvedValue({
      success: true,
      results: [
        {
          type: 'order',
          id: 'order-1',
          title: 'Заказ №100030',
          subtitle: 'Меруерт · +7 747 000 00 00',
          status: 'new',
        },
        {
          type: 'order',
          id: 'order-2',
          title: 'Заказ №100031',
          subtitle: 'Амандык · +7 701 000 00 00',
          status: 'paid',
        },
      ],
    });
    const detailSpy = vi.spyOn(api, 'getGlobalSearchDetail').mockResolvedValue({
      success: true,
      detail: orderDetail('order-2', 100031),
    });

    renderSearch();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });

    const input = await screen.findByRole('searchbox', {
      name: 'Номер заказа, телефон, имя или обращение',
    });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: '10003' } });

    await screen.findByRole('button', { name: /Заказ №100031/ });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(detailSpy).toHaveBeenCalledWith('order', 'order-2', expect.any(AbortSignal)),
    );
    expect(await screen.findByRole('heading', { name: 'Заказ №100031' })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('globalEntity')).toBe(
      'order:order-2',
    );
  });

  it('loads a 360° card from a direct URL and shows its timeline', async () => {
    let resolveDetail:
      | ((value: { success: true; detail: AdminGlobalDetail }) => void)
      | undefined;
    vi.spyOn(api, 'getGlobalSearchDetail').mockReturnValue(
      new Promise((resolve) => {
        resolveDetail = resolve;
      }),
    );

    renderSearch('/admin/orders?globalEntity=order%3Aorder-1');
    expect(await screen.findByText('Ищем по доступным данным…')).toBeInTheDocument();

    await act(async () => {
      resolveDetail?.({ success: true, detail: orderDetail('order-1', 100030) });
    });

    expect(await screen.findByRole('heading', { name: 'Заказ №100030' })).toBeInTheDocument();
    expect(screen.getByText('Оплата подтверждена')).toBeInTheDocument();
    expect(screen.getByText(/request-123/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Открыть в разделе/ })).toHaveAttribute(
      'href',
      '/admin/orders?search=100030',
    );
  });

  it('shows an explicit empty state when nothing matches', async () => {
    vi.spyOn(api, 'globalSearch').mockResolvedValue({ success: true, results: [] });
    renderSearch();

    fireEvent.click(screen.getByRole('button', { name: /Найти заказ или клиента/ }));
    fireEvent.change(
      await screen.findByRole('searchbox', {
        name: 'Номер заказа, телефон, имя или обращение',
      }),
      { target: { value: 'несуществующий клиент' } },
    );

    expect(await screen.findByRole('heading', { name: 'Ничего не найдено' })).toBeInTheDocument();
    expect(screen.getByText(/Проверьте номер заказа/)).toBeInTheDocument();
  });

  it('shows a recoverable search error and retries the same query', async () => {
    const searchSpy = vi
      .spyOn(api, 'globalSearch')
      .mockRejectedValueOnce(new Error('Поиск временно недоступен'))
      .mockResolvedValueOnce({
        success: true,
        results: [
          {
            type: 'customer',
            id: 'customer-1',
            title: 'Меруерт',
            subtitle: '+7 747 000 00 00',
          },
        ],
      });
    renderSearch();

    fireEvent.click(screen.getByRole('button', { name: /Найти заказ или клиента/ }));
    fireEvent.change(
      await screen.findByRole('searchbox', {
        name: 'Номер заказа, телефон, имя или обращение',
      }),
      { target: { value: 'Меруерт' } },
    );

    expect(await screen.findByText('Поиск временно недоступен')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByRole('button', { name: /Меруерт/ })).toBeInTheDocument();
    expect(searchSpy).toHaveBeenCalledTimes(2);
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import TransactionsPage from './TransactionsPage';

const apiMocks = vi.hoisted(() => ({ getTransactions: vi.fn() }));
const realtime = vi.hoisted(() => ({ refresh: () => {} }));
vi.mock('../lib/api', () => ({ api: apiMocks }));
vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtimeEvents: (_events: string[], refresh: () => void) => {
    realtime.refresh = refresh;
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const transaction = (type: string) => ({
  id: type,
  type,
  order_id: 'kaspi:purchase-id',
  order_number: 100039,
  timestamp: '2026-08-04T09:31:00Z',
  amount: 25,
  order_total: 35,
  customers: { name: `Клиент ${type}`, phone: '+77762003590' },
});

const result = (name: string) => ({
  transactions: [{ ...transaction('deposit'), customers: { name } }],
  total: 1,
});

function renderPage() {
  return render(
    <BrowserRouter>
      <I18nProvider>
        <TransactionsPage />
      </I18nProvider>
    </BrowserRouter>,
  );
}

async function cellsFor(type: string) {
  const customer = await screen.findByText(`Клиент ${type}`);
  return within(customer.closest('tr')!).getAllByRole('cell');
}

describe('transaction movement display', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/transactions');
    localStorage.clear();
    apiMocks.getTransactions.mockReset();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('distinguishes credits, pending credits, debits and cancelled movements', async () => {
    apiMocks.getTransactions.mockResolvedValue({
      transactions: [
        'refund_bonus_restore',
        'manual',
        'pending_deposit',
        'withdrawal',
        'manual_withdrawal',
        'refund_reversal',
        'expiration',
        'cancelled_deposit',
        'order',
      ].map(transaction),
      total: 9,
    });
    renderPage();

    for (const type of ['refund_bonus_restore', 'manual']) {
      const cells = await cellsFor(type);
      expect(cells[5]).toHaveTextContent('—');
      expect(cells[6]).toHaveTextContent('+25');
      expect(cells[6]).toHaveClass('value-positive');
      expect(cells[7].firstElementChild).toHaveClass('status-active');
    }
    const pending = await cellsFor('pending_deposit');
    expect(pending[6]).toHaveTextContent('+25');
    expect(pending[6]).toHaveClass('value-info');
    expect(pending[7]).toHaveTextContent('Ожидает активации');
    expect(pending[7].firstElementChild).toHaveClass('status-warning');

    for (const type of ['withdrawal', 'manual_withdrawal', 'refund_reversal', 'expiration']) {
      const cells = await cellsFor(type);
      expect(cells[5]).toHaveTextContent(type === 'withdrawal' ? '25' : '—');
      expect(cells[6]).toHaveTextContent('−25');
      expect(cells[6]).toHaveClass('value-negative');
      expect(cells[7].firstElementChild).toHaveClass('status-danger');
    }
    for (const type of ['cancelled_deposit', 'order']) {
      const cells = await cellsFor(type);
      expect(cells[5]).toHaveTextContent('—');
      expect(cells[6]).toHaveTextContent('—');
      expect(cells[6]).not.toHaveClass('value-negative');
      expect(cells[7].firstElementChild).toHaveClass('status-inactive');
    }
  });

  it('keeps sequential order numbers, non-wrapping dates and stored product details', async () => {
    apiMocks.getTransactions.mockResolvedValue({
      transactions: [
        {
          ...transaction('deposit'),
          items: [{ name: 'Плюшка Московская', quantity: 1, price: 35 }],
        },
      ],
      total: 1,
    });
    renderPage();
    const cells = await cellsFor('deposit');
    expect(cells[0].querySelector('time')).toHaveStyle({ whiteSpace: 'nowrap' });
    expect(cells[1]).toHaveTextContent('#100039');
    expect(cells[1]).not.toHaveTextContent('purchase-id');
    await userEvent.click(screen.getByRole('button', { name: 'Состав заказа' }));
    expect(screen.getByText('Плюшка Московская')).toBeInTheDocument();
    expect(screen.queryByText('Неизвестный товар')).not.toBeInTheDocument();
  });

  it('ignores a response during the next debounce and keeps export disabled', async () => {
    const previous = deferred<ReturnType<typeof result>>();
    const latest = deferred<ReturnType<typeof result>>();
    apiMocks.getTransactions
      .mockResolvedValueOnce(result('Исходный клиент'))
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(latest.promise);
    renderPage();
    await screen.findByText('Исходный клиент');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'предыдущий' } });
    await waitFor(() => expect(apiMocks.getTransactions).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'новый' } });
    await act(async () => previous.resolve(result('Устаревший ответ')));
    expect(screen.queryByText('Устаревший ответ')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Экспорт страницы' })).toBeDisabled();
    await waitFor(() => expect(apiMocks.getTransactions).toHaveBeenCalledTimes(3));
    await act(async () => latest.resolve(result('Новый клиент')));
    expect(screen.getByText('Новый клиент')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Экспорт страницы' })).toBeEnabled();
  });

  it.each(['success', 'failure'] as const)(
    'ignores stale search %s after a newer result',
    async (outcome) => {
      const previous = deferred<ReturnType<typeof result>>();
      const latest = deferred<ReturnType<typeof result>>();
      apiMocks.getTransactions
        .mockResolvedValueOnce(result('Исходный клиент'))
        .mockReturnValueOnce(previous.promise)
        .mockReturnValueOnce(latest.promise);
      renderPage();
      await screen.findByText('Исходный клиент');
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'предыдущий' } });
      await waitFor(() => expect(apiMocks.getTransactions).toHaveBeenCalledTimes(2));
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'новый' } });
      await waitFor(() => expect(apiMocks.getTransactions).toHaveBeenCalledTimes(3));
      await act(async () => latest.resolve(result('Новый клиент')));
      await act(async () => {
        if (outcome === 'success') previous.resolve(result('Устаревший ответ'));
        else previous.reject(new Error('Устаревшая ошибка'));
      });
      expect(screen.getByText('Новый клиент')).toBeInTheDocument();
      expect(screen.queryByText('Устаревший ответ')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Обновить' })).toBeEnabled();
    },
  );

  it.each(['success', 'failure'] as const)(
    'finishes a realtime takeover of initial loading on %s',
    async (outcome) => {
      const initial = deferred<ReturnType<typeof result>>();
      const refresh = deferred<ReturnType<typeof result>>();
      apiMocks.getTransactions
        .mockReturnValueOnce(initial.promise)
        .mockReturnValueOnce(refresh.promise);
      renderPage();
      await waitFor(() => expect(apiMocks.getTransactions).toHaveBeenCalledTimes(1));
      act(() => realtime.refresh());
      await act(async () => {
        if (outcome === 'success') refresh.resolve(result('Новый клиент'));
        else refresh.reject(new Error('Транзакции недоступны'));
      });
      if (outcome === 'success') {
        expect(screen.getByText('Новый клиент')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Обновить' })).toBeEnabled();
      } else {
        expect(screen.getByText('Транзакции недоступны')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled();
      }
      await act(async () => initial.resolve(result('Устаревший ответ')));
      expect(screen.queryByText('Устаревший ответ')).not.toBeInTheDocument();
    },
  );

  it('keeps search focused when refining an empty result and does not reset a deep-linked page', async () => {
    window.history.replaceState({}, '', '/transactions?page=2&type=deposit');
    const pending = deferred<ReturnType<typeof result>>();
    apiMocks.getTransactions
      .mockResolvedValueOnce({ transactions: [], total: 60 })
      .mockReturnValue(pending.promise);
    renderPage();
    const search = await screen.findByRole('searchbox');
    expect(apiMocks.getTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, type: 'deposit' }),
    );
    expect(new URLSearchParams(window.location.search).get('page')).toBe('2');
    search.focus();
    fireEvent.change(search, { target: { value: 'новый поиск' } });
    await waitFor(() => expect(apiMocks.getTransactions).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('searchbox')).toBe(search);
    expect(search).toHaveFocus();
    expect(search).toHaveValue('новый поиск');
    expect(apiMocks.getTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, search: 'новый поиск', type: 'deposit' }),
    );
    fireEvent.change(search, { target: { value: 'другой поиск' } });
    expect(search).toHaveValue('другой поиск');
  });
});

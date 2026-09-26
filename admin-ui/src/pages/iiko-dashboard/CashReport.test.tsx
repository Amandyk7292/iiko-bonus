import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import CashReport, { cashItemMatches } from './CashReport';
import { loadControls } from './load-controls';

vi.mock('./load-controls', () => ({ loadControls: vi.fn() }));
const base = {
  serverId: 'astana-chain',
  reportType: 'SALES' as const,
  from: '2026-09-12',
  to: '2026-09-18',
  groupBy: [],
  aggregate: [],
  filters: [],
};

describe('cash report product highlighting', () => {
  it('matches a submitted product regardless of case and surrounding spaces', () => {
    expect(cashItemMatches('Кофе Американо', '  кофе  ')).toBe(true);
    expect(cashItemMatches('Кофе Американо', 'латте')).toBe(false);
  });

  it('does not highlight every receipt item before search is submitted', () => {
    expect(cashItemMatches('Кофе Американо', '')).toBe(false);
    expect(cashItemMatches('Кофе Американо', '   ')).toBe(false);
  });
});

describe('cash report page', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    vi.mocked(loadControls)
      .mockReset()
      .mockImplementation(async (rawQuery) => {
        const query = rawQuery as { shift?: string; search?: string; productId?: string };
        return {
          products: [
            { id: 'coffee', name: 'Кофе Американо' },
            { id: 'coffee-large', name: 'Кофе Американо большой' },
            { id: 'bun', name: 'Булочка' },
          ],
          shifts: [
            {
              id: 'session-106',
              number: '106',
              dateFrom: '2026-09-18',
              dateTo: '2026-09-18',
              register: 'Касса 1',
              department: 'Астана',
              checks: 273,
              revenue: 1000,
            },
          ],
          checks:
            query.shift === 'session-106' &&
            (query.search === 'кофе' || query.productId === 'coffee')
              ? [
                  {
                    id: 'check-4',
                    shift: '106',
                    number: 4,
                    date: '2026-09-18',
                    time: '08:18',
                    department: 'Астана',
                    cashier: 'Кассир',
                    total: 2190,
                    items: [
                      { id: 'coffee', name: 'Кофе Американо', unit: 'шт', quantity: 1, total: 990 },
                      {
                        id: 'coffee-large',
                        name: 'Кофе Американо большой',
                        unit: 'шт',
                        quantity: 1,
                        total: 1200,
                      },
                    ],
                  },
                ]
              : [],
          summary: query.search
            ? { checks: 1, quantity: 1, revenue: 990 }
            : { checks: 0, quantity: 0, revenue: 0 },
        };
      });
  });

  it('shows loading while shifts are being requested', () => {
    vi.mocked(loadControls).mockReturnValue(new Promise(() => {}));
    render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Получаем данные iiko');
  });

  it('selects a shift, searches and renders the matching complete check', async () => {
    render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    expect(
      await screen.findByRole('option', { name: '18.09.2026 · Смена 106 · Касса 1 · 273 чеков' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Кассовая смена'), { target: { value: 'session-106' } });
    expect(loadControls).toHaveBeenCalledTimes(1);
    expect(screen.getByText('18.09.2026 · Смена 106')).toBeInTheDocument();
    expect(screen.getByText('Астана · Касса 1')).toBeInTheDocument();
    expect(
      screen.queryByText('Чеки с таким товаром в выбранной смене не найдены'),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Например, Синнабон'), {
      target: { value: 'кофе' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    await waitFor(() =>
      expect(loadControls).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'кофе', shift: 'session-106' }),
        expect.anything(),
        expect.anything(),
      ),
    );
    expect(await screen.findByText('Чек № 4')).toBeInTheDocument();
    expect(screen.getAllByText('990 ₸')).toHaveLength(2);
  });

  it('shows an API error', async () => {
    vi.mocked(loadControls).mockRejectedValue(new Error('offline'));
    render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(/Чеки с таким товаром/)).not.toBeInTheDocument();
  });

  it('can retry the same search after an error without changing the text', async () => {
    render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    await screen.findByRole('option', { name: /18.09.2026/ });
    fireEvent.change(screen.getByLabelText('Кассовая смена'), { target: { value: 'session-106' } });
    fireEvent.change(screen.getByPlaceholderText('Например, Синнабон'), {
      target: { value: 'кофе' },
    });
    vi.mocked(loadControls).mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Найти' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    expect(await screen.findByText('Чек № 4')).toBeInTheDocument();
    expect(loadControls).toHaveBeenCalledTimes(4);
  });

  it('keeps loaded shifts usable during background refresh', async () => {
    const view = render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    await screen.findByRole('option', { name: /18.09.2026/ });
    fireEvent.change(screen.getByLabelText('Кассовая смена'), { target: { value: 'session-106' } });
    fireEvent.change(screen.getByPlaceholderText('Например, Синнабон'), {
      target: { value: 'кофе' },
    });
    vi.mocked(loadControls).mockReturnValue(new Promise(() => {}));
    view.rerender(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={1} />
      </I18nProvider>,
    );
    expect(screen.getByLabelText('Кассовая смена')).toBeEnabled();
    expect(screen.getByLabelText('Кассовая смена')).toHaveValue('session-106');
    expect(screen.getByRole('button', { name: 'Найти' })).toBeEnabled();
    expect(screen.queryByText('Получаем данные iiko…')).not.toBeInTheDocument();
  });

  it('resets the selection and aborts the old search when the city or period changes', async () => {
    const view = render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    await screen.findByRole('option', { name: /18.09.2026/ });
    fireEvent.change(screen.getByLabelText('Кассовая смена'), { target: { value: 'session-106' } });
    fireEvent.change(screen.getByPlaceholderText('Например, Синнабон'), {
      target: { value: 'кофе' },
    });
    vi.mocked(loadControls).mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    const oldSignal = vi.mocked(loadControls).mock.calls.at(-1)![1];
    view.rerender(
      <I18nProvider>
        <CashReport
          base={{ ...base, serverId: 'aktau-chain', from: '2026-09-19', to: '2026-09-19' }}
          department="branch-2"
          refresh={0}
        />
      </I18nProvider>,
    );
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() =>
      expect(loadControls).toHaveBeenLastCalledWith(
        expect.objectContaining({
          serverId: 'aktau-chain',
          from: '2026-09-19',
          department: 'branch-2',
          shift: '',
          search: '',
        }),
        expect.anything(),
        expect.anything(),
      ),
    );
    expect(screen.getByLabelText('Кассовая смена')).toHaveValue('');
    expect(screen.getByPlaceholderText('Например, Синнабон')).toHaveValue('');
  });

  it('opens receipts on suggestion selection and highlights only the selected product', async () => {
    const view = render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    await screen.findByRole('option', { name: /18.09.2026/ });
    fireEvent.change(screen.getByLabelText('Кассовая смена'), { target: { value: 'session-106' } });
    const input = screen.getByRole('combobox', { name: 'Товар' });
    fireEvent.change(input, { target: { value: 'коф' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Кофе Американо' }));
    expect(await screen.findByText('Чек № 4')).toBeInTheDocument();
    expect(input).toHaveValue('Кофе Американо');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(loadControls).toHaveBeenLastCalledWith(
      expect.objectContaining({
        shift: 'session-106',
        search: 'Кофе Американо',
        productId: 'coffee',
      }),
      expect.anything(),
      '/iiko-dashboard/cash-report',
    );
    expect(view.container.querySelectorAll('.id-found-item')).toHaveLength(1);
    expect(view.container.querySelector('.id-found-item')).toHaveTextContent('Кофе Американо');
    fireEvent.change(input, { target: { value: 'кофе' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    await waitFor(() =>
      expect(loadControls).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'кофе', productId: '' }),
        expect.anything(),
        expect.anything(),
      ),
    );
    await waitFor(() => expect(view.container.querySelectorAll('.id-found-item')).toHaveLength(2));
  });
});

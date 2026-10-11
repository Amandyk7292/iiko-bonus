import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
            (!query.search || query.search === 'кофе' || query.productId === 'coffee')
              ? [
                  {
                    id: 'check-4',
                    shift: '106',
                    number: 4,
                    date: '2026-09-18',
                    time: '08:18',
                    department: 'Астана',
                    cashier: 'Кассир',
                    payment: {
                      status: 'available',
                      methods: [
                        {
                          id: 'cash',
                          name: 'Наличные',
                          group: 'Наличные',
                          kind: 'cash',
                          amount: 1000,
                        },
                        {
                          id: 'card',
                          name: 'Банковская карта',
                          group: 'Безналичные',
                          kind: 'card',
                          amount: 1190,
                        },
                      ],
                      receivedCash: 1500,
                      change: 500,
                    },
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
                  ...(!query.search
                    ? [
                        {
                          id: 'check-7',
                          shift: '106',
                          number: 7,
                          date: '2026-09-18',
                          time: '09:00',
                          department: 'Астана',
                          cashier: 'Кассир',
                          payment: {
                            status: 'available',
                            methods: [
                              {
                                id: 'card',
                                name: 'Банковская карта',
                                group: 'Безналичные',
                                kind: 'card',
                                amount: 500,
                              },
                            ],
                            receivedCash: null,
                            change: null,
                          },
                          total: 500,
                          items: [
                            { id: 'bun', name: 'Булочка', unit: 'шт', quantity: 1, total: 500 },
                          ],
                        },
                      ]
                    : []),
                ]
              : [],
          summary: query.search
            ? { checks: 1, quantity: 1, revenue: 990 }
            : query.shift === 'session-106'
              ? { checks: 2, quantity: 3, revenue: 2690 }
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
    expect(await screen.findByText('Чек № 7')).toBeInTheDocument();
    expect(loadControls).toHaveBeenCalledWith(
      expect.objectContaining({ search: '', productId: '', shift: 'session-106' }),
      expect.anything(),
      '/iiko-dashboard/cash-report',
    );
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
    expect(screen.queryByText('Чек № 7')).not.toBeInTheDocument();
    expect(screen.getAllByText('990 ₸')).toHaveLength(2);
  });

  it('automatically restores every check and the shift totals when the search is cleared', async () => {
    const view = render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    await screen.findByRole('option', { name: /18.09.2026/ });
    fireEvent.change(screen.getByLabelText('Кассовая смена'), { target: { value: 'session-106' } });
    expect(await screen.findByText('Чек № 7')).toBeInTheDocument();
    expect(view.container.querySelector('.id-revision-totals')).toHaveTextContent('2 690 ₸');
    expect(view.container.querySelectorAll('.id-found-item')).toHaveLength(0);
    const input = screen.getByRole('combobox', { name: 'Товар' });
    fireEvent.change(input, { target: { value: 'кофе' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    await waitFor(() => expect(screen.queryByText('Чек № 7')).not.toBeInTheDocument());
    await waitFor(() => expect(view.container.querySelectorAll('.id-found-item')).toHaveLength(2));
    fireEvent.change(input, { target: { value: '   ' } });
    expect(await screen.findByText('Чек № 7')).toBeInTheDocument();
    expect(view.container.querySelector('.id-revision-totals')).toHaveTextContent('2 690 ₸');
    expect(view.container.querySelectorAll('.id-found-item')).toHaveLength(0);
    expect(loadControls).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: '', productId: '', shift: 'session-106' }),
      expect.anything(),
      '/iiko-dashboard/cash-report',
    );
    fireEvent.change(screen.getByLabelText('Кассовая смена'), { target: { value: '' } });
    expect(screen.queryByText('Чек № 7')).not.toBeInTheDocument();
    expect(view.container.querySelector('.id-revision-totals')).not.toBeInTheDocument();
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

  it('shows the receipt payment summary and its amounts without changing whole-shift totals', async () => {
    const view = render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    await screen.findByRole('option', { name: /18.09.2026/ });
    fireEvent.change(screen.getByLabelText('Кассовая смена'), { target: { value: 'session-106' } });
    const check = (await screen.findByText('Чек № 4')).closest('details')!;
    expect(within(check).getByText('Смешанная оплата')).toBeInTheDocument();
    fireEvent.click(within(check).getByText('Чек № 4'));
    const details = within(check).getByRole('region', { name: 'Оплата чека' });
    expect(details).toHaveTextContent('Наличные1 000 ₸');
    expect(details).toHaveTextContent('Банковская карта1 190 ₸');
    expect(details).toHaveTextContent('Получено наличными1 500 ₸');
    expect(details).toHaveTextContent('Сдача500 ₸');
    expect(details).toHaveTextContent('Кассир');
    expect(view.container.querySelector('.id-revision-totals')).toHaveTextContent('2 690 ₸');
  });

  it('explains an empty department and offers shifts from all departments', async () => {
    vi.mocked(loadControls).mockResolvedValueOnce({
      products: [],
      shifts: [],
      checks: [],
      summary: { checks: 0, quantity: 0, revenue: 0 },
    });
    const onDepartmentChange = vi.fn();
    render(
      <I18nProvider>
        <CashReport
          base={base}
          department="Bulka 19А мкр 11дом"
          refresh={0}
          onDepartmentChange={onDepartmentChange}
        />
      </I18nProvider>,
    );
    expect(
      await screen.findByText(
        'iiko не передала продажи по подразделению «Bulka 19А мкр 11дом» за выбранный период',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Кассовая смена')).toHaveDisplayValue(
      'Нет смен за выбранный период',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Показать смены всех подразделений' }));
    expect(onDepartmentChange).toHaveBeenCalledWith('');
  });

  it('can retry the same search after an error without changing the text', async () => {
    render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    await screen.findByRole('option', { name: /18.09.2026/ });
    fireEvent.change(screen.getByLabelText('Кассовая смена'), { target: { value: 'session-106' } });
    await screen.findByText('Чек № 7');
    fireEvent.change(screen.getByPlaceholderText('Например, Синнабон'), {
      target: { value: 'кофе' },
    });
    vi.mocked(loadControls).mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Найти' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    expect(await screen.findByText('Чек № 4')).toBeInTheDocument();
    expect(loadControls).toHaveBeenCalledTimes(5);
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
    expect(screen.getByRole('combobox', { name: 'Товар' })).toBeEnabled();
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

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { I18nProvider } from '../lib/i18n';
import CashierPayroll from './CashierPayroll';
import type { CashierPayrollResponse, CashierPayrollRow } from './cashier-payroll-model';

const mocks = vi.hoisted(() => ({ request: vi.fn(), export: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()), request: mocks.request,
}));
vi.mock('./cashier-payroll-api', () => ({ exportCashierPayroll: mocks.export }));

const row = (overrides: Partial<CashierPayrollRow> = {}): CashierPayrollRow => ({
  rowKey: 'cashier-1|point-1', id: 'cashier-1', name: 'Алия Рублева', pointId: 'point-1',
  branchName: '19а ЖК Жасыл дала', city: 'Актау', isArchived: false,
  completed: 4, rewardAmount: 1200, paidAmount: 0, outstandingAmount: 1200,
  outstandingCount: 4, snapshot: 'snapshot-original', payments: [], ...overrides,
});
const response = (items: CashierPayrollRow[] = [row()], overrides: Partial<CashierPayrollResponse> = {}): CashierPayrollResponse => ({
  success: true, month: '2026-10', canMarkPaid: true, items,
  totals: items.reduce((sum, item) => ({ completed: sum.completed + item.completed,
    rewardAmount: sum.rewardAmount + item.rewardAmount, paidAmount: sum.paidAmount + item.paidAmount,
    outstandingAmount: sum.outstandingAmount + item.outstandingAmount }),
  { completed: 0, rewardAmount: 0, paidAmount: 0, outstandingAmount: 0 }), ...overrides,
});
function renderPayroll(props: { active?: boolean; scope?: string } = {}) {
  const view = render(<I18nProvider><CashierPayroll {...props} /></I18nProvider>);
  fireEvent.change(screen.getByLabelText('Месяц'), { target: { value: '2026-10' } });
  return view;
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const readCalls = () => mocks.request.mock.calls.filter(([url]) => String(url).startsWith('/bonus/cashier-payroll?'));
const paymentCalls = () => mocks.request.mock.calls.filter(([url]) => url === '/bonus/cashier-payroll/payments');

beforeEach(() => {
  vi.setSystemTime(new Date('2026-10-05T05:00:00Z'));
  localStorage.setItem('adminLocale', 'ru');
  localStorage.removeItem('adminSelectedBranchId');
  mocks.export.mockReset().mockResolvedValue(undefined);
  mocks.request.mockReset().mockImplementation(async (url) => {
    const month = new URLSearchParams(String(url).split('?')[1]).get('month') || '2026-10';
    return response(undefined, { month });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('cashier monthly payroll', () => {
  it('honors the selected global branch scope and does not fetch while inactive', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    localStorage.setItem('adminSelectedBranchId', 'branch-global');
    const view = renderPayroll({ active: false });
    fireEvent.focus(window);
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(mocks.request).not.toHaveBeenCalled();
    view.rerender(<I18nProvider><CashierPayroll active /></I18nProvider>);
    await screen.findByText('Алия Рублева');
    expect(readCalls()[0][2]).toEqual({ branchScope: 'branch-global' });
    view.rerender(<I18nProvider><CashierPayroll active={false} /></I18nProvider>);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    fireEvent.online(window);
    expect(readCalls()).toHaveLength(1);
  });

  it('aborts and ignores stale month and scope reads before showing the current period', async () => {
    const old = deferred<CashierPayrollResponse>();
    const next = deferred<CashierPayrollResponse>();
    mocks.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const view = renderPayroll({ scope: 'first' });
    fireEvent.change(screen.getByLabelText('Месяц'), { target: { value: '2026-09' } });
    expect(readCalls()[0][1].signal.aborted).toBe(true);
    await act(async () => next.resolve(response([row({ name: 'Сентябрь' })], { month: '2026-09' })));
    await screen.findByText('Сентябрь');
    await act(async () => old.resolve(response([row({ name: 'Устаревшая запись' })])));
    expect(screen.queryByText('Устаревшая запись')).not.toBeInTheDocument();
    mocks.request.mockResolvedValue(response([row({ name: 'Другая область' })], { month: '2026-09' }));
    view.rerender(<I18nProvider><CashierPayroll scope="second" /></I18nProvider>);
    expect(screen.queryByText('Сентябрь')).not.toBeInTheDocument();
    await screen.findByText('Другая область');
    expect(readCalls().at(-1)?.[2]).toEqual({ branchScope: 'second' });
  });

  it('shows accrued, partial payment, outstanding amount and dated payment history including its author', async () => {
    mocks.request.mockResolvedValue(response([row({ paidAmount: 600, outstandingAmount: 600, outstandingCount: 2,
      payments: [{ id: 'payment-1', amount: 600, registrations: 2, paidAt: '2026-10-04T06:00:00Z', paidBy: 'amandyk' }] })]));
    renderPayroll();
    const person = await screen.findByRole('rowheader', { name: /Алия Рублева/ });
    const payrollRow = person.closest('tr')!;
    expect(within(payrollRow).getAllByText('600 ₸')).toHaveLength(2);
    fireEvent.click(within(payrollRow).getByRole('button', { name: 'История выплат: Алия Рублева' }));
    const dialog = screen.getByRole('dialog', { name: 'История выплат' });
    expect(dialog).toHaveTextContent('Отметил: amandyk');
    expect(dialog).toHaveTextContent('Регистрации: 2');
    expect(dialog).toHaveTextContent('04.10.2026, 11:00');
    expect(dialog).toHaveTextContent('600 ₸');
  });

  it('filters city then stable point ID, distinguishes names and supports unassigned points and employee IDs', async () => {
    mocks.request.mockResolvedValue(response([
      row(), row({ rowKey: 'two', id: 'cashier-2', name: 'Баян', pointId: 'point-2' }),
      row({ rowKey: 'null', id: 'cashier-null', name: 'Без точки', pointId: null }),
      row({ rowKey: 'astana', id: 'cashier-a', name: 'Ирина', city: 'Астана', pointId: 'point-a' }),
    ]));
    renderPayroll();
    await screen.findByText('Ирина');
    const point = screen.getByLabelText('Точка');
    expect(point).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Актау' } });
    expect(within(point).getByRole('option', { name: '19а ЖК Жасыл дала · № point-1' })).toBeInTheDocument();
    fireEvent.change(point, { target: { value: 'point-2' } });
    expect(screen.getByText('Баян')).toBeInTheDocument();
    expect(screen.queryByText('Алия Рублева')).not.toBeInTheDocument();
    fireEvent.change(point, { target: { value: '__unassigned__' } });
    expect(screen.getByText('Без точки')).toBeInTheDocument();
    expect(screen.queryByText('Баян')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Астана' } });
    expect(point).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Найти кассира'), { target: { value: 'CASHIER-A' } });
    expect(screen.getByText('Ирина')).toBeInTheDocument();
    expect(readCalls()).toHaveLength(1);
  });

  it('does not offer payment mutations for read-only users or fully paid rows', async () => {
    mocks.request.mockResolvedValue(response([row()], { canMarkPaid: false }));
    const view = renderPayroll();
    await screen.findByText('Алия Рублева');
    expect(screen.queryByRole('button', { name: /^Отметить выплату:/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скачать Excel' })).not.toBeDisabled();
    expect(paymentCalls()).toHaveLength(0);
    mocks.request.mockResolvedValue(response([row({ outstandingAmount: 0, outstandingCount: 0, paidAmount: 1200 })]));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить ведомость' }));
    await screen.findByText('Выплачено', { selector: '.cashier-payroll-paid' });
    expect(screen.queryByRole('button', { name: /^Отметить выплату:/ })).not.toBeInTheDocument();
    view.unmount();
  });

  it('freezes exact confirmation values and reuses the same UUID when an ambiguous network request is retried', async () => {
    const first = deferred<unknown>();
    mocks.request.mockImplementation((url) => url.endsWith('/payments')
      ? paymentCalls().length === 1 ? first.promise : Promise.resolve({ success: true, replayed: true })
      : Promise.resolve(response()));
    renderPayroll();
    fireEvent.click(await screen.findByRole('button', { name: 'Отметить выплату: Алия Рублева' }));
    const dialog = screen.getByRole('dialog', { name: 'Отметить выплату' });
    expect(dialog).toHaveTextContent('19а ЖК Жасыл дала · Актау');
    expect(dialog).toHaveTextContent('октябрь 2026');
    expect(dialog).toHaveTextContent(/1\s200 ₸/);
    expect(dialog).toHaveTextContent('Деньги не переводятся');
    expect(within(dialog).getByText('4')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Подтвердить выплату' }));
    expect(within(dialog).getByRole('button', { name: 'Подтвердить выплату' })).toBeDisabled();
    const payload = JSON.parse(paymentCalls()[0][1].body);
    expect(payload).toEqual({ month: '2026-10', rowKey: row().rowKey, snapshot: row().snapshot, idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    await act(async () => first.reject(new ApiError('Нет связи', 0, 'NETWORK_ERROR')));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(JSON.parse(paymentCalls()[1][1].body)).toEqual(payload);
    expect(screen.getByRole('status')).toHaveTextContent('Выплата отмечена');
  });

  it('keeps the same retry intent after closing and reopening an unchanged row', async () => {
    mocks.request.mockImplementation((url) => url.endsWith('/payments')
      ? Promise.reject(new ApiError('Нет связи', 0, 'NETWORK_ERROR')) : Promise.resolve(response()));
    renderPayroll();
    fireEvent.click(await screen.findByRole('button', { name: 'Отметить выплату: Алия Рублева' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Подтвердить выплату' }));
    await within(screen.getByRole('dialog')).findByRole('button', { name: 'Повторить' });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отмена' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отметить выплату: Алия Рублева' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Подтвердить выплату' }));
    await waitFor(() => expect(paymentCalls()).toHaveLength(2));
    expect(JSON.parse(paymentCalls()[1][1].body)).toEqual(JSON.parse(paymentCalls()[0][1].body));
  });

  it('never adjusts an open confirmation after background data changes and requires a fresh confirmation', async () => {
    mocks.request.mockResolvedValueOnce(response()).mockResolvedValue(response([
      row({ completed: 5, rewardAmount: 1500, outstandingAmount: 1500, outstandingCount: 5, snapshot: 'snapshot-new' }),
    ]));
    renderPayroll();
    fireEvent.click(await screen.findByRole('button', { name: 'Отметить выплату: Алия Рублева' }));
    fireEvent.online(window);
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Данные изменились');
    expect(dialog).toHaveTextContent(/1\s200 ₸/);
    expect(within(dialog).queryByText(/1\s500 ₸/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Подтвердить выплату' })).not.toBeInTheDocument();
    expect(paymentCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Обновить данные' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отметить выплату: Алия Рублева' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Отметить выплату: Алия Рублева' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/1\s500 ₸/);
  });

  it('blocks a 409 conflict and reloads before the operator can confirm a new snapshot', async () => {
    mocks.request.mockImplementation((url) => url.endsWith('/payments')
      ? Promise.reject(new ApiError('Изменено', 409, 'CASHIER_PAYROLL_CHANGED')) : Promise.resolve(response()));
    renderPayroll();
    fireEvent.click(await screen.findByRole('button', { name: 'Отметить выплату: Алия Рублева' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Подтвердить выплату' }));
    const alert = await within(screen.getByRole('dialog')).findByRole('alert');
    expect(alert).toHaveTextContent('Обновите ведомость');
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
    expect(paymentCalls()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Обновить данные' }));
    await waitFor(() => expect(readCalls()).toHaveLength(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores a prior-scope payment completion after the scope changes', async () => {
    const payment = deferred<unknown>();
    mocks.request.mockImplementation((url, _options, options) => url.endsWith('/payments') ? payment.promise
      : Promise.resolve(response([row({ name: options.branchScope === 'new' ? 'Новый филиал' : 'Алия Рублева' })])));
    const view = renderPayroll({ scope: 'old' });
    fireEvent.click(await screen.findByRole('button', { name: 'Отметить выплату: Алия Рублева' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Подтвердить выплату' }));
    view.rerender(<I18nProvider><CashierPayroll scope="new" /></I18nProvider>);
    await screen.findByText('Новый филиал');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => payment.resolve({ success: true }));
    expect(screen.queryByText('Выплата отмечена')).not.toBeInTheDocument();
    expect(readCalls()).toHaveLength(2);
    expect(paymentCalls()[0][2]).toEqual({ branchScope: 'old' });
  });

  it('exports the exact current filters and aborts an in-flight download when filters change', async () => {
    const exported = deferred<void>();
    mocks.export.mockReturnValueOnce(exported.promise);
    renderPayroll({ scope: 'branch-global' });
    await screen.findByText('Алия Рублева');
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Актау' } });
    fireEvent.change(screen.getByLabelText('Точка'), { target: { value: 'point-1' } });
    fireEvent.change(screen.getByLabelText('Найти кассира'), { target: { value: ' Алия ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }));
    expect(mocks.export).toHaveBeenCalledWith({ month: '2026-10', city: 'Актау', pointId: 'point-1', search: 'Алия' }, 'branch-global', expect.any(AbortSignal));
    const signal = mocks.export.mock.calls[0][2];
    expect(signal.aborted).toBe(false);
    fireEvent.change(screen.getByLabelText('Точка'), { target: { value: '' } });
    expect(signal.aborted).toBe(true);
    await act(async () => exported.resolve());
    expect(screen.getByRole('button', { name: 'Скачать Excel' })).not.toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('unlocks export when returning to a filter whose earlier export was aborted', async () => {
    const exported = deferred<void>();
    mocks.export.mockReturnValueOnce(exported.promise).mockResolvedValue(undefined);
    renderPayroll();
    await screen.findByText('Алия Рублева');
    fireEvent.change(screen.getByLabelText('Найти кассира'), { target: { value: 'Алия' } });
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }));
    expect(screen.getByRole('button', { name: 'Готовим Excel…' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Найти кассира'), { target: { value: 'Рублева' } });
    fireEvent.change(screen.getByLabelText('Найти кассира'), { target: { value: 'Алия' } });
    expect(mocks.export.mock.calls[0][2].aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Скачать Excel' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }));
    await waitFor(() => expect(mocks.export).toHaveBeenCalledTimes(2));
    await act(async () => exported.resolve());
    expect(screen.getByRole('button', { name: 'Скачать Excel' })).not.toBeDisabled();
  });

  it('does not request an empty, invalid or year-zero month', async () => {
    renderPayroll();
    await screen.findByText('Алия Рублева');
    fireEvent.change(screen.getByLabelText('Месяц'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Выберите месяц');
    fireEvent.change(screen.getByLabelText('Месяц'), { target: { value: '0000-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Выберите месяц');
    expect(readCalls()).toHaveLength(1);
    expect(screen.queryByText('Алия Рублева')).not.toBeInTheDocument();
  });

  it('retains successful data after a failed refresh and retries without losing filters', async () => {
    mocks.request.mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('Временно недоступно')).mockResolvedValueOnce(response());
    renderPayroll();
    await screen.findByText('Алия Рублева');
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Актау' } });
    fireEvent.change(screen.getByLabelText('Точка'), { target: { value: 'point-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить ведомость' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Временно недоступно');
    expect(screen.getByText('Алия Рублева')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Точка')).toHaveValue('point-1');
  });

  it('localizes payroll and confirmation in Kazakh', async () => {
    localStorage.setItem('adminLocale', 'kk');
    render(<I18nProvider><CashierPayroll /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Төлемді белгілеу: Алия Рублева' }));
    const dialog = screen.getByRole('dialog', { name: 'Төлемді белгілеу' });
    expect(dialog).toHaveTextContent('Ақша аударылмайды');
    expect(within(dialog).getByRole('button', { name: 'Төлемді растау' })).toBeInTheDocument();
    expect(screen.getByLabelText('Нүкте')).toBeDisabled();
  });
});

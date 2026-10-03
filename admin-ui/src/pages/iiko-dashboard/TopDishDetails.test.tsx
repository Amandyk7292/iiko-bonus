import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import TopDishDetails from './TopDishDetails';
import type { Report } from './model';

const mock = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('./api', () => ({ dashboardApi: mock }));
const product = {
  key: 'a',
  productId: 'a',
  name: 'Коже',
  unit: 'шт',
  quantity: 10.75,
  revenue: 21500,
};
const props = {
  product,
  serverId: 'aktau-chain',
  from: '2026-09-01',
  to: '2026-09-04',
  department: '',
  refresh: 0,
  onClose: vi.fn(),
};
const report = (rows: Report['rows'] = []): Report => ({
  rows,
  columns: {},
  serverId: props.serverId,
  fetchedAt: '2026-10-01T08:00:00Z',
});
const row = (date: string, department: string, quantity: number, revenue: number, unit = 'шт') => ({
  'OpenDate.Typed': date,
  Department: department,
  DishMeasureUnit: unit,
  DishAmountInt: quantity,
  DishDiscountSumInt: revenue,
});
const result = report([
  row('2026-09-01', 'Основной цех', 6, 12000),
  row('2026-09-02', 'Основной цех', -0.25, -500),
  row('2026-09-01', 'Bulka 16', 1, 2000),
  row('2026-09-04', 'Bulka 16', 4, 8000),
  row('2026-09-01', 'Основной цех', 999, 999000, 'кг'),
]);
const view = (scope = props) => (
  <I18nProvider>
    <TopDishDetails {...scope} />
  </I18nProvider>
);

beforeEach(() => {
  localStorage.setItem('adminLocale', 'ru');
  mock.report.mockReset().mockResolvedValue(result);
});

it('shows all points including workshops and selected-point daily signed values with missing days as zeros', async () => {
  render(view());
  const dialog = screen.getByRole('dialog', { name: product.name });
  expect(dialog).toHaveAccessibleDescription('01.09.2026 — 04.09.2026');
  const points = await screen.findByRole('region', { name: 'По точкам' });
  const pointButtons = within(points).getAllByRole('button');
  expect(pointButtons[0]).toHaveTextContent('Все точки');
  expect(pointButtons[1]).toHaveTextContent('Основной цех');
  expect(pointButtons[1]).toHaveTextContent('5,75 шт');
  expect(pointButtons[2]).toHaveTextContent('Bulka 16');
  const days = screen.getByRole('region', { name: 'По дням' });
  expect(within(days).getAllByRole('row')).toHaveLength(5);
  expect(within(days).getByRole('row', { name: /03\.09/ })).toHaveTextContent('0 шт');
  expect(days).toHaveTextContent('10,75 шт');
  fireEvent.click(pointButtons[2]);
  expect(pointButtons[2]).toHaveAttribute('aria-pressed', 'true');
  expect(days).toHaveTextContent('5 шт');
  expect(within(days).getByRole('row', { name: /01\.09/ })).toHaveTextContent('1 шт');
  expect(within(days).getByRole('row', { name: /02\.09/ })).toHaveTextContent('0 шт');
  fireEvent.click(pointButtons[1]);
  expect(within(days).getByRole('row', { name: /02\.09/ })).toHaveTextContent('-0,25 шт');
  expect(within(days).getByRole('row', { name: /02\.09/ })).toHaveTextContent('-500 ₸');
  expect(mock.report).toHaveBeenCalledTimes(1);
  expect(mock.report).toHaveBeenCalledWith(
    expect.objectContaining({
      serverId: props.serverId,
      from: props.from,
      to: props.to,
      groupBy: ['OpenDate.Typed', 'Department', 'DishMeasureUnit'],
      filters: expect.arrayContaining([{ field: 'DishId', values: ['a'], exclude: false }]),
    }),
    expect.any(AbortSignal),
  );
});

it('queries only the shared selected point and keeps year information in daily labels across years', async () => {
  render(view({ ...props, department: 'Основной цех', from: '2026-12-31', to: '2027-01-02' }));
  const days = await screen.findByRole('region', { name: 'По дням' });
  expect(within(days).getByRole('row', { name: /31\.12\.2026/ })).toHaveTextContent('0 шт');
  expect(within(days).getByRole('row', { name: /01\.01\.2027/ })).toHaveTextContent('0 шт');
  expect(screen.queryByRole('button', { name: 'Все точки' })).not.toBeInTheDocument();
  expect(mock.report.mock.calls[0][0].filters).toContainEqual({
    field: 'Department',
    values: ['Основной цех'],
    exclude: false,
  });
});

it('shows loading/errors, retries the exact product and exposes no-data for empty all-point reports', async () => {
  mock.report.mockRejectedValueOnce({ code: 'IIKO_REPORT_ACCESS' }).mockResolvedValueOnce(report());
  render(view());
  expect(screen.getByRole('status')).toHaveTextContent('Получаем данные');
  expect(await screen.findByRole('alert')).toHaveTextContent('нет доступа');
  fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('данных нет'));
  expect(mock.report).toHaveBeenCalledTimes(2);
  expect(mock.report.mock.calls[0][0]).toEqual(mock.report.mock.calls[1][0]);
});

it('cancels obsolete product/scope requests, ignores late responses and aborts on close', async () => {
  const pending: { signal: AbortSignal; resolve: (report: Report) => void }[] = [];
  mock.report.mockImplementation(
    (_query, signal: AbortSignal) =>
      new Promise<Report>((resolve) => pending.push({ resolve, signal })),
  );
  const ui = render(view());
  ui.rerender(
    view({
      ...props,
      product: { ...product, productId: 'b' },
      serverId: 'astana-chain',
      from: '2026-09-02',
    }),
  );
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => pending[1].resolve(report([row('2026-09-02', 'Новая точка', 2, 4000)])));
  expect(await screen.findByRole('button', { name: /Новая точка/ })).toBeVisible();
  await act(async () => pending[0].resolve(report([row('2026-09-01', 'Старая точка', 2, 4000)])));
  expect(screen.queryByText('Старая точка')).not.toBeInTheDocument();
  ui.rerender(view({ ...props, department: 'Другая точка' }));
  expect(screen.queryByText('Новая точка')).not.toBeInTheDocument();
  ui.unmount();
  expect(pending[2].signal.aborted).toBe(true);
});

it('retains the current daily report and selected point while refreshing the same scope', async () => {
  let resolve!: (report: Report) => void;
  mock.report.mockResolvedValueOnce(result).mockImplementation(
    () =>
      new Promise<Report>((complete) => {
        resolve = complete;
      }),
  );
  const ui = render(view());
  fireEvent.click(await screen.findByRole('button', { name: /Bulka 16/ }));
  ui.rerender(view({ ...props, refresh: 1 }));
  expect(screen.getByRole('region', { name: 'По дням' })).toHaveTextContent('5 шт');
  expect(screen.getByRole('status', { name: 'Обновляем…' })).toBeInTheDocument();
  await act(async () => resolve(result));
  expect(screen.getByRole('button', { name: /Bulka 16/ })).toHaveAttribute('aria-pressed', 'true');
});

it('resets a disappeared internal point to all points after refresh so the daily pane remains available', async () => {
  mock.report
    .mockResolvedValueOnce(result)
    .mockResolvedValueOnce(report([row('2026-09-01', 'Основной цех', 4, 8000)]))
    .mockResolvedValueOnce(result);
  const ui = render(view());
  fireEvent.click(await screen.findByRole('button', { name: /Bulka 16/ }));
  ui.rerender(view({ ...props, refresh: 1 }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /Bulka 16/ })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: 'Все точки' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('region', { name: 'По дням' })).toHaveTextContent('4 шт');
  ui.rerender(view({ ...props, refresh: 2 }));
  expect(await screen.findByRole('button', { name: /Bulka 16/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(screen.getByRole('button', { name: 'Все точки' })).toHaveAttribute('aria-pressed', 'true');
});

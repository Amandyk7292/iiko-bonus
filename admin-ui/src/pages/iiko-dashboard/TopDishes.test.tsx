import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import TopDishes from './TopDishes';
import type { Report } from './model';

const mock = vi.hoisted(() => ({ analytics: vi.fn(), report: vi.fn() }));
vi.mock('./api', () => ({ dashboardApi: mock }));
const props = {
  serverId: 'aktau-chain',
  from: '2026-09-01',
  to: '2026-09-30',
  department: 'Bulka 16 мкр',
  configured: true,
  refresh: 0,
};
const report = (rows: Report['rows'] = []): Report => ({
  rows,
  columns: {},
  serverId: props.serverId,
  fetchedAt: '2026-10-01T08:00:00Z',
});
const view = (scope = props) => (
  <I18nProvider>
    <TopDishes {...scope} />
  </I18nProvider>
);

beforeEach(() => {
  localStorage.setItem('adminLocale', 'ru');
  mock.analytics.mockReset();
  mock.report.mockReset().mockResolvedValue(report());
});

it('uses the shared scope and shows only ten products sorted by quantity with iiko units and revenue', async () => {
  mock.analytics.mockResolvedValue(
    report([
      {
        DishId: 'split',
        DishName: 'Коже',
        DishMeasureUnit: 'кг',
        DishAmountInt: 10.5,
        DishDiscountSumInt: 2500,
      },
      {
        DishId: 'split',
        DishName: 'Көже',
        DishMeasureUnit: 'кг',
        DishAmountInt: -0.25,
        DishDiscountSumInt: -100,
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        DishId: `p${index}`,
        DishName: `Товар ${index}`,
        DishMeasureUnit: 'шт',
        DishAmountInt: index + 0.5,
        DishDiscountSumInt: 10000 - index,
      })),
    ]),
  );
  render(view());
  expect(mock.analytics).toHaveBeenCalledWith(
    {
      view: 'products',
      serverId: props.serverId,
      from: props.from,
      to: props.to,
      department: props.department,
    },
    expect.any(AbortSignal),
  );
  const list = await screen.findByRole('list');
  const rows = within(list).getAllByRole('listitem');
  expect(rows).toHaveLength(10);
  expect(rows[0]).toHaveTextContent('Товар 11');
  expect(rows[1]).toHaveTextContent('Товар 10');
  expect(rows[2]).toHaveTextContent('Коже');
  expect(rows[2]).toHaveTextContent('10,25');
  expect(rows[2]).toHaveTextContent('кг');
  expect(rows[2].textContent?.replace(/\s/g, '')).toContain('2400₸');
  expect(screen.queryByText('Товар 0')).not.toBeInTheDocument();
});

it('aborts obsolete requests, hides previous scope and ignores late results after a point/date/server change', async () => {
  const pending: { resolve: (value: Report) => void; signal: AbortSignal }[] = [];
  mock.analytics.mockImplementation(
    (_query, signal: AbortSignal) =>
      new Promise<Report>((resolve) => {
        pending.push({ resolve, signal });
      }),
  );
  const ui = render(view());
  expect(screen.getByRole('status')).toHaveTextContent('Получаем данные');
  ui.rerender(
    view({ ...props, department: 'Новая точка', from: '2026-08-01', serverId: 'astana-chain' }),
  );
  expect(pending[0].signal.aborted).toBe(true);
  expect(mock.analytics).toHaveBeenLastCalledWith(
    expect.objectContaining({
      department: 'Новая точка',
      from: '2026-08-01',
      serverId: 'astana-chain',
    }),
    expect.any(AbortSignal),
  );
  await act(async () =>
    pending[1].resolve(report([{ DishId: 'new', DishName: 'Новый товар', DishAmountInt: 3 }])),
  );
  expect(await screen.findByText('Новый товар')).toBeVisible();
  await act(async () =>
    pending[0].resolve(report([{ DishId: 'old', DishName: 'Старый товар', DishAmountInt: 100 }])),
  );
  expect(screen.queryByText('Старый товар')).not.toBeInTheDocument();
  ui.rerender(view({ ...props, department: 'Ещё точка' }));
  expect(screen.queryByText('Новый товар')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeVisible();
  ui.unmount();
  expect(pending[2].signal.aborted).toBe(true);
});

it('does not query unconfigured servers or invalid periods and shows no-data for nonpositive totals', async () => {
  mock.analytics.mockResolvedValue(
    report([
      { DishId: 'zero', DishAmountInt: 5 },
      { DishId: 'zero', DishAmountInt: -5 },
      { DishId: 'negative', DishAmountInt: -2 },
    ]),
  );
  const ui = render(view({ ...props, configured: false }));
  expect(mock.analytics).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('ещё не настроен');
  ui.rerender(view({ ...props, from: '2026-10-01', to: '2026-09-01' }));
  expect(mock.analytics).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Выберите период');
  ui.rerender(view());
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('данных нет'));
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

it('shows request errors, retries the same scope and responds to shared refresh', async () => {
  mock.analytics
    .mockRejectedValueOnce({ code: 'IIKO_REPORT_ACCESS' })
    .mockResolvedValue(report([{ DishId: 'a', DishName: 'Восстановлен', DishAmountInt: 1 }]));
  const ui = render(view());
  expect(await screen.findByRole('alert')).toHaveTextContent('нет доступа');
  fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  expect(await screen.findByText('Восстановлен')).toBeVisible();
  expect(mock.analytics).toHaveBeenCalledTimes(2);
  expect(mock.analytics.mock.calls[1][0]).toEqual(mock.analytics.mock.calls[0][0]);
  ui.rerender(view({ ...props, refresh: 1 }));
  await waitFor(() => expect(mock.analytics).toHaveBeenCalledTimes(3));
});

it('does not revive an old result when switching back to a previous point before the new request completes', async () => {
  mock.analytics
    .mockResolvedValueOnce(report([{ DishId: 'a', DishName: 'Старый отчёт', DishAmountInt: 5 }]))
    .mockImplementation(() => new Promise(() => {}));
  const ui = render(view());
  expect(await screen.findByText('Старый отчёт')).toBeVisible();
  ui.rerender(view({ ...props, department: 'Другая точка' }));
  expect(screen.queryByText('Старый отчёт')).not.toBeInTheDocument();
  ui.rerender(view());
  expect(screen.queryByText('Старый отчёт')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeVisible();
});

it('keeps the same-filter list during refresh and on refresh failure, with retry replacing it only after success', async () => {
  let reject!: (error: unknown) => void;
  mock.analytics
    .mockResolvedValueOnce(
      report([{ DishId: 'a', DishName: 'Сохранённый товар', DishAmountInt: 4 }]),
    )
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValueOnce(
      report([{ DishId: 'b', DishName: 'Обновлённый товар', DishAmountInt: 6 }]),
    );
  const ui = render(view());
  expect(await screen.findByText('Сохранённый товар')).toBeVisible();
  ui.rerender(view({ ...props, refresh: 1 }));
  expect(screen.getByText('Сохранённый товар')).toBeVisible();
  expect(screen.getByRole('status', { name: 'Обновляем…' })).toBeInTheDocument();
  await act(async () => reject({ code: 'IIKO_REPORT_ACCESS' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('нет доступа');
  expect(screen.getByText('Сохранённый товар')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  expect(await screen.findByText('Обновлённый товар')).toBeVisible();
  expect(screen.queryByText('Сохранённый товар')).not.toBeInTheDocument();
});

it('opens a stable product by keyboard and closes by Escape with focus return, while missing-ID rows cannot drill', async () => {
  const user = userEvent.setup();
  let detailSignal!: AbortSignal;
  mock.analytics.mockResolvedValue(
    report([
      { DishName: 'Неизвестный ID', DishAmountInt: 5 },
      { DishId: 'a', DishName: 'Коже', DishMeasureUnit: 'кг', DishAmountInt: 3.25 },
    ]),
  );
  mock.report.mockImplementation((_query, signal: AbortSignal) => {
    detailSignal = signal;
    return new Promise(() => {});
  });
  render(view());
  const missing = await screen.findByRole('button', { name: /Неизвестный ID/ });
  expect(missing).toBeDisabled();
  const product = screen.getByRole('button', { name: /Коже/ });
  expect(product).toHaveAttribute('aria-haspopup', 'dialog');
  await user.tab();
  expect(product).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: 'Коже' })).toBeVisible();
  expect(mock.report.mock.calls[0][0].filters).toContainEqual({
    field: 'DishId',
    values: ['a'],
    exclude: false,
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveFocus());
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(product).toHaveFocus();
  expect(detailSignal.aborted).toBe(true);
});

it('closes and cancels detail when the shared point/period changes without reviving it on return', async () => {
  mock.analytics.mockResolvedValue(
    report([{ DishId: 'a', DishName: 'Коже', DishMeasureUnit: 'шт', DishAmountInt: 3 }]),
  );
  let detailSignal!: AbortSignal;
  mock.report.mockImplementation((_query, signal: AbortSignal) => {
    detailSignal = signal;
    return new Promise(() => {});
  });
  const ui = render(view());
  fireEvent.click(await screen.findByRole('button', { name: /Коже/ }));
  expect(screen.getByRole('dialog')).toBeVisible();
  ui.rerender(view({ ...props, department: 'Основной цех', from: '2026-09-02' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(detailSignal.aborted).toBe(true);
  ui.rerender(view());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

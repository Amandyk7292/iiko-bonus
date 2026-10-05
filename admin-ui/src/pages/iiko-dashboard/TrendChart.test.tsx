import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ChartData, ChartOptions, ScriptableContext } from 'chart.js';
import { I18nProvider } from '../../lib/i18n';
import type { Report } from './model';
import Overview from './Overview';
import TrendChart from './TrendChart';
import { trendColors, trendReveal } from './trend-chart-style';

const captured = vi.hoisted(() => ({
  nextId: 0,
  props: undefined as
    { options: ChartOptions<'line'>; data: ChartData<'line'>; updateMode: string } | undefined,
}));
vi.mock('react-chartjs-2', async () => {
  const { useState } = await import('react');
  return {
    Line: (props: NonNullable<typeof captured.props>) => {
      const [id] = useState(() => ++captured.nextId);
      captured.props = props;
      return <div data-testid="line-chart" data-instance={id} />;
    },
  };
});
vi.mock('./BranchRevenue', () => ({ default: () => null }));

const trend: Report = {
  serverId: 'aktau-chain',
  fetchedAt: '2026-10-05T07:00:00Z',
  period: { from: '2026-10-01', to: '2026-10-03' },
  columns: { DishDiscountSumInt: { name: 'Выручка', type: 'MONEY' } },
  rows: [
    { 'OpenDate.Typed': '2026-10-01', DishDiscountSumInt: 100 },
    { 'OpenDate.Typed': '2026-10-03', DishDiscountSumInt: 300 },
  ],
};
const metric = { id: 'revenue', field: 'DishDiscountSumInt', money: true };
beforeEach(() => {
  captured.nextId = 0;
  captured.props = undefined;
});

it('reveals days in sequence with a bounded total duration and never delays the same point twice', () => {
  for (const count of [1, 7, 31, 367]) {
    const animation = trendReveal(count, false).animations as unknown as {
      x: { duration: number; from: number; delay: (context: ScriptableContext<'line'>) => number };
    };
    const first = { type: 'data', dataIndex: 0 } as ScriptableContext<'line'>;
    const last = { type: 'data', dataIndex: count - 1 } as ScriptableContext<'line'>;
    expect(Number.isNaN(animation.x.from)).toBe(true);
    expect(animation.x.delay(first)).toBe(0);
    const end = animation.x.delay(last) + animation.x.duration;
    expect(end).toBeGreaterThanOrEqual(700);
    expect(end).toBeLessThanOrEqual(1050.001);
    expect(animation.x.delay(last)).toBe(0);
  }
  expect(trendReveal(31, true)).toEqual({ animation: false });
});

it('handles Chart.js dataset option resolution and an unparsed first point without throwing', () => {
  const animation = trendReveal(7, false).animations as unknown as {
    y: { from: (context: ScriptableContext<'line'>) => number };
  };
  expect(animation.y.from({ type: 'dataset' } as ScriptableContext<'line'>)).toBe(0);
  const getPixelForValue = vi.fn((value: number) => 200 - value);
  const context = {
    type: 'data',
    datasetIndex: 0,
    dataIndex: 0,
    chart: { getDatasetMeta: () => ({ data: [] }), scales: { y: { getPixelForValue } } },
  } as unknown as ScriptableContext<'line'>;
  expect(animation.y.from(context)).toBe(200);
  expect(getPixelForValue).toHaveBeenLastCalledWith(0);
  expect(animation.y.from({ ...context, parsed: { x: 0, y: 70 } })).toBe(130);
});

it('preserves missing days, readable contrasting series and immediate same-scope refreshes', () => {
  const view = render(
    <I18nProvider>
      <TrendChart report={trend} previous={trend} metric={metric} />
    </I18nProvider>,
  );
  const first = screen.getByTestId('line-chart').dataset.instance;
  expect(captured.props?.data.datasets[0].data).toEqual([100, null, 300]);
  expect(captured.props?.data.datasets[0].borderColor).toBe(trendColors.current);
  expect(captured.props?.data.datasets[1].borderColor).toBe(trendColors.comparison);
  expect(captured.props?.data.datasets[1].borderDash).toEqual([6, 5]);
  expect(captured.props?.options.spanGaps).toBe(false);
  expect(captured.props?.options.interaction).toEqual({ mode: 'index', intersect: false });
  expect(captured.props?.updateMode).toBe('none');
  view.rerender(
    <I18nProvider>
      <TrendChart report={{ ...trend, fetchedAt: '2026-10-05T07:05:00Z' }} metric={metric} />
    </I18nProvider>,
  );
  expect(screen.getByTestId('line-chart')).toHaveAttribute('data-instance', first);
  view.rerender(
    <I18nProvider>
      <TrendChart report={trend} metric={{ id: 'discount', field: 'DiscountSum', money: true }} />
    </I18nProvider>,
  );
  expect(screen.getByTestId('line-chart').dataset.instance).not.toBe(first);
});

it('disables the reveal when the user requests reduced motion', () => {
  const matchMedia = window.matchMedia;
  const preference = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...matchMedia(query),
    matches: query === '(prefers-reduced-motion: reduce)',
  }));
  render(
    <I18nProvider>
      <TrendChart report={trend} metric={metric} />
    </I18nProvider>,
  );
  expect(captured.props?.options.animation).toBe(false);
  expect(captured.props?.options.animations).toBeUndefined();
  preference.mockRestore();
});

it('keeps the chart mounted during partial refresh and resets it for a new period', () => {
  const summary = { ...trend, rows: [{ DishDiscountSumInt: 400, DiscountSum: 20 }] };
  const view = render(
    <I18nProvider>
      <Overview data={{ summary, trend }} cards={['revenue', 'discount']} />
    </I18nProvider>,
  );
  const first = screen.getByTestId('line-chart').dataset.instance;
  view.rerender(
    <I18nProvider>
      <Overview
        data={{ summary: { ...summary, fetchedAt: '2026-10-05T07:05:00Z' } }}
        cards={['revenue', 'discount']}
      />
    </I18nProvider>,
  );
  expect(screen.getByTestId('line-chart')).toHaveAttribute('data-instance', first);
  expect(captured.props?.data.datasets[0].data).toEqual([100, null, 300]);
  fireEvent.click(screen.getByRole('button', { name: /Скидки/ }));
  expect(screen.getByTestId('line-chart').dataset.instance).not.toBe(first);
  view.rerender(
    <I18nProvider>
      <Overview
        data={{ summary: { ...summary, period: { from: '2026-09-01', to: '2026-09-03' } } }}
        cards={['revenue', 'discount']}
      />
    </I18nProvider>,
  );
  expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  view.rerender(
    <I18nProvider>
      <Overview key="new-branch" data={{ summary }} cards={['revenue']} />
    </I18nProvider>,
  );
  expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
});

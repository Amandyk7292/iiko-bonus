import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import ReportBuilder from './ReportBuilder';
import type { Query } from './model';
const mock = vi.hoisted(() => ({ schema: vi.fn(), report: vi.fn() }));
vi.mock('./api', () => ({ dashboardApi: mock, exportReport: vi.fn() }));
it('applying a period reruns an already submitted report with its new dates', async () => {
  mock.schema.mockResolvedValue({
    dateField: 'OpenDate.Typed',
    columns: {
      Department: { name: 'Филиал', type: 'STRING', groupingAllowed: true },
      DishDiscountSumInt: { name: 'Сумма', type: 'MONEY', aggregationAllowed: true },
      UniqOrderId: { name: 'Чеки', type: 'INTEGER', aggregationAllowed: true },
    },
  });
  mock.report.mockImplementation(async (query: Query) => ({
    rows: [{ Department: query.from, DishDiscountSumInt: 1 }],
    columns: { Department: { name: 'Филиал', type: 'STRING' } },
    fetchedAt: '2026-09-08',
    serverId: 'aktau-chain',
  }));
  const base: Query = {
    serverId: 'aktau-chain',
    from: '2026-09-01',
    to: '2026-09-07',
    reportType: 'SALES',
    aggregate: [],
    groupBy: [],
    filters: [],
  };
  const view = (query: Query) => (
    <I18nProvider>
      <ReportBuilder base={query} refresh={0} templates={[]} setTemplates={vi.fn()} />
    </I18nProvider>
  );
  const ui = render(view(base));
  const button = await screen.findByRole('button', { name: 'Построить отчёт' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(mock.report).toHaveBeenCalledTimes(1));
  ui.rerender(view({ ...base, from: '2026-08-01', to: '2026-08-31' }));
  await waitFor(() =>
    expect(mock.report).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-08-01', to: '2026-08-31' }),
      expect.any(AbortSignal),
    ),
  );
  expect(await screen.findByText('2026-08-01')).toBeVisible();
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import { loadControls } from './load-controls';
import { download } from './api';
import Invoices from './Invoices';
import type { Query } from './model';

vi.mock('./load-controls', () => ({ loadControls: vi.fn() }));
vi.mock('./api', () => ({ download: vi.fn() }));
const base: Query = {
  serverId: 'aktau-chain',
  from: '2026-09-01',
  to: '2026-09-13',
  reportType: 'SALES',
  filters: [],
  groupBy: [],
  aggregate: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadControls).mockResolvedValue({
    serverId: base.serverId,
    fetchedAt: '2026-09-13T10:00:00Z',
    rows: [],
    columns: {},
    invoices: [
      {
        identity: 'invoice-1',
        Date: '2026-09-05T12:00:00+05:00',
        Document: '000042',
        Supplier: 'Поставщик A',
        Department: 'Филиал A',
        Store: 'Основной склад',
        Products: 1,
        Total: 1000,
        Comment: 'Доставка утром',
        items: [
          {
            Product: 'Мука',
            Article: 'A-10',
            Unit: 'кг',
            Quantity: 2.5,
            Price: 400,
            Vat: 120,
            Total: 1000,
          },
        ],
      },
    ],
    summary: { invoices: 1, suppliers: 1, productLines: 1, total: 1000 },
  });
});

it('loads incoming invoices, opens goods and exports the selected period', async () => {
  render(
    <I18nProvider>
      <Invoices base={base} department="Филиал A" refresh={0} />
    </I18nProvider>,
  );
  expect(await screen.findByText('000042')).toBeVisible();
  expect(vi.mocked(loadControls).mock.calls[0][0]).toEqual({
    serverId: 'aktau-chain',
    from: base.from,
    to: base.to,
    department: 'Филиал A',
  });
  expect(vi.mocked(loadControls).mock.calls[0][2]).toBe('/iiko-dashboard/invoices');
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Мука')).toBeVisible();
  expect(within(dialog).getByText('2,5')).toBeVisible();
  expect(within(dialog).getByText(/Доставка утром/)).toBeVisible();

  const blob = new Blob(['xlsx']);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }));
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }));
  await waitFor(() =>
    expect(download).toHaveBeenCalledWith(blob, 'iiko-invoices-2026-09-01-2026-09-13.xlsx'),
  );
  vi.unstubAllGlobals();
});

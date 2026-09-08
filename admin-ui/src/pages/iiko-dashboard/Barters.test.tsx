import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import { request } from '../../lib/api';
import { loadControls } from './load-controls';
import { download } from './api';
import Barters, { type BarterResult } from './Barters';
import type { Query } from './model';
vi.mock('./load-controls', () => ({ loadControls: vi.fn() }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  request: vi.fn(),
}));
vi.mock('./api', () => ({ download: vi.fn() }));
const base: Query = {
  serverId: 'aktau-chain',
  from: '2026-09-01',
  to: '2026-09-08',
  reportType: 'SALES',
  filters: [],
  groupBy: [],
  aggregate: [],
};
const makeData = (): BarterResult => ({
  serverId: base.serverId,
  fetchedAt: '2026-09-08T12:00:00Z',
  rows: [],
  columns: {},
  checks: [
    {
      identity: 'a'.repeat(64),
      Blogger: '',
      groupKey: '',
      Counteragent: 'Бартер',
      Document: '0001',
      Department: 'Филиал A',
      Date: '2026-09-08T14:00:00+05:00',
      Total: 1084.8,
      items: [{ Product: 'Кекс', Quantity: 0.339, Unit: 'кг', Total: 1084.8 }],
    },
  ],
  bloggers: [
    { Blogger: '', groupKey: '', Checks: 1, Total: 1084.8, LastVisit: '2026-09-08T14:00:00+05:00' },
  ],
  summary: { bloggers: 0, checks: 1, total: 1084.8, unnamed: 1 },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadControls).mockResolvedValue(makeData());
  vi.mocked(request).mockResolvedValue({ saved: true });
});
const page = (query = base, refresh = 0) => (
  <I18nProvider>
    <Barters base={query} department="" refresh={refresh} />
  </I18nProvider>
);
it('loads without configuration, preserves fractional quantities and saves the blogger on the exact invoice', async () => {
  render(page());
  expect(await screen.findByText('0001')).toBeVisible();
  expect(screen.getByText(/0,339 кг × Кекс/)).toBeVisible();
  expect(vi.mocked(loadControls).mock.calls[0][0]).toEqual({
    serverId: 'aktau-chain',
    from: base.from,
    to: base.to,
    department: '',
  });
  expect(vi.mocked(loadControls).mock.calls[0][2]).toBe('/iiko-dashboard/barters');
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Кекс')).toBeVisible();
  fireEvent.change(within(dialog).getByLabelText('Имя или ник блогера'), {
    target: { value: '@blogger' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body))).toEqual({
    query: { serverId: base.serverId, from: base.from, to: base.to, department: '' },
    documentKey: 'a'.repeat(64),
    bloggerName: '@blogger',
  });
  expect(await screen.findByText('Имя сохранено')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('auto-refresh preserves an unsaved name; changing city aborts the request and closes stale details', async () => {
  const view = render(page());
  await screen.findByText('0001');
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }));
  fireEvent.change(screen.getByLabelText('Имя или ник блогера'), { target: { value: '@draft' } });
  view.rerender(page(base, 1));
  await waitFor(() => expect(loadControls).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('Имя или ник блогера')).toHaveValue('@draft');
  const signal = vi.mocked(loadControls).mock.calls[1][1];
  view.rerender(page({ ...base, serverId: 'astana-chain' }, 1));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Имя сохранено')).toBeNull();
});
it('uses group identity for the unnamed row and sends Excel through the native-capable download helper', async () => {
  render(page());
  await screen.findByText('0001');
  fireEvent.click(screen.getByRole('button', { name: 'По блогерам' }));
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }));
  expect(await screen.findByText('0001')).toBeVisible();
  const blob = new Blob(['xlsx']);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }));
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }));
  await waitFor(() =>
    expect(download).toHaveBeenCalledWith(blob, 'iiko-barters-2026-09-01-2026-09-08.xlsx'),
  );
  vi.unstubAllGlobals();
});
it('failed name save keeps the editor and reports the failure', async () => {
  vi.mocked(request).mockRejectedValue(new Error('offline'));
  render(page());
  await screen.findByText('0001');
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }));
  fireEvent.change(screen.getByLabelText('Имя или ник блогера'), { target: { value: '@draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toBeVisible();
  expect(screen.getByLabelText('Имя или ник блогера')).toHaveValue('@draft');
});

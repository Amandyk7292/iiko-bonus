import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import IikoDashboardPage from './IikoDashboardPage';

const mock = vi.hoisted(() => ({ analytics: vi.fn(), departments: vi.fn() }));
vi.mock('./iiko-dashboard/api', () => ({
  dashboardApi: {
    ...mock,
    servers: async () => ({
      servers: [
        {
          id: 'aktau-chain',
          city: 'aktau',
          kind: 'chain',
          configured: true,
          active: true,
          host: 'test.iiko.it',
        },
      ],
    }),
  },
  exportReport: vi.fn(),
}));
vi.mock('./iiko-dashboard/Invoices', () => ({ default: () => <div data-testid="invoices" /> }));
vi.mock('./iiko-dashboard/Settings', () => ({
  default: () => null,
  parsePreferences: () => ({ auto: false, cards: [], templates: [] }),
}));
beforeEach(() => {
  localStorage.setItem('adminLocale', 'ru');
  vi.clearAllMocks();
  mock.analytics.mockResolvedValue({
    rows: [],
    columns: {},
    serverId: 'aktau-chain',
    fetchedAt: '2026-10-01T08:00:00Z',
  });
  mock.departments.mockResolvedValue({
    departments: [
      { id: 'old', name: 'Основной цех' },
      { id: 'point', name: 'Bulka 16 мкр' },
    ],
  });
  window.history.replaceState(
    null,
    '',
    '/admin/iiko-dashboard?tab=topDishes&server=aktau-chain&from=2026-09-01&to=2026-09-15&department=' +
      encodeURIComponent('Основной цех'),
  );
});
afterEach(() => window.history.replaceState(null, '', '/'));

it('opens Top dishes by URL for dashboard-only users and preserves shared points and dates across navigation', async () => {
  render(
    <I18nProvider>
      <IikoDashboardPage readOnly />
    </I18nProvider>,
  );
  const nav = screen.getByRole('navigation', { name: 'Dashboard' });
  expect(within(nav).getByRole('button', { name: 'Топ блюд' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(nav).queryByRole('button', { name: 'Настройки' })).not.toBeInTheDocument();
  await screen.findByRole('option', { name: 'Основной цех' });
  expect(screen.getByRole('combobox', { name: 'Точка' })).toHaveValue('Основной цех');
  await waitFor(() =>
    expect(mock.analytics).toHaveBeenCalledWith(
      {
        view: 'products',
        serverId: 'aktau-chain',
        from: '2026-09-01',
        to: '2026-09-15',
        department: 'Основной цех',
      },
      expect.any(AbortSignal),
    ),
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Точка' }), {
    target: { value: 'Bulka 16 мкр' },
  });
  await waitFor(() =>
    expect(mock.analytics).toHaveBeenLastCalledWith(
      expect.objectContaining({ department: 'Bulka 16 мкр' }),
      expect.any(AbortSignal),
    ),
  );
  fireEvent.click(within(nav).getByRole('button', { name: 'Накладные' }));
  await screen.findByTestId('invoices');
  expect(new URLSearchParams(window.location.search).get('department')).toBe('Bulka 16 мкр');
  const historyLength = window.history.length;
  await act(async () => window.history.back());
  await screen.findByRole('region', { name: 'Топ блюд' });
  expect(screen.getByRole('combobox', { name: 'Точка' })).toHaveValue('Bulka 16 мкр');
  expect(new URLSearchParams(window.location.search).get('from')).toBe('2026-09-01');
  expect(window.history.length).toBe(historyLength);
});

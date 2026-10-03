import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import IikoDashboardPage from './IikoDashboardPage';

const mocks = vi.hoisted(() => ({ analytics: vi.fn(), departments: vi.fn() }));
vi.mock('./iiko-dashboard/api', () => ({
  dashboardApi: {
    ...mocks,
    servers: async () => ({
      servers: [
        {
          id: 'aktau-chain',
          city: 'aktau',
          kind: 'chain',
          configured: true,
          active: true,
          host: 'fixture.iiko.it',
        },
      ],
    }),
  },
  exportReport: vi.fn(),
}));
vi.mock('./iiko-dashboard/Settings', () => ({
  default: () => null,
  parsePreferences: () => ({ auto: false, cards: [], templates: [] }),
}));
vi.mock('./iiko-dashboard/model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./iiko-dashboard/model')>()),
  today: () => '2026-10-03',
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('adminLocale', 'ru');
  mocks.analytics.mockResolvedValue({
    rows: [],
    columns: {},
    serverId: 'aktau-chain',
    fetchedAt: '2026-10-03T08:00:00Z',
  });
  mocks.departments.mockResolvedValue({
    serverId: 'aktau-chain',
    departments: [{ id: 'fixture-point', name: 'Bulka 16 мкр' }],
  });
  window.history.replaceState(
    null,
    '',
    '/admin/iiko-dashboard?tab=topDishes&server=aktau-chain&from=2026-09-01&to=2026-09-07&department=Bulka%2016%20%D0%BC%D0%BA%D1%80&supplier=fixture&comparison=none',
  );
});
afterEach(() => window.history.replaceState(null, '', '/'));

async function dashboard() {
  const user = userEvent.setup();
  render(
    <I18nProvider>
      <IikoDashboardPage />
    </I18nProvider>,
  );
  await waitFor(() => expect(mocks.analytics).toHaveBeenCalledTimes(1));
  const disclosure = document.querySelector<HTMLDetailsElement>('.id-period-disclosure')!;
  const summary = disclosure.querySelector('summary')!;
  await user.click(summary);
  await user.click(screen.getByRole('button', { name: 'Выбрать период' }));
  return { user, disclosure, summary };
}

it('runs no intermediate report for the first date and commits the reversed range on the second date', async () => {
  const { user, disclosure } = await dashboard();
  await user.click(screen.getByRole('button', { name: /^5 сентября 2026/ }));
  expect(mocks.analytics).toHaveBeenCalledTimes(1);
  expect(new URL(window.location.href).searchParams.get('from')).toBe('2026-09-01');
  expect(disclosure.open).toBe(true);
  await user.click(screen.getByRole('button', { name: /^2 сентября 2026/ }));
  await waitFor(() => expect(mocks.analytics).toHaveBeenCalledTimes(2));
  expect(mocks.analytics).toHaveBeenLastCalledWith(
    {
      view: 'products',
      serverId: 'aktau-chain',
      from: '2026-09-02',
      to: '2026-09-05',
      department: 'Bulka 16 мкр',
    },
    expect.any(AbortSignal),
  );
  expect(disclosure.open).toBe(false);
  expect(screen.queryByLabelText('Месяц')).not.toBeInTheDocument();
  const url = new URL(window.location.href);
  expect(url.searchParams.get('from')).toBe('2026-09-02');
  expect(url.searchParams.get('to')).toBe('2026-09-05');
  expect(url.searchParams.has('supplier')).toBe(false);
  expect(mocks.departments).toHaveBeenCalledTimes(1);
});

it.each([
  ['Сегодня', '2026-10-03', '2026-10-03'],
  ['Вчера', '2026-10-02', '2026-10-02'],
  ['7 дней', '2026-09-27', '2026-10-03'],
  ['Этот месяц', '2026-10-01', '2026-10-03'],
])(
  'immediately applies the %s preset and closes the pending calendar draft',
  async (name, from, to) => {
    const { user, disclosure, summary } = await dashboard();
    await user.click(screen.getByRole('button', { name: /^5 сентября 2026/ }));
    expect(mocks.analytics).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name }));
    await waitFor(() => expect(mocks.analytics).toHaveBeenCalledTimes(2));
    expect(mocks.analytics).toHaveBeenLastCalledWith(
      {
        view: 'products',
        serverId: 'aktau-chain',
        from,
        to,
        department: 'Bulka 16 мкр',
      },
      expect.any(AbortSignal),
    );
    expect(disclosure.open).toBe(false);
    expect(screen.queryByLabelText('Месяц')).not.toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get('from')).toBe(from);
    expect(new URL(window.location.href).searchParams.get('to')).toBe(to);
    await user.click(summary);
    await user.click(screen.getByRole('button', { name }));
    await waitFor(() => expect(mocks.analytics).toHaveBeenCalledTimes(3));
    expect(disclosure.open).toBe(false);
  },
);

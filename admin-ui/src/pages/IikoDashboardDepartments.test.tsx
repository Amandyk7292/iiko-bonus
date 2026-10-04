import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import IikoDashboardPage from './IikoDashboardPage';

const mocks = vi.hoisted(() => ({ departments: vi.fn(), report: vi.fn() }));
vi.mock('./iiko-dashboard/api', () => ({
  dashboardApi: {
    ...mocks,
    servers: async () => ({
      servers: ['aktau', 'astana'].map((city) => ({
        id: `${city}-chain`,
        city,
        kind: 'chain',
        configured: true,
        active: true,
        host: `${city}.iiko.it`,
      })),
    }),
  },
  exportReport: vi.fn(),
}));
vi.mock('./iiko-dashboard/Invoices', () => ({
  default: ({ department }: { department: string }) => (
    <div data-testid="actual-filter">{department}</div>
  ),
}));
vi.mock('./iiko-dashboard/Settings', () => ({
  default: () => null,
  parsePreferences: () => ({ auto: false, cards: [], templates: [] }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.departments.mockImplementation(async (serverId: string) => ({
    serverId,
    departments: [{ id: 'workshop', name: 'Основной цех' }],
  }));
  window.history.replaceState(
    null,
    '',
    '/admin/iiko-dashboard?tab=invoices&server=aktau-chain&from=2026-09-01&to=2026-09-15',
  );
});
afterEach(() => window.history.replaceState(null, '', '/'));

it('exposes directory errors and retries without resetting the selected report filter', async () => {
  mocks.departments.mockRejectedValueOnce(new Error('offline'));
  window.history.replaceState(
    null,
    '',
    window.location.href + '&department=' + encodeURIComponent('Основной цех'),
  );
  render(
    <I18nProvider>
      <IikoDashboardPage />
    </I18nProvider>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Не удалось обновить список точек и подразделений',
  );
  expect(screen.getByTestId('actual-filter')).toHaveTextContent('Основной цех');
  expect(screen.queryByRole('option', { name: /нет в справочнике/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByRole('option', { name: 'Основной цех' });
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(mocks.departments).toHaveBeenCalledTimes(2);
});

it('retains the last successful directory when refresh fails, then recovers locally', async () => {
  render(
    <I18nProvider>
      <IikoDashboardPage />
    </I18nProvider>,
  );
  await screen.findByRole('option', { name: 'Основной цех' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Подразделение' }), {
    target: { value: 'Основной цех' },
  });
  mocks.departments.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('option', { name: 'Основной цех' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Подразделение' })).toHaveValue('Основной цех');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(mocks.departments).toHaveBeenCalledTimes(3);
});

it('labels an absent department explicitly while preserving a shared filter', async () => {
  window.history.replaceState(
    null,
    '',
    window.location.href + '&department=' + encodeURIComponent('Архивный филиал'),
  );
  render(
    <I18nProvider>
      <IikoDashboardPage />
    </I18nProvider>,
  );
  await screen.findByRole('option', { name: 'Основной цех' });
  const select = screen.getByRole('combobox', { name: 'Подразделение' }) as HTMLSelectElement;
  expect(select.value).toBe('Архивный филиал');
  expect(select.selectedOptions[0].textContent).toBe('Архивный филиал — нет в справочнике');
  expect(screen.getByTestId('actual-filter')).toHaveTextContent('Архивный филиал');
});

it('lists departments without sales and does not reload the directory for a new period', async () => {
  render(
    <I18nProvider>
      <IikoDashboardPage />
    </I18nProvider>,
  );
  await screen.findByRole('option', { name: 'Основной цех' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Подразделение' }), {
    target: { value: 'Основной цех' },
  });
  expect(screen.getByTestId('actual-filter')).toHaveTextContent('Основной цех');
  await act(async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('from', '2026-08-01');
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(mocks.departments).toHaveBeenCalledTimes(1);
  expect(mocks.report).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Город' }), {
    target: { value: 'astana' },
  });
  await waitFor(() => expect(mocks.departments).toHaveBeenCalledTimes(2));
  expect(mocks.departments).toHaveBeenLastCalledWith('astana-chain', expect.any(AbortSignal));
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import { dashboardApi } from './api';
import Settings, { type Preferences } from './Settings';
import type { Server } from './model';

vi.mock('./api', () => ({
  dashboardApi: { saveServer: vi.fn(), deleteServer: vi.fn() },
  download: vi.fn(),
}));

const server: Server = {
  id: 'aktau-chain',
  host: 'bulka-co.iiko.it',
  city: 'aktau',
  kind: 'chain',
  active: true,
  configured: true,
};
const preferences: Preferences = {
  cards: ['revenue'],
  templates: [],
  auto: true,
};

beforeEach(() => vi.clearAllMocks());

it('adds a server with city credentials and returns the refreshed list', async () => {
  const next = [
    server,
    {
      ...server,
      id: 'bulka-19a-mkr-11-dom',
      host: 'bulka-19a-mkr-11-dom.iiko.it',
      kind: 'rms' as const,
    },
  ];
  vi.mocked(dashboardApi.saveServer).mockResolvedValue({ servers: next });
  const onServersChange = vi.fn();
  render(
    <I18nProvider>
      <Settings
        servers={[server]}
        preferences={preferences}
        onChange={vi.fn()}
        onServersChange={onServersChange}
      />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Добавить сервер' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Адрес сервера'), {
    target: { value: 'https://bulka-19a-mkr-11-dom.iiko.it/' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(dashboardApi.saveServer).toHaveBeenCalledWith({
      host: 'https://bulka-19a-mkr-11-dom.iiko.it/',
      city: 'aktau',
      kind: 'rms',
      useCityCredentials: true,
      login: '',
      password: '',
    }),
  );
  expect(onServersChange).toHaveBeenCalledWith(next);
});

it('asks before removing a server and returns the refreshed list', async () => {
  vi.mocked(dashboardApi.deleteServer).mockResolvedValue({ servers: [] });
  const onServersChange = vi.fn();
  render(
    <I18nProvider>
      <Settings
        servers={[server]}
        preferences={preferences}
        onChange={vi.fn()}
        onServersChange={onServersChange}
      />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Удалить bulka-co.iiko.it' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('bulka-co.iiko.it')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
  await waitFor(() => expect(dashboardApi.deleteServer).toHaveBeenCalledWith('aktau-chain'));
  expect(onServersChange).toHaveBeenCalledWith([]);
});

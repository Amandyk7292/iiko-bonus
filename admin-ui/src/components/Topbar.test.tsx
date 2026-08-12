import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import {
  STAFF_PUSH_LOGOUT_FAILED,
  STAFF_PUSH_LOGOUT_ROUTE_REQUIRED,
} from '../lib/staff-push-bridge';
import { FeedbackProvider } from './Feedback';
import Topbar from './Topbar';

const setSoundEnabled = vi.hoisted(() => vi.fn());
const unregisterBeforeLogout = vi.hoisted(() => vi.fn());

vi.mock('./StaffPushControl', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef<
      { unregisterBeforeLogout: () => Promise<void> },
      Record<string, unknown>
    >(function MockStaffPushControl(_props, ref) {
      React.useImperativeHandle(ref, () => ({ unregisterBeforeLogout }));
      return null;
    }),
  };
});

vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtime: () => ({
    summary: null,
    connectionStatus: 'online',
    soundEnabled: true,
    setSoundEnabled,
  }),
}));

vi.mock('./AdminGlobalSearch', () => ({
  default: () => <button type="button">Поиск</button>,
}));

const locations = [
  {
    id: 'astana-2',
    name: 'Bulka — Улы Дала',
    address: 'Улы Дала, 67',
    city: 'Астана',
    active: true,
  },
  {
    id: 'aktau-1',
    name: 'ЖК Дукат',
    address: '17-й микрорайон, 1',
    city: 'Актау',
    active: true,
  },
  {
    id: 'astana-1',
    name: 'Bulka — Кабанбай батыра',
    address: 'Кабанбай батыра, 46а',
    city: 'Астана',
    active: true,
  },
];

function topbar(
  selectedBranchId: string,
  onBranchChange: (branchId: string) => void,
  cashierMode = false,
) {
  return (
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <FeedbackProvider>
          <Topbar
            scopeLocations={locations}
            selectedBranchId={selectedBranchId}
            onBranchChange={onBranchChange}
            cashierMode={cashierMode}
          />
        </FeedbackProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}

describe('Topbar city and branch scope', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    setSoundEnabled.mockClear();
    unregisterBeforeLogout.mockReset().mockResolvedValue(undefined);
    window.history.replaceState({}, '', '/admin/operations');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('asks for a city first and then shows only that city branches', () => {
    const onBranchChange = vi.fn();
    const view = render(topbar('', onBranchChange));

    const citySelect = screen.getByRole('combobox', {
      name: 'Город для фильтрации данных',
    });
    expect(citySelect).toHaveValue('');
    expect(screen.queryByRole('combobox', { name: /Филиал города/ })).not.toBeInTheDocument();

    fireEvent.change(citySelect, { target: { value: 'астана' } });
    const cityScope = onBranchChange.mock.calls[0]?.[0] as string;
    expect(cityScope).toContain('city:');
    expect(cityScope).toContain('astana-1,astana-2');

    view.rerender(topbar(cityScope, onBranchChange));
    const branchSelect = screen.getByRole('combobox', {
      name: 'Филиал города Астана',
    });
    const options = within(branchSelect).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Все филиалы города',
      'Bulka — Кабанбай батыра',
      'Bulka — Улы Дала',
    ]);
    expect(branchSelect).toHaveValue(cityScope);
    expect(within(branchSelect).queryByText('ЖК Дукат')).not.toBeInTheDocument();
  });

  it('returns to all branches only through the all-cities option', () => {
    const onBranchChange = vi.fn();
    render(topbar('aktau-1', onBranchChange));

    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Город для фильтрации данных',
      }),
      { target: { value: '' } },
    );

    expect(onBranchChange).toHaveBeenCalledWith('');
  });

  it('explains the icon-only notification action on hover', () => {
    render(topbar('', vi.fn()));

    expect(screen.getByRole('button', { name: 'Операционные уведомления' })).toHaveAttribute(
      'title',
      'Операционные уведомления',
    );
  });

  it('shows a cashier branch, live connection and labelled sound control without selectors', () => {
    render(topbar('aktau-1', vi.fn(), true));

    expect(screen.getByText('ЖК Дукат')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Связь с заказами: Онлайн' })).toHaveTextContent(
      'Онлайн',
    );
    const sound = screen.getByRole('button', { name: 'Звук включён' });
    expect(sound).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(sound);
    expect(setSoundEnabled).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Push/ })).not.toBeInTheDocument();
  });

  it.each([
    {
      name: 'server failure',
      response: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    },
    {
      name: 'offline failure',
      response: () => Promise.reject(new TypeError('offline')),
    },
  ])('keeps the session visible and allows retry after $name', async ({ response }) => {
    const unauthorized = vi.fn();
    window.addEventListener('unauthorized', unauthorized);
    vi.stubGlobal('fetch', vi.fn(response));
    const user = userEvent.setup();
    render(topbar('', vi.fn()));

    await user.click(screen.getByRole('button', { name: 'Выйти из системы' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось выйти: сервер не подтвердил завершение сессии',
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Выйти из системы' })).toBeEnabled(),
    );
    expect(unauthorized).not.toHaveBeenCalled();
    window.removeEventListener('unauthorized', unauthorized);
  });

  it('does not revoke the server session until native push intent clears on retry', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    unregisterBeforeLogout
      .mockRejectedValueOnce(new Error(STAFF_PUSH_LOGOUT_FAILED))
      .mockResolvedValueOnce(undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const unauthorized = vi.fn();
    window.addEventListener('unauthorized', unauthorized);
    const user = userEvent.setup();
    render(topbar('aktau-1', vi.fn(), true));

    await user.click(screen.getByRole('button', { name: 'Выйти из системы' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось отключить push на устройстве',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(unauthorized).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Выйти из системы' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/admin/api/logout', expect.anything()));
    expect(unregisterBeforeLogout).toHaveBeenCalledTimes(2);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    window.removeEventListener('unauthorized', unauthorized);
  });

  it('allows server logout when a legacy embedded app reports no push capability', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const unauthorized = vi.fn();
    window.addEventListener('unauthorized', unauthorized);
    const user = userEvent.setup();
    render(topbar('aktau-1', vi.fn(), true));

    await user.click(screen.getByRole('button', { name: 'Выйти из системы' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/admin/api/logout', expect.anything()));
    expect(unregisterBeforeLogout).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    window.removeEventListener('unauthorized', unauthorized);
  });

  it('keeps a modern embedded session active outside kitchen and explains how to log out', async () => {
    window.history.replaceState({}, '', '/admin/orders?embedded=app');
    unregisterBeforeLogout.mockRejectedValue(new Error(STAFF_PUSH_LOGOUT_ROUTE_REQUIRED));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const unauthorized = vi.fn();
    window.addEventListener('unauthorized', unauthorized);
    const user = userEvent.setup();
    render(topbar('aktau-1', vi.fn(), true));

    await user.click(screen.getByRole('button', { name: 'Выйти из системы' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Для безопасного выхода вернитесь на экран кухни и повторите попытку.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(unauthorized).not.toHaveBeenCalled();
    expect(unregisterBeforeLogout).toHaveBeenCalledTimes(1);
    window.removeEventListener('unauthorized', unauthorized);
  });
});

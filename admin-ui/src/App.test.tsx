import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './lib/i18n';
import { BrowserRouter } from './lib/router';

const apiMocks = vi.hoisted(() => ({
  session: vi.fn(),
  login: vi.fn(),
  requestAdminPhoneLogin: vi.fn(),
  verifyAdminPhoneLogin: vi.fn(),
  exchangeWhatsAppOperatorAccess: vi.fn(),
  getAdminScope: vi.fn(),
}));

vi.mock('./lib/api', () => {
  class ApiError extends Error {
    code?: string;

    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    ApiError,
    api: apiMocks,
    getAdminBranchScope: () => '',
    setAdminBranchScope: vi.fn(),
  };
});

vi.mock('./lib/admin-realtime', () => ({
  AdminRealtimeProvider: ({ children }: { children: React.ReactNode }) => children,
  useAdminRealtime: () => ({ summary: null }),
}));

vi.mock('./components/Topbar', () => ({
  default: ({ operatorMode, cashierMode }: { operatorMode?: boolean; cashierMode?: boolean }) => (
    <div data-testid="topbar">
      {operatorMode ? 'operator-topbar' : cashierMode ? 'cashier-topbar' : 'full-topbar'}
    </div>
  ),
}));

vi.mock('./pages/OperationsPage', () => ({
  default: () => <div>operations-page</div>,
}));
vi.mock('./pages/CouriersPage', () => ({
  default: () => <div>couriers-page</div>,
}));
vi.mock('./pages/OrdersPage', () => ({
  default: ({ role }: { role: string }) => <div>orders-page:{role}</div>,
}));
vi.mock('./pages/KitchenPage', () => ({
  default: () => <div>kitchen-page</div>,
}));
vi.mock('./pages/WhatsAppPage', () => ({
  default: ({ role }: { role: string }) => <div>whatsapp-page:{role}</div>,
}));

import App, { normalizeNumberInputValue } from './App';

const renderApp = () =>
  render(
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <App />
      </I18nProvider>
    </BrowserRouter>,
  );

describe('Admin application authentication and role guards', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('adminLocale', 'ru');
    apiMocks.session.mockReset();
    apiMocks.login.mockReset();
    apiMocks.requestAdminPhoneLogin.mockReset();
    apiMocks.verifyAdminPhoneLogin.mockReset();
    apiMocks.exchangeWhatsAppOperatorAccess.mockReset();
    apiMocks.getAdminScope.mockReset().mockResolvedValue({ locations: [] });
    window.history.replaceState({}, '', '/admin/');
  });

  it('signs in with password and opens the first allowed page', async () => {
    apiMocks.session.mockRejectedValue(new Error('no session'));
    apiMocks.login.mockResolvedValue({
      user: { username: 'manager', role: 'branch_manager', branchIds: [] },
    });
    const user = userEvent.setup();
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Управление Bulka' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Пароль'), 'safe-password');
    await user.click(screen.getByRole('button', { name: 'Войти в систему' }));

    expect(await screen.findByText('operations-page')).toBeInTheDocument();
    expect(apiMocks.login).toHaveBeenCalledWith('admin', 'safe-password', '');
  });

  it('redirects every role away from a forbidden privileged route', async () => {
    for (const role of ['branch_manager', 'operator', 'marketer', 'editor', 'viewer']) {
      apiMocks.session.mockResolvedValueOnce({
        user: { username: role, role, branchIds: [] },
      });
      window.history.replaceState({}, '', '/admin/access');
      const view = renderApp();
      expect(await screen.findByText('operations-page')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/admin/operations');
      view.unmount();
    }
  });

  it('routes couriers to their scoped workspace', async () => {
    apiMocks.session.mockResolvedValue({
      user: { username: 'courier', role: 'courier', branchIds: [] },
    });
    window.history.replaceState({}, '', '/admin/security');
    renderApp();

    expect(await screen.findByText('couriers-page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/couriers');
  });

  it('routes a cashier to the kitchen first and collapses the sidebar', async () => {
    apiMocks.session.mockResolvedValue({
      user: {
        username: 'cashier.aktau',
        role: 'cashier',
        branchIds: ['11111111-1111-4111-8111-111111111111'],
      },
    });
    window.history.replaceState({}, '', '/admin/access');
    renderApp();

    expect(await screen.findByText('kitchen-page')).toBeInTheDocument();
    expect(screen.getByTestId('topbar')).toHaveTextContent('cashier-topbar');
    expect(window.location.pathname).toBe('/admin/kitchen');
    await waitFor(() =>
      expect(document.querySelector('.sagi-shell')).toHaveClass('sidebar-is-collapsed'),
    );
  });

  it('keeps a WhatsApp operator inside the single permitted workspace', async () => {
    apiMocks.session.mockResolvedValue({
      user: { username: 'wa', role: 'whatsapp_operator', branchIds: [] },
    });
    window.history.replaceState({}, '', '/admin/orders');
    renderApp();

    expect(await screen.findByText('whatsapp-page:whatsapp_operator')).toBeInTheDocument();
    expect(screen.getByTestId('topbar')).toHaveTextContent('operator-topbar');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/whatsapp');
  });

  it('exchanges and removes an operator magic token from browser history', async () => {
    apiMocks.exchangeWhatsAppOperatorAccess.mockResolvedValue({
      user: { username: 'wa', role: 'whatsapp_operator', branchIds: [] },
    });
    window.history.replaceState({}, '', '/admin/whatsapp-access#secure-magic-token');
    renderApp();

    expect(await screen.findByText('whatsapp-page:whatsapp_operator')).toBeInTheDocument();
    expect(apiMocks.exchangeWhatsAppOperatorAccess).toHaveBeenCalledWith('secure-magic-token');
    expect(window.location.hash).toBe('');
  });

  it('drops the authenticated shell when the API announces an invalid session', async () => {
    apiMocks.session.mockResolvedValue({
      user: { username: 'viewer', role: 'viewer', branchIds: [] },
    });
    renderApp();
    expect(await screen.findByText('operations-page')).toBeInTheDocument();

    fireEvent(window, new Event('unauthorized'));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Управление Bulka' })).toBeInTheDocument(),
    );
  });

  it('normalizes leading zeroes without changing a legitimate zero', () => {
    expect(normalizeNumberInputValue('00042')).toBe('42');
    expect(normalizeNumberInputValue('-00042')).toBe('-42');
    expect(normalizeNumberInputValue('0')).toBe('0');
  });
});

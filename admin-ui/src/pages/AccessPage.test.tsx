import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import AccessPage from './AccessPage';

const apiMocks = vi.hoisted(() => ({
  getAccessProfiles: vi.fn(),
  getFulfillmentLocations: vi.fn(),
  getOnlineOrdering: vi.fn(),
  createAccessProfile: vi.fn(),
  updateAccessProfile: vi.fn(),
  resetAccessPassword: vi.fn(),
  updateOnlineOrdering: vi.fn(),
}));

vi.mock('../lib/api', () => ({ api: apiMocks }));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => ({ toast: vi.fn() }),
}));

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';

const renderPage = () =>
  render(
    <I18nProvider>
      <AccessPage />
    </I18nProvider>,
  );

describe('cashier access management', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    apiMocks.getAccessProfiles.mockReset().mockResolvedValue({
      profiles: [],
      configuredUsers: [],
    });
    apiMocks.getFulfillmentLocations.mockReset().mockResolvedValue({
      locations: [{ id: BRANCH_ID, name: 'Актау 17', address: '17 мкр., 55' }],
    });
    apiMocks.getOnlineOrdering.mockReset().mockResolvedValue({ config: { disabled: false } });
    apiMocks.createAccessProfile.mockReset().mockResolvedValue({ success: true, profile: {} });
    apiMocks.updateAccessProfile.mockReset().mockResolvedValue({ success: true, profile: {} });
    apiMocks.resetAccessPassword.mockReset().mockResolvedValue({ success: true });
    apiMocks.updateOnlineOrdering
      .mockReset()
      .mockResolvedValue({ success: true, config: { disabled: false } });
  });

  it('creates a cashier with username, password and exactly one branch', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Роли и доступ' });

    await user.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
    const dialog = screen.getByRole('dialog', { name: 'Новый сотрудник' });
    expect(within(dialog).getByRole('button', { name: 'Кассир по логину' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.type(within(dialog).getByLabelText('Логин'), 'cashier.aktau.1');
    await user.type(within(dialog).getByLabelText('Имя сотрудника'), 'Кассир Актау');
    await user.type(within(dialog).getByLabelText('Пароль'), 'Bulka2026Secure');
    await user.click(within(dialog).getByRole('radio', { name: /Актау 17/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Добавить сотрудника' }));

    await waitFor(() =>
      expect(apiMocks.createAccessProfile).toHaveBeenCalledWith({
        username: 'cashier.aktau.1',
        password: 'Bulka2026Secure',
        displayName: 'Кассир Актау',
        role: 'cashier',
        branchIds: [BRANCH_ID],
      }),
    );
  });

  it('resets a cashier password without ever loading the old password', async () => {
    apiMocks.getAccessProfiles.mockResolvedValue({
      profiles: [
        {
          username: 'cashier.aktau.1',
          display_name: 'Кассир Актау',
          role: 'cashier',
          branch_ids: [BRANCH_ID],
          active: true,
          authMethod: 'password',
          passwordConfigured: true,
        },
      ],
      configuredUsers: ['cashier.aktau.1'],
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Кассир Актау');

    expect(screen.queryByDisplayValue(/Bulka/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Сменить пароль' }));
    const dialog = screen.getByRole('dialog', { name: 'Сменить пароль' });
    await user.type(within(dialog).getByLabelText('Новый пароль'), 'NewBulka2027');
    await user.click(within(dialog).getByRole('button', { name: 'Сменить пароль' }));

    await waitFor(() =>
      expect(apiMocks.resetAccessPassword).toHaveBeenCalledWith('cashier.aktau.1', 'NewBulka2027'),
    );
  });
});

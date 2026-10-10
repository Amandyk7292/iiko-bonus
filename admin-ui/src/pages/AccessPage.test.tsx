import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, useI18n } from '../lib/i18n';
import AccessPage from './AccessPage';
import { BrowserRouter } from '../lib/router';

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
  useFeedback: () => ({ toast: vi.fn(), confirm: vi.fn().mockResolvedValue(false) }),
}));

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';

const renderPage = () =>
  render(
    <BrowserRouter>
      <I18nProvider>
        <AccessPage />
      </I18nProvider>
    </BrowserRouter>,
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
    await user.click(screen.getByRole('button', { name: /Кассир Актау.*cashier\.aktau\.1/ }));
    await user.click(screen.getByRole('button', { name: 'Сменить пароль' }));
    const dialog = screen.getByRole('dialog', { name: 'Сменить пароль' });
    await user.type(within(dialog).getByLabelText('Новый пароль'), 'NewBulka2027');
    await user.click(within(dialog).getByRole('button', { name: 'Сменить пароль' }));

    await waitFor(() =>
      expect(apiMocks.resetAccessPassword).toHaveBeenCalledWith('cashier.aktau.1', 'NewBulka2027'),
    );
  });

  it('creates a learning employee by password without requiring a cashier branch', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Добавить сотрудника' }));
    const dialog = screen.getByRole('dialog', { name: 'Новый сотрудник' });
    await user.click(within(dialog).getByRole('button', { name: 'Сотрудник · обучение' }));
    await user.type(within(dialog).getByLabelText('Логин'), 'baker.aktau.1');
    await user.type(within(dialog).getByLabelText('Имя сотрудника'), 'Пекарь Актау');
    await user.type(within(dialog).getByLabelText('Пароль'), 'Training2026Secure');
    expect(within(dialog).queryByLabelText('Должность и права')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Телефон')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Добавить сотрудника' }));
    await waitFor(() =>
      expect(apiMocks.createAccessProfile).toHaveBeenCalledWith({
        username: 'baker.aktau.1',
        password: 'Training2026Secure',
        displayName: 'Пекарь Актау',
        role: 'employee',
        branchIds: [],
      }),
    );
  });

  it('locks password employee role and provides a password reset', async () => {
    apiMocks.getAccessProfiles.mockResolvedValue({
      profiles: [
        {
          username: 'baker.1',
          display_name: 'Пекарь',
          role: 'employee',
          branch_ids: [],
          active: true,
          authMethod: 'password',
          passwordConfigured: true,
        },
      ],
      configuredUsers: ['baker.1'],
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Пекарь.*baker\.1/ }));
    expect(screen.getByRole('combobox', { name: 'Должность и права' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Сменить пароль' }));
    const dialog = screen.getByRole('dialog', { name: 'Сменить пароль' });
    await user.type(within(dialog).getByLabelText('Новый пароль'), 'Employee2027Secure');
    await user.click(within(dialog).getByRole('button', { name: 'Сменить пароль' }));
    await waitFor(() =>
      expect(apiMocks.resetAccessPassword).toHaveBeenCalledWith('baker.1', 'Employee2027Secure'),
    );
  });

  it('persists a collapsed active switch and rolls back a rejected change', async () => {
    apiMocks.getAccessProfiles.mockResolvedValue({
      configuredUsers: ['cashier.aktau.1'],
      profiles: [
        {
          username: 'cashier.aktau.1',
          display_name: 'Кассир Актау',
          role: 'cashier',
          branch_ids: [BRANCH_ID],
          active: true,
        },
      ],
    });
    let reject!: (reason: Error) => void;
    apiMocks.updateAccessProfile.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const user = userEvent.setup();
    renderPage();
    const toggle = await screen.findByRole('checkbox', { name: 'Активен: Кассир Актау' });
    expect(screen.queryByRole('button', { name: 'Сохранить права' })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Добавить сотрудника' })).toBeDisabled();
    expect(apiMocks.updateAccessProfile).toHaveBeenCalledWith('cashier.aktau.1', {
      displayName: 'Кассир Актау',
      role: 'cashier',
      branchIds: [BRANCH_ID],
      active: false,
    });
    await act(async () => {
      reject(new Error('Сервер недоступен'));
    });
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Сервер недоступен');
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    expect(apiMocks.updateAccessProfile).toHaveBeenCalledTimes(2);
  });

  it('saves active state using the persisted permissions and retains unrelated name drafts', async () => {
    apiMocks.getAccessProfiles.mockResolvedValue({
      configuredUsers: ['operator.1'],
      profiles: [
        {
          username: 'operator.1',
          display_name: 'Оператор',
          role: 'operator',
          branch_ids: [BRANCH_ID],
          active: true,
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Оператор.*operator\.1/ }));
    await user.clear(screen.getByLabelText('Имя сотрудника'));
    await user.type(screen.getByLabelText('Имя сотрудника'), 'Новый черновик');
    await user.click(screen.getByRole('checkbox', { name: 'Активен: Новый черновик' }));
    await waitFor(() => expect(apiMocks.updateAccessProfile).toHaveBeenCalled());
    expect(apiMocks.updateAccessProfile.mock.calls[0][1].displayName).toBe('Оператор');
    expect(screen.getByLabelText('Имя сотрудника')).toHaveValue('Новый черновик');
  });

  it('retains a staff draft on Escape and footer cancel until discard is confirmed', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Добавить сотрудника' }));
    await user.type(screen.getByLabelText('Имя сотрудника'), 'Черновик');
    await user.keyboard('{Escape}');
    let confirm = screen.getByRole('dialog', { name: 'Закрыть без сохранения?' });
    await user.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    expect(screen.getByLabelText('Имя сотрудника')).toHaveValue('Черновик');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Новый сотрудник' })).getByRole('button', {
        name: 'Отмена',
      }),
    );
    confirm = screen.getByRole('dialog', { name: 'Закрыть без сохранения?' });
    await user.click(within(confirm).getByRole('button', { name: 'Сбросить и продолжить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiMocks.createAccessProfile).not.toHaveBeenCalled();
  });

  it('retains later permission edits while a submitted profile snapshot is saving', async () => {
    apiMocks.getAccessProfiles.mockResolvedValue({
      configuredUsers: ['operator.1'],
      profiles: [
        {
          username: 'operator.1',
          display_name: 'Оператор',
          role: 'operator',
          branch_ids: [BRANCH_ID],
          active: true,
        },
      ],
    });
    let finish!: (value: unknown) => void;
    apiMocks.updateAccessProfile.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Оператор.*operator\.1/ }));
    const name = screen.getByLabelText('Имя сотрудника');
    await user.clear(name);
    await user.type(name, 'Первая версия');
    await user.click(screen.getByRole('button', { name: 'Сохранить права' }));
    await user.clear(name);
    await user.type(name, 'Поздний черновик');
    await act(async () => {
      finish({ success: true });
    });
    expect(name).toHaveValue('Поздний черновик');
    expect(apiMocks.updateAccessProfile.mock.calls[0][1].displayName).toBe('Первая версия');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it('retains an existing permission draft when a new employee triggers a directory refresh', async () => {
    apiMocks.getAccessProfiles.mockResolvedValue({
      configuredUsers: ['operator.1'],
      profiles: [
        {
          username: 'operator.1',
          display_name: 'Оператор',
          role: 'operator',
          branch_ids: [BRANCH_ID],
          active: true,
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Оператор.*operator\.1/ }));
    await user.clear(screen.getByLabelText('Имя сотрудника'));
    await user.type(screen.getByLabelText('Имя сотрудника'), 'Сохранённый черновик');
    await user.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
    const dialog = screen.getByRole('dialog', { name: 'Новый сотрудник' });
    await user.type(within(dialog).getByLabelText('Логин'), 'cashier.new');
    await user.type(within(dialog).getByLabelText('Имя сотрудника'), 'Новый кассир');
    await user.type(within(dialog).getByLabelText('Пароль'), 'Bulka2026Secure');
    await user.click(within(dialog).getByRole('radio', { name: /Актау 17/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Добавить сотрудника' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiMocks.getAccessProfiles).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Имя сотрудника')).toHaveValue('Сохранённый черновик');
    expect(apiMocks.updateAccessProfile).not.toHaveBeenCalled();
  });

  it('retains existing permission drafts when changing the interface language', async () => {
    apiMocks.getAccessProfiles.mockResolvedValue({
      configuredUsers: ['operator.1'],
      profiles: [
        {
          username: 'operator.1',
          display_name: 'Оператор',
          role: 'operator',
          branch_ids: [BRANCH_ID],
          active: true,
        },
      ],
    });
    function LocaleSwitch() {
      const { setLocale } = useI18n();
      return <button onClick={() => setLocale('kk')}>Сменить язык</button>;
    }
    const user = userEvent.setup();
    render(
      <BrowserRouter>
        <I18nProvider>
          <LocaleSwitch />
          <AccessPage />
        </I18nProvider>
      </BrowserRouter>,
    );
    await user.click(await screen.findByRole('button', { name: /Оператор.*operator\.1/ }));
    await user.clear(screen.getByLabelText('Имя сотрудника'));
    await user.type(screen.getByLabelText('Имя сотрудника'), 'Черновик для двух языков');
    await user.click(screen.getByRole('button', { name: 'Сменить язык' }));
    expect(screen.getByDisplayValue('Черновик для двух языков')).toBeVisible();
    expect(apiMocks.getAccessProfiles).toHaveBeenCalledTimes(1);
  });
});

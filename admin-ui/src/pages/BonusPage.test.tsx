import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, request } from '../lib/api';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import { FeedbackProvider } from '../components/Feedback';
import BonusPage from './BonusPage';
import ReferralReport from './ReferralReport';

vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  request: vi.fn(),
}));
const settings = {
  base_cashback_percent: 2,
  max_discount_percent: 30,
  bonus_referral: { enabled: true, inviter_bonus: 1000, friend_bonus: 500, min_first_order: 0 },
  bonus_expiration: { enabled: false, expiration_days: 90, notify_before_days: 30 },
};
const invitation = {
  id: 'invite-123',
  created_at: '2026-10-03T09:00:00Z',
  status: 'registered',
  review_state: 'pending',
  risk_reasons: ['shared_device'],
  rewarded_at: null,
  reversed_at: null,
  branch_name: 'Тестовая точка',
  purchased_at: '2026-10-03T10:00:00Z',
  reward_referrer: 1000,
  reward_friend: 500,
  last_error: 'Ошибка тестового начисления',
  first_purchase_source: 'pos',
  amount: 2000,
  refunded_amount: 500,
  owner_name: 'Тестовый клиент',
  friend_name: 'Новый клиент',
  owner_id: 'owner-123',
  referred_customer_id: 'friend-123',
  reviewed_at: null,
  reviewed_by: null,
  review_note: null,
};
const device = {
  id: 'register-1',
  branchId: 'branch-1',
  branch: { id: 'branch-1', name: 'Тестовая точка', city: 'Актау', address: '' },
  name: 'Тестовая касса',
  role: 'register',
  active: true,
  online: true,
  health: 'error',
  pluginVersion: '1.0',
  outdated: true,
  incompatible: true,
  printerStatus: 'error',
  connectedToMain: false,
  queues: { loyaltyFailed: 3 },
  statuses: { plugin: 'reconnecting' },
  lastError: 'Касса не синхронизирована',
  pairedAt: '2026-10-01T00:00:00Z',
  lastSeenAt: '2026-10-03T10:00:00Z',
};
const report = {
  summary: {
    invitations: 1,
    purchases: 1,
    revenue: 2000,
    awarded: 0,
    reversed: 0,
    debt_created: 0,
    review: 1,
    delayed: 1,
  },
  branches: [],
  items: [invitation],
  canReview: true,
  posError: false,
  health: {
    delayed: 1,
    pendingNotifications: 2,
    failedNotifications: 1,
    items: [
      {
        id: 'delayed-1',
        branch_name: 'Тестовая точка',
        purchased_at: '2026-10-03T10:00:00Z',
        last_error: 'Повторное начисление ожидает связи',
      },
    ],
  },
  pos: {
    success: true,
    canManage: false,
    checkedAt: '2026-10-03T10:00:00Z',
    summary: { total: 1, online: 1, attention: 1, outdated: 1, openCases: 1 },
    devices: [device],
    cases: [
      {
        id: 'case-1',
        status: 'retrying',
        severity: 'critical',
        title: 'Проверить чек',
        details: 'Чек требует повторной сверки',
        last_seen_at: '2026-10-03T10:00:00Z',
      },
    ],
    policy: {},
  },
};
const race = { success: true, items: [], totals: { completed: 0, rewardAmount: 0 } };
const directoryStatus = { success: true, status: {
  state: 'ok', lastAttemptAt: '2026-10-05T05:00:00Z', lastSuccessAt: '2026-10-05T05:00:00Z',
  lastFailureAt: null, failureSince: null, consecutiveFailures: 0, cashierCount: 71,
} };
const mockRequest = vi.mocked(request);
const wrap = (content: React.ReactNode) => (
  <BrowserRouter>
    <I18nProvider>
      <FeedbackProvider>{content}</FeedbackProvider>
    </I18nProvider>
  </BrowserRouter>
);

beforeEach(() => {
  localStorage.setItem('adminLocale', 'ru');
  localStorage.removeItem('adminSelectedBranchId');
  window.history.replaceState({}, '', '/bonus');
  vi.spyOn(api, 'getSettings').mockResolvedValue(settings);
  vi.spyOn(api, 'updateSettings').mockResolvedValue({ success: true });
  mockRequest
    .mockReset()
    .mockImplementation(
      async (url) => (url.startsWith('/bonus/cashier-race') ? race
        : url === '/bonus/cashier-directory-status' ? directoryStatus
        : url.startsWith('/bonus/cashier-payroll?') ? {
          success: true, month: new URLSearchParams(url.split('?')[1]).get('month'), canMarkPaid: false,
          items: [], totals: { completed: 0, rewardAmount: 0, paidAmount: 0, outstandingAmount: 0 },
        } : report) as never,
    );
});
afterEach(() => vi.restoreAllMocks());

describe('bonus workspace', () => {
  it('locks editable settings during a pending save and retains the draft when that save fails', async () => {
    let fail!: (reason: Error) => void;
    vi.mocked(api.updateSettings).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    render(wrap(<BonusPage />));
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    const cashback = await screen.findByLabelText('Базовый кэшбэк (%)');
    fireEvent.change(cashback, { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(cashback).toBeDisabled();
    expect(screen.getByLabelText('Новому клиенту, ₸ бонусами')).toBeDisabled();
    expect(screen.getByLabelText('Включить списание при длительной неактивности')).toBeDisabled();
    await act(async () => {
      fail(new Error('Не сохранено'));
    });
    expect(cashback).toBeEnabled();
    expect(cashback).toHaveValue(8);
    expect(screen.getByRole('alert')).toHaveTextContent('Не сохранено');
  });

  it('retains empty numeric drafts, rejects invalid ranges and submits an intentional zero', async () => {
    render(wrap(<BonusPage />));
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    const cashback = await screen.findByLabelText('Базовый кэшбэк (%)');
    const friend = screen.getByLabelText('Новому клиенту, ₸ бонусами');
    const save = screen.getByRole('button', { name: 'Сохранить' });
    for (const value of ['', '-1', '101']) {
      fireEvent.change(cashback, { target: { value } });
      expect(cashback).toBe(screen.getByLabelText('Базовый кэшбэк (%)'));
      expect(cashback).toHaveValue(value === '' ? null : Number(value));
      fireEvent.click(save);
      expect(api.updateSettings).not.toHaveBeenCalled();
      expect(cashback).toHaveFocus();
    }
    fireEvent.change(cashback, { target: { value: '0' } });
    expect(cashback).toBe(screen.getByLabelText('Базовый кэшбэк (%)'));
    expect(cashback).toHaveValue(0);
    fireEvent.change(friend, { target: { value: '' } });
    expect(friend).toHaveValue(null);
    fireEvent.click(save);
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(friend).toHaveFocus();
    fireEvent.change(friend, { target: { value: '0' } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          base_cashback_percent: 0,
          bonus_referral: expect.objectContaining({ friend_bonus: 0 }),
        }),
      ),
    );
  });

  it('protects dirty settings on route changes and warns before closing the tab', async () => {
    render(wrap(<BonusPage />));
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    fireEvent.change(await screen.findByLabelText('Базовый кэшбэк (%)'), {
      target: { value: '7' },
    });
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Уровни кэшбэка' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Закрыть без сохранения?' });
    expect(window.location.pathname).toBe('/bonus');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Базовый кэшбэк (%)')).toHaveValue(7);
    fireEvent.click(screen.getByRole('link', { name: 'Уровни кэшбэка' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Сбросить и продолжить',
      }),
    );
    await waitFor(() => expect(window.location.pathname).toBe('/tiers'));
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it('opens cashier competition independently of pending settings and lazily loads reports', async () => {
    vi.mocked(api.getSettings).mockReturnValue(new Promise(() => {}));
    render(wrap(<BonusPage />));
    expect(screen.getByRole('tab', { name: 'Кассиры' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByText('Кассиры не найдены');
    const raceCalls = () => mockRequest.mock.calls.filter(([url]) => url.startsWith('/bonus/cashier-race'));
    expect(raceCalls()).toHaveLength(1);
    expect(raceCalls()[0][2]).toEqual({ branchScope: '' });
    expect(mockRequest.mock.calls.filter(([url]) => url === '/bonus/cashier-directory-status')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Приглашения' }));
    await screen.findByText('Тестовый клиент');
    expect(mockRequest.mock.calls.filter(([url]) => url.startsWith('/bonus/referrals?'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Кассиры' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Приглашения' }));
    expect(screen.getByText('Тестовый клиент')).toBeVisible();
    expect(raceCalls()).toHaveLength(2);
    expect(raceCalls()[1][1]?.signal?.aborted).toBe(true);
  });

  it('opens payroll only on demand and retains rating filters while switching cashier views', async () => {
    localStorage.setItem('adminSelectedBranchId', 'branch-1');
    render(wrap(<BonusPage scope="branch-1" />));
    await screen.findByText('Кассиры не найдены');
    expect(mockRequest.mock.calls.some(([url]) => url.startsWith('/bonus/cashier-payroll'))).toBe(false);
    fireEvent.change(screen.getByLabelText('Найти кассира'), { target: { value: 'Алия' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Ведомость' }));
    await screen.findByText('Начислений за этот месяц нет');
    expect(mockRequest.mock.calls.find(([url]) => url.startsWith('/bonus/cashier-payroll?'))?.[2]).toEqual({ branchScope: '' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Ведомость' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Рейтинг' })).toHaveFocus();
    expect(within(screen.getByRole('tabpanel', { name: 'Рейтинг' })).getByLabelText('Найти кассира')).toHaveValue('Алия');
    expect(screen.getByRole('tab', { name: 'Рейтинг' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Приглашения' }));
    await screen.findByText('Тестовый клиент');
    const payrollCalls = mockRequest.mock.calls.filter(([url]) => url.startsWith('/bonus/cashier-payroll?'));
    expect(payrollCalls).toHaveLength(1);
  });

  it('preserves unsaved settings across tabs and branch changes, then saves all policy fields', async () => {
    const page = render(wrap(<BonusPage scope="branch-1" />));
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    fireEvent.change(await screen.findByLabelText('Базовый кэшбэк (%)'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByLabelText('Включить списание при длительной неактивности'));
    fireEvent.change(screen.getByLabelText('Дней неактивности'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Новому клиенту, ₸ бонусами'), {
      target: { value: '700' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Приглашения' }));
    await screen.findByText('Тестовый клиент');
    page.rerender(wrap(<BonusPage scope="branch-2" />));
    await waitFor(() =>
      expect(mockRequest).toHaveBeenLastCalledWith(
        expect.stringContaining('/bonus/referrals?'),
        {},
        { branchScope: 'branch-2' },
      ),
    );
    expect(screen.getByRole('tab', { name: 'Приглашения' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: /Настройки/ }));
    expect(screen.getByLabelText('Базовый кэшбэк (%)')).toHaveValue(4);
    expect(screen.getByLabelText('Дней неактивности')).toHaveValue(120);
    expect(screen.getByLabelText('Новому клиенту, ₸ бонусами')).toHaveValue(700);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          base_cashback_percent: 4,
          max_discount_percent: 30,
          bonus_expiration: { enabled: true, expiration_days: 120, notify_before_days: 30 },
          bonus_referral: expect.objectContaining({
            inviter_bonus: 1000,
            friend_bonus: 700,
            review_same_device: true,
            max_invites_per_day: 0,
          }),
        }),
      ),
    );
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard tabs and shows settings failure only inside settings', async () => {
    vi.mocked(api.getSettings).mockRejectedValue(new Error('Настройки недоступны'));
    render(wrap(<BonusPage />));
    await screen.findByText('Кассиры не найдены');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Кассиры' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Настройки' })).toHaveFocus();
    expect(screen.getByText('Настройки недоступны')).toBeVisible();
    vi.mocked(api.getSettings).mockResolvedValue(settings);
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    await screen.findByLabelText('Базовый кэшбэк (%)');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Настройки' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Кассиры' })).toHaveFocus();
  });
});

describe('compact referral reports', () => {
  it('ignores completion of a review submitted for a previous scope', async () => {
    let finishReview!: (value: unknown) => void;
    mockRequest.mockImplementation(async (url, _options, requestOptions) => {
      if (url.endsWith('/review'))
        return new Promise((resolve) => {
          finishReview = resolve;
        }) as never;
      return (
        requestOptions?.branchScope === 'branch-2'
          ? { ...report, items: [{ ...invitation, owner_name: 'Клиент второй точки' }] }
          : report
      ) as never;
    });
    const page = render(wrap(<ReferralReport scope="branch-1" />));
    await screen.findByText('Тестовый клиент');
    fireEvent.click(screen.getByRole('button', { name: 'Рассмотреть' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Причина решения'), {
      target: { value: 'Решение первой точки' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отклонить' }));
    page.rerender(wrap(<ReferralReport scope="branch-2" />));
    await screen.findByText('Клиент второй точки');
    fireEvent.click(screen.getByRole('button', { name: 'Рассмотреть' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Причина решения'), {
      target: { value: 'Решение второй точки' },
    });
    const calls = mockRequest.mock.calls.length;
    await act(async () => {
      finishReview({ success: true });
    });
    expect(within(screen.getByRole('dialog')).getByLabelText('Причина решения')).toHaveValue(
      'Решение второй точки',
    );
    expect(mockRequest.mock.calls).toHaveLength(calls);
  });

  it('resets pagination and an open review when changing branch scope, retaining the date range', async () => {
    mockRequest.mockResolvedValue({
      ...report,
      summary: { ...report.summary, invitations: 51 },
    } as never);
    const page = render(wrap(<ReferralReport scope="branch-1" />));
    await screen.findByText('Тестовый клиент');
    fireEvent.change(screen.getByLabelText('С даты'), { target: { value: '2026-09-01' } });
    await screen.findByText('Тестовый клиент');
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    await waitFor(() =>
      expect(mockRequest).toHaveBeenLastCalledWith(
        expect.stringContaining('offset=50'),
        {},
        { branchScope: 'branch-1' },
      ),
    );
    await screen.findByText('Тестовый клиент');
    fireEvent.click(screen.getByRole('button', { name: 'Рассмотреть' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Причина решения'), {
      target: { value: 'Причина для первой точки' },
    });
    page.rerender(wrap(<ReferralReport scope="branch-2" />));
    await waitFor(() =>
      expect(mockRequest).toHaveBeenLastCalledWith(
        expect.stringMatching(/from=2026-09-01.*offset=0$/),
        {},
        { branchScope: 'branch-2' },
      ),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('С даты')).toHaveValue('2026-09-01');
    await screen.findByText('Тестовый клиент');
    fireEvent.click(screen.getByRole('button', { name: 'Рассмотреть' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('Причина решения')).toHaveValue('');
    expect(
      mockRequest.mock.calls
        .filter(([, , options]) => options?.branchScope === 'branch-2')
        .every(([url]) => url.endsWith('offset=0')),
    ).toBe(true);
  });

  it('retains risk details and review safeguards, while requiring a reason for rejection', async () => {
    render(wrap(<ReferralReport />));
    await screen.findByText('Тестовый клиент');
    const details = screen.getByText('Ошибка начисления').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Ошибка начисления'));
    expect(within(details).getByText('Ошибка тестового начисления')).toBeVisible();
    expect(within(details).getByText('owner-123')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Рассмотреть' }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getByRole('button', { name: 'Одобрить' })).toBeDisabled();
    expect(within(modal).getByRole('button', { name: 'Отклонить' })).toBeDisabled();
    fireEvent.change(within(modal).getByLabelText('Причина решения'), {
      target: { value: 'Повторная регистрация' },
    });
    expect(within(modal).getByRole('button', { name: 'Одобрить' })).toBeDisabled();
    fireEvent.click(within(modal).getByRole('button', { name: 'Отклонить' }));
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        '/bonus/referrals/invite-123/review',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'reject', note: 'Повторная регистрация' }),
        },
        { branchScope: '' },
      ),
    );
  });

  it('retains cumulative return bounds and saves the chosen amount without transferring money', async () => {
    render(wrap(<ReferralReport />));
    await screen.findByText('Тестовый клиент');
    fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать возврат на кассе' }));
    const modal = screen.getByRole('dialog');
    const total = within(modal).getByLabelText('Всего возвращено по покупке, ₸');
    const save = within(modal).getByRole('button', { name: 'Зафиксировать возврат на кассе' });
    fireEvent.change(within(modal).getByLabelText('Причина решения'), {
      target: { value: 'Возврат подтверждён' },
    });
    for (const value of ['300', '2100']) {
      fireEvent.change(total, { target: { value } });
      expect(save).toBeDisabled();
    }
    fireEvent.change(total, { target: { value: '1200' } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        '/bonus/referrals/invite-123/review',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'return', note: 'Возврат подтверждён', total: 1200 }),
        },
        { branchScope: '' },
      ),
    );
  });

  it('shows actionable POS warnings and keeps queues, delayed errors and cases in disclosures', async () => {
    render(wrap(<ReferralReport view="health" />));
    await screen.findByText('Тестовая касса · Актау');
    expect(screen.getByText('Несовместимая версия', { exact: false })).toBeVisible();
    const deviceDetails = screen.getByText('Касса не синхронизирована').closest('details')!;
    expect(deviceDetails).not.toHaveAttribute('open');
    fireEvent.click(within(deviceDetails).getByText('Подробности'));
    expect(within(deviceDetails).getByText('Касса не синхронизирована')).toBeVisible();
    expect(within(deviceDetails).getByText('Ошибки бонусов')).toBeVisible();
    const delayedDetails = screen
      .getByText('Повторное начисление ожидает связи')
      .closest('details')!;
    fireEvent.click(within(delayedDetails).getByText('Подробности'));
    expect(within(delayedDetails).getByText('Ошибки отправки')).toBeVisible();
    const cases = screen.getByText('Нерешённые ошибки').closest('details')!;
    fireEvent.click(screen.getByText('Нерешённые ошибки'));
    expect(within(cases).getByText('Чек требует повторной сверки')).toBeVisible();
    expect(within(cases).getByRole('link', { name: 'Диагностика' })).toHaveAttribute(
      'href',
      '/integrations',
    );
    fireEvent.change(screen.getByLabelText('Касса'), { target: { value: 'attention' } });
    expect(screen.getByText('Тестовая касса · Актау')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Найти кассу или точку'), {
      target: { value: 'несуществующая' },
    });
    expect(screen.getByText('Кассы не найдены')).toBeVisible();
  });

  it('does not infer healthy zero cash registers when telemetry was not provided', async () => {
    mockRequest.mockResolvedValue({ ...report, health: undefined, pos: null } as never);
    render(wrap(<ReferralReport view="health" />));
    await screen.findByText('Данные касс недоступны');
    expect(screen.queryByText('Кассы не подключены')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Диагностика' })).not.toBeInTheDocument();
  });

  it('automatically reloads dates and ignores an older in-flight response', async () => {
    let first!: (value: unknown) => void;
    mockRequest
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first = resolve;
          }) as never,
      )
      .mockResolvedValue({
        ...report,
        items: [{ ...invitation, owner_name: 'Новый период' }],
      } as never);
    render(wrap(<ReferralReport />));
    fireEvent.change(screen.getByLabelText('С даты'), { target: { value: '2026-09-01' } });
    await screen.findByText('Новый период');
    await act(async () => {
      first(report);
    });
    expect(screen.queryByText('Тестовый клиент')).not.toBeInTheDocument();
    expect(mockRequest).toHaveBeenLastCalledWith(
      expect.stringContaining('from=2026-09-01'),
      {},
      { branchScope: '' },
    );
  });
});

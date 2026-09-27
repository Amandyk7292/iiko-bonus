import { expect, test } from '@playwright/test';

test('referral reward settings survive save and reload on every screen size', async ({
  page,
}, info) => {
  let settings = {
    base_cashback_percent: 3,
    max_discount_percent: 50,
    bonus_expiration: { enabled: true, expiration_days: 90, notify_before_days: 30 },
    bonus_referral: { enabled: true, inviter_bonus: 1000, friend_bonus: 500, min_first_order: 0 },
  };
  await page.addInitScript(() => localStorage.setItem('adminLocale', 'ru'));
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/events'))
      return route.fulfill({ contentType: 'text/event-stream', body: '' });
    if (path === '/admin/api/settings') {
      if (route.request().method() !== 'GET')
        settings = { ...settings, ...route.request().postDataJSON() };
      return route.fulfill({ json: settings });
    }
    const responses: Record<string, unknown> = {
      '/admin/api/bonus/referrals': {
        success: true,
        summary: { invitations: 0 },
        branches: [],
        items: [],
        canReview: true,
        pos: null,
        posError: false,
      },
      '/admin/api/session': {
        user: { username: 'owner', role: 'owner', branchIds: [], actions: ['*'] },
      },
      '/admin/api/scope': { success: true, locations: [], selectedBranchId: null },
      '/admin/api/operations/summary': {
        success: true,
        counts: {},
        capabilities: {},
        orders: [],
        support: [],
        whatsapp: [],
      },
    };
    return route.fulfill({ status: path in responses ? 200 : 404, json: responses[path] ?? {} });
  });
  await page.goto('/admin/bonus');
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Пригласившему, ₸ бонусами')).toHaveValue('1000');
  await page.getByLabel('Пригласившему, ₸ бонусами').fill('1500');
  await page.getByLabel('Новому клиенту, ₸ бонусами').fill('700');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Есть несохранённые изменения')).not.toBeVisible();
  await expect.poll(() => settings.bonus_referral.inviter_bonus).toBe(1500);
  await page.reload();
  await expect(page.getByLabel('Новому клиенту, ₸ бонусами')).toHaveValue('700');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('referral-settings.png'), fullPage: true });
});

test('referral report shows rewards, POS failures and records an audited review', async ({
  page,
}, info) => {
  let decision: Record<string, unknown> | null = null;
  const item = {
    id: 'b41585a4-a1c6-4e34-b474-f2dbb82bc761',
    created_at: '2026-09-27T05:00:00Z',
    status: 'registered',
    review_state: 'pending',
    risk_reasons: ['shared_device'],
    reversed_at: null,
    owner_name: 'Пригласивший',
    friend_name: 'Новый клиент',
    owner_id: 'owner-id',
    referred_customer_id: 'friend-id',
    branch_name: 'Актау — Центр',
    first_purchase_source: 'online',
    amount: 2000,
    refunded_amount: 0,
  };
  await page.addInitScript(() => localStorage.setItem('adminLocale', 'ru'));
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/events'))
      return route.fulfill({ contentType: 'text/event-stream', body: '' });
    if (path.endsWith('/review')) {
      decision = route.request().postDataJSON();
      item.review_state = 'approved';
      return route.fulfill({ json: { success: true } });
    }
    const responses: Record<string, unknown> = {
      '/admin/api/session': {
        user: { username: 'owner', role: 'owner', branchIds: [], actions: ['*'] },
      },
      '/admin/api/scope': { success: true, locations: [], selectedBranchId: null },
      '/admin/api/operations/summary': {
        success: true,
        counts: {},
        capabilities: {},
        orders: [],
        support: [],
        whatsapp: [],
      },
      '/admin/api/settings': {
        bonus_referral: {
          enabled: true,
          inviter_bonus: 1000,
          friend_bonus: 500,
          min_first_order: 0,
        },
      },
      '/admin/api/bonus/referrals': {
        summary: {
          invitations: 1,
          purchases: 1,
          revenue: 2000,
          awarded: 0,
          reversed: 0,
          debt_created: 0,
          review: decision ? 0 : 1,
          delayed: 0,
        },
        branches: [
          {
            branch_id: 'branch',
            name: 'Актау — Центр',
            invitations: 1,
            purchases: 1,
            revenue: 2000,
            rewards: 0,
          },
        ],
        items: [item],
        canReview: true,
        posError: false,
        pos: {
          devices: [
            {
              id: 'terminal',
              branchId: 'branch',
              branch: { name: 'Актау — Центр' },
              name: 'Касса 1',
              pluginVersion: '1.10.5',
              outdated: true,
              online: false,
              lastSeenAt: '2026-09-27T03:00:00Z',
              health: 'offline',
              lastError: 'Нет связи с сервером',
              queues: { loyaltyFailed: 2, offlineReceipts: 3 },
            },
          ],
        },
      },
    };
    return route.fulfill({ status: path in responses ? 200 : 404, json: responses[path] ?? {} });
  });
  await page.goto('/admin/bonus');
  await expect(
    page.getByText('Повторные регистрации с одного устройства', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Рассмотреть', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Одобрить', exact: true })).toBeDisabled();
  await page.getByLabel('Причина решения').fill('Проверено по обращению клиента');
  await page.getByRole('button', { name: 'Одобрить', exact: true }).click();
  await expect
    .poll(() => decision)
    .toEqual({ action: 'approve', note: 'Проверено по обращению клиента' });
  await expect(page.getByText('Нет связи с сервером')).toBeVisible();
  await expect(page.getByText('Ошибки бонусов: 2 · Офлайн-чеки: 3')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('referral-controls.png'), fullPage: true });
});

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

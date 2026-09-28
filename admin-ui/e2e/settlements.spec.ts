import { test, expect } from '@playwright/test';
const branch = '11111111-1111-4111-8111-111111111111';
const order = {
  order_id: '22222222-2222-4222-8222-222222222222',
  order_number: 42,
  ordered_at: '2026-09-27T10:00:00Z',
  branch: '19-й микрорайон',
  partner: 'Партнёр',
  status: 'paid',
  fulfillment_status: 'completed',
  cash_amount: 1200,
  cash_refunded: 0,
  cash_net: 1200,
  bonus_net: 100,
  delivery_net: 200,
  platform_commission: 100,
  bonus_compensation: 100,
  acquiring_fee: null,
  payment_recipient: 'platform',
  reconciled: false,
  current_signature: 'a'.repeat(32),
  entitlement: 1000,
  paid_out: 0,
  branch_changed: false,
};
const balance = {
  branch_id: branch,
  partner_id: '33333333-3333-4333-8333-333333333333',
  branch: order.branch,
  partner: order.partner,
  accrued: 1000,
  paid_out: 0,
  balance: 1000,
  blocked: 1,
};
test('financial report adapts and blocks unverified payout; custom dates and reconciliation work', async ({
  page,
}, info) => {
  let reconciled = false;
  const mutations: unknown[] = [];
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path.endsWith('/session'))
      data = { user: { username: 'owner', role: 'owner', branchIds: [] } };
    else if (path.endsWith('/scope'))
      data = { locations: [{ id: branch, name: order.branch, city: 'Актау', active: true }] };
    else if (path.endsWith('/settlements/months')) data = { months: [] };
    else if (path.endsWith('/settlements/portal-users')) data = { users: [], links: [] };
    else if (path.endsWith('/settlements/config'))
      data = {
        locations: [{ id: branch, name: order.branch, city: 'Актау' }],
        terms: [],
        partners: [{ id: balance.partner_id, name: 'Партнёр' }],
      };
    else if (path.endsWith('/reconcile')) {
      mutations.push(route.request().postDataJSON());
      reconciled = true;
      data = { success: true };
    } else if (path.endsWith('/settlements'))
      data = {
        canManage: true,
        totalOrders: 1,
        branches: [],
        orders: [{ ...order, reconciled, acquiring_fee: reconciled ? 20 : null }],
        balances: [{ ...balance, blocked: reconciled ? 0 : 1, balance: reconciled ? 980 : 1000 }],
        payouts: [],
      };
    else if (path.endsWith('/events'))
      return route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
    return route.fulfill({ json: data });
  });
  await page.goto('/admin/settlements');
  await expect(page.getByRole('heading', { name: 'Отчёт по точкам и партнёрам' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Учесть перевод' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect(await page.locator('input[type=date]').count()).toBe(0);
  await page.getByRole('button', { name: 'Сверить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Фактическая комиссия эквайринга, ₸').fill('20');
  await dialog.getByLabel('Номер банковской операции / документа').fill('bank-42');
  await dialog.getByRole('button', { name: 'Подтвердить сверку' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Учесть перевод' })).toBeEnabled();
  expect(mutations).toEqual([
    { fee: 20, recipient: 'platform', reference: 'bank-42', signature: 'a'.repeat(32) },
  ]);
  await page.getByRole('button', { name: 'Учесть перевод' }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Зафиксировать выплату' }),
  ).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.locator('.date-input-trigger').first().click();
  await expect(page.getByRole('button', { name: 'Очистить', exact: true })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Скачать CSV для Excel' })).toBeVisible();
  await page.getByRole('button', { name: 'Партнёры и условия', exact: true }).click();
  await page.getByLabel('Название нового партнёра', { exact: true }).fill('Черновик');
  await page.keyboard.press('Escape');
  const warning = page.getByRole('dialog', { name: 'Закрыть без сохранения?', exact: true });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByLabel('Название нового партнёра', { exact: true })).toHaveValue(
    'Черновик',
  );
  await page.keyboard.press('Escape');
  await warning.getByRole('button', { name: 'Сбросить и продолжить', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/admin/settlements?from=2026-09-02&to=2026-09-20');
  await page.reload();
  await expect(page.locator('.date-input-trigger').first()).toContainText('02.09.2026');
  await page.screenshot({
    path: info.outputPath('settlements.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

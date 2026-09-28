import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
const branch = '11111111-1111-4111-8111-111111111111';
const partner = '22222222-2222-4222-8222-222222222222';
const order = '33333333-3333-4333-8333-333333333333';
test('drills into cancellations, checks bank, closes a reviewed month and opens frozen archive', async ({
  page,
}, info) => {
  let checked = false,
    closed = false;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const snapshot = {
    month: '2025-01-01',
    blocked: 0,
    entitlement: 900,
    cash_net: 1000,
    signature: 'a'.repeat(32),
    items: [{ order_id: order, order_number: 42, adjustment: true, delta: -100, cash_delta: -100 }],
  };
  await page.route('**/admin/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    let data: unknown = {};
    if (path.endsWith('/session'))
      data = { user: { username: 'owner', role: 'owner', branchIds: [] } };
    else if (path.endsWith('/scope'))
      data = { locations: [{ id: branch, name: 'Точка 1', city: 'Актау' }] };
    else if (path.endsWith('/settlements/config'))
      data = {
        locations: [{ id: branch, name: 'Точка 1', city: 'Актау' }],
        partners: [{ id: partner, name: 'Партнёр 1' }],
        terms: [],
      };
    else if (path.endsWith('/settlements/portal-users')) data = { users: [], links: [] };
    else if (path.endsWith('/settlements/details')) {
      expect(url.searchParams.get('metric')).toMatch(/cancelled|issues/);
      data = {
        total: 1,
        orders: [
          {
            order_id: order,
            order_number: 42,
            branch: 'Точка 1',
            ordered_at: '2025-01-12',
            status: 'paid',
            fulfillment_status: 'cancelled',
            cash_amount: 1000,
            cash_refunded: 0,
            cancellation_reason: 'Клиент передумал',
            payment_method: 'forte_card',
            bank_check_current: checked,
            bank_issue: checked ? 'payment_unconfirmed' : null,
          },
        ],
      };
    } else if (path.endsWith('/bank-check')) {
      checked = true;
      data = { issue: 'payment_unconfirmed' };
    } else if (path.endsWith('/months/preview')) data = snapshot;
    else if (path.endsWith('/months/close')) {
      expect(route.request().postDataJSON().signature).toBe(snapshot.signature);
      closed = true;
      data = { id: order };
    } else if (path.endsWith('/months/' + order)) data = snapshot;
    else if (path.endsWith('/months'))
      data = {
        months: closed
          ? [
              {
                id: order,
                branch_id: branch,
                partner_id: null,
                month: '2025-01-01',
                entitlement: 900,
              },
            ]
          : [],
      };
    else if (path.endsWith('/settlements'))
      data = {
        canManage: true,
        branches: [
          {
            branch_id: branch,
            name: 'Точка 1',
            city: 'Актау',
            orders: 7,
            customers: 1,
            paid_orders: 7,
            completed_orders: 0,
            cancelled_orders: 7,
            refunded_orders: 0,
            cash: 7000,
            refunds: 0,
            net_cash: 7000,
            bonuses: 0,
            delivery: 0,
            discounts: 0,
            commission: 0,
            acquiring_fee: 0,
            unverified: 7,
          },
        ],
        orders: [],
        balances: [],
        payouts: [],
        totalOrders: 0,
      };
    else if (path.endsWith('/events'))
      return route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
    await route.fulfill({ json: data });
  });
  await page.goto('/admin/settlements');
  await page.getByRole('button', { name: 'Отменено: 7 · Точка 1' }).click();
  await expect(page.getByText('Причина отмены: Клиент передумал')).toBeVisible();
  await page.getByRole('button', { name: 'Проверить в FortePay' }).click();
  await expect(page.getByText('В приложении оплачено, банк не подтвердил оплату')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#close-branch').click();
  await page.getByRole('option', { name: 'Точка 1', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить расчёт', exact: true }).click();
  await expect(page.getByText('#42 · Корректировка прошлого периода')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть месяц', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить закрытие' }).click();
  await page.getByRole('button', { name: /2025-01 · Точка 1 · Bulka/ }).click();
  await expect(
    page.getByRole('dialog').getByText('#42 · Корректировка прошлого периода'),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const a11y = await new AxeBuilder({ page })
    .include('.settlements-page')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(a11y.violations).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/franchise-controls-${info.project.name}.png`,
    fullPage: true,
  });
});
test('franchisee lands in own report without management actions or customer search', async ({
  page,
}) => {
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/session')
      ? { user: { username: 'partner', role: 'franchisee', branchIds: [branch] } }
      : path.endsWith('/scope')
        ? { locations: [{ id: branch, name: 'Своя точка', city: 'Астана' }] }
        : path.endsWith('/config')
          ? { locations: [], partners: [], terms: [] }
          : path.endsWith('/months')
            ? { months: [] }
            : {
                canManage: false,
                branches: [],
                orders: [],
                balances: [],
                payouts: [],
                totalOrders: 0,
              };
    await route.fulfill({ json: data });
  });
  await page.goto('/admin/customers');
  await expect(page).toHaveURL(/settlements/);
  await expect(page.getByRole('button', { name: 'Партнёры и условия' })).toHaveCount(0);
  await expect(page.getByText('Кабинет франчайзи', { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('Найти заказ или клиента...')).toHaveCount(0);
});

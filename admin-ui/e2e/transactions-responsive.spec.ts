import { expect, test } from '@playwright/test';

const transaction = {
  id: 'transaction-responsive',
  type: 'deposit',
  order_id: 'kaspi:22222222-2222-4222-8222-222222222222',
  order_number: 100039,
  timestamp: '2026-08-03T17:31:00.000Z',
  amount: 45,
  order_total: 1500,
  customers: { name: 'Тестовый клиент', phone: '+77760000000' },
  items: [
    { name: 'Плюшка Московская', quantity: 1, price: 350 },
    { name: 'Круассан с миндальным кремом и лепестками миндаля', quantity: 2, price: 575 },
  ],
};

test('expanded transaction preserves readable item columns without page overflow', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('adminLocale', 'ru'));
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
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
      '/admin/api/transactions': {
        transactions: [transaction],
        total: 1,
        page: 1,
        pageSize: 50,
      },
    };
    return route.fulfill({
      status: path in responses ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(responses[path] ?? { error: `not mocked: ${path}` }),
    });
  });

  await page.goto('/admin/transactions');
  await expect(page.getByText('#100039', { exact: true })).toBeVisible();
  const skipLink = page.locator('.skip-link');
  await expect(skipLink).toHaveCSS('opacity', '0');
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveCSS('opacity', '1');
  await page.keyboard.press('Tab');
  await expect(skipLink).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'Состав заказа', exact: true }).click();

  const details = page.locator('.expanded-row > td > .order-items');
  const itemsTable = details.getByRole('table');
  await expect(details.getByRole('heading', { name: 'Состав заказа' })).toBeVisible();
  for (const heading of ['Товар', 'Кол-во', 'Цена', 'Сумма']) {
    const header = itemsTable.getByRole('columnheader', { name: heading, exact: true });
    await expect(header).toBeVisible();
    await header.scrollIntoViewIfNeeded();
    await expect(header).toBeInViewport();
  }
  await expect(
    itemsTable.getByRole('cell', { name: 'Плюшка Московская', exact: true }),
  ).toBeVisible();
  await expect(itemsTable.locator('tbody > tr')).toHaveCount(2);
  const cellDisplay = await itemsTable
    .locator('tbody > tr > td')
    .evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).display));
  expect(cellDisplay).toEqual(Array(8).fill('table-cell'));

  // The expanded contents must fill their own cell, including on the mobile
  // card layout; the ordinary field/value split must not squeeze them to 58%.
  const widths = await details.evaluate((element) => {
    const cell = element.parentElement!;
    const style = getComputedStyle(cell);
    return {
      details: element.getBoundingClientRect().width,
      available: cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    };
  });
  expect(widths.details).toBeGreaterThan(widths.available * 0.95);
  await expect(details).toHaveCSS('text-align', 'left');

  // A compact table may scroll inside its wrapper, but never widen the page.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(skipLink).toHaveCSS('opacity', '0');

  await itemsTable.locator('th').first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  const screenshot = testInfo.outputPath('transactions-expanded.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('expanded transaction layout', {
    path: screenshot,
    contentType: 'image/png',
  });
});

import { expect, test } from '@playwright/test';

test('cash report suggests products locally and opens their complete receipts by click or keyboard', async ({
  page,
}, testInfo) => {
  const department = 'Bulka 16 мкр 85 дом';
  const shiftId = '83f26ae7-40ec-490c-b560-4f8baf293125';
  const shifts = [
    {
      id: shiftId,
      number: '1004',
      dateFrom: '2026-09-19',
      dateTo: '2026-09-19',
      department,
      register: 'webkassa SWK00490585',
      checks: 229,
      revenue: 597055.7,
    },
  ];
  const requests: { shift: string; search: string; productId?: string }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('adminLocale', 'ru');
    localStorage.setItem('bulka-iiko-dashboard-v1', JSON.stringify({ auto: false }));
  });
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, json: body });
    if (path === '/admin/api/session')
      return json({ user: { username: 'owner', role: 'owner', branchIds: [] } });
    if (path === '/admin/api/scope')
      return json({ success: true, locations: [], selectedBranchId: null });
    if (path === '/admin/api/iiko-dashboard/servers')
      return json({
        servers: [
          {
            id: 'aktau-chain',
            city: 'aktau',
            kind: 'chain',
            configured: true,
            active: true,
            host: 'aktau.example.com',
          },
        ],
      });
    if (path === '/admin/api/iiko-dashboard/departments')
      return json({ departments: [{ id: 'branch-1', name: department }] });
    if (path === '/admin/api/iiko-dashboard/cash-report') {
      const query = route.request().postDataJSON();
      requests.push(query);
      return json({
        shifts,
        products: query.shift
          ? [
              { id: 'bun', name: 'Булочка Лакомка' },
              { id: 'coffee', name: 'Кофе Американо' },
              { id: 'latte', name: 'Кофе Латте' },
            ]
          : [],
        checks: query.search
          ? [
              {
                id: 'receipt-1',
                shift: shiftId,
                number: 4,
                date: '2026-09-19',
                time: '2026-09-19T08:18:53.000',
                department,
                total: 1490,
                cashier: 'Кассир',
                items: [
                  { id: 'coffee', name: 'Кофе Американо', unit: 'шт', quantity: 1, total: 990 },
                  { id: 'bun', name: 'Булочка Лакомка', unit: 'шт', quantity: 1, total: 500 },
                ],
              },
            ]
          : [],
        summary: {
          checks: query.search ? 1 : 0,
          quantity: query.search ? 1 : 0,
          revenue: query.search ? 990 : 0,
        },
      });
    }
    if (path === '/admin/api/events')
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(
    `/admin/iiko-dashboard?tab=cashReport&server=aktau-chain&from=2026-09-13&to=2026-09-19&department=${encodeURIComponent(department)}`,
  );
  const report = page.locator('.id-cash-report');
  const select = report.getByLabel('Кассовая смена');
  await expect(select.locator(`option[value="${shiftId}"]`)).toHaveText(
    '19.09.2026 · Смена 1004 · webkassa SWK00490585 · 229 чеков',
  );
  const initialRequests = requests.length;
  await select.selectOption(shiftId);
  await expect(report.locator('.id-cash-shift-meta')).toContainText('19.09.2026 · Смена 1004');
  await expect(report.locator('.id-cash-shift-meta')).toContainText(department);
  await expect(report.getByText(/Начните вводить название/)).toBeVisible();
  expect(requests.length).toBe(initialRequests);
  const product = report.getByRole('combobox', { name: 'Товар', exact: true });
  await product.fill('к');
  await expect(report.getByRole('option', { name: 'Кофе Американо', exact: true })).toBeVisible();
  await product.fill('ко');
  await product.fill('кофе');
  await expect(report.getByRole('listbox').getByRole('option')).toHaveCount(2);
  await expect(report.getByRole('option', { name: 'Булочка Лакомка' })).toHaveCount(0);
  expect(requests.length).toBe(initialRequests + 1);
  await report.screenshot({ path: testInfo.outputPath('cash-product-suggestions.png') });
  expect(
    await report
      .getByLabel('Товар', { exact: true })
      .evaluate((input) => Number.parseFloat(getComputedStyle(input).paddingLeft)),
  ).toBeGreaterThanOrEqual(32);
  await report.getByRole('option', { name: 'Кофе Американо', exact: true }).click();
  await expect(product).toHaveValue('Кофе Американо');
  await expect(report.getByRole('listbox')).toHaveCount(0);
  await report.getByText('Чек № 4', { exact: true }).click();
  await expect(report.getByText('Булочка Лакомка', { exact: true })).toBeVisible();
  await expect(report.locator('.id-found-item')).toContainText('Кофе Американо');
  await expect(report.locator('.id-check-card summary')).toContainText('19.09.2026 · 08:18');
  expect(requests.at(-1)).toMatchObject({
    shift: shiftId,
    search: 'Кофе Американо',
    productId: 'coffee',
    department,
  });
  expect(requests.length).toBe(initialRequests + 2);
  expect(await report.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await report.screenshot({ path: testInfo.outputPath('cash-report.png') });
  await product.fill('кофе');
  await product.press('ArrowDown');
  await expect(report.getByRole('option', { name: 'Кофе Американо', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await product.press('Enter');
  await expect(report.getByText('Чек № 4', { exact: true })).toBeVisible();
  expect(requests.at(-1)?.productId).toBe('coffee');
  expect(requests.length).toBe(initialRequests + 3);
  await product.fill('коф');
  await product.press('Enter');
  await expect(report.getByText('Чек № 4', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ search: 'коф', productId: '' });
  expect(requests.length).toBe(initialRequests + 4);
});

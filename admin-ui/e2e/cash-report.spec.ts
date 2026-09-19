import { expect, test } from '@playwright/test';

test('cash report shows dated shifts and searches complete receipts without loading on selection', async ({
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
  const requests: { shift: string; search: string }[] = [];
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
  await expect(report.getByText('Введите название товара и нажмите «Найти»')).toBeVisible();
  await report.getByLabel('Товар', { exact: true }).fill('кофе');
  expect(
    await report
      .getByLabel('Товар', { exact: true })
      .evaluate((input) => Number.parseFloat(getComputedStyle(input).paddingLeft)),
  ).toBeGreaterThanOrEqual(32);
  expect(requests.length).toBe(initialRequests);
  await report.getByRole('button', { name: 'Найти', exact: true }).click();
  await report.getByText('Чек № 4', { exact: true }).click();
  await expect(report.getByText('Булочка Лакомка', { exact: true })).toBeVisible();
  await expect(report.locator('.id-found-item')).toContainText('Кофе Американо');
  await expect(report.locator('.id-check-card summary')).toContainText('19.09.2026 · 08:18');
  expect(requests.at(-1)).toMatchObject({ shift: shiftId, search: 'кофе', department });
  expect(requests.length).toBe(initialRequests + 1);
  expect(await report.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await report.screenshot({ path: testInfo.outputPath('cash-report.png') });
});

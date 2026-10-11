import { expect, test } from '@playwright/test';

test('cash report shows the whole shift and filters complete receipts by click or keyboard', async ({
  page,
}, testInfo) => {
  const department = 'Bulka 16 мкр 85 дом';
  const shiftId = '83f26ae7-40ec-490c-b560-4f8baf293125';
  const otherShiftId = 'aec65dd3-b919-4894-8b38-e604c9b62a1d';
  const shifts = [
    {
      id: shiftId,
      number: '1004',
      dateFrom: '2026-09-19',
      dateTo: '2026-09-19',
      department,
      register: 'webkassa SWK00490585',
      checks: 2,
      revenue: 2690,
    },
    {
      id: otherShiftId,
      number: '1003',
      dateFrom: '2026-09-18',
      dateTo: '2026-09-18',
      department,
      register: 'webkassa SWK00490585',
      checks: 1,
      revenue: 500,
    },
  ];
  const receipts = [
    {
      id: 'receipt-1',
      shift: shiftId,
      number: 4,
      date: '2026-09-19',
      time: '2026-09-19T08:18:53.000',
      department,
      total: 1490,
      cashier: 'Кассир',
      payment: {
        status: 'available',
        methods: [
          { id: 'cash', name: 'Наличные', group: 'Наличные', kind: 'cash', amount: 490 },
          {
            id: 'card',
            name: 'Банковская карта',
            group: 'Безналичные',
            kind: 'card',
            amount: 1000,
          },
        ],
        receivedCash: 500,
        change: 10,
      },
      items: [
        { id: 'coffee', name: 'Кофе Американо', unit: 'шт', quantity: 1, total: 990 },
        { id: 'bun', name: 'Булочка Лакомка', unit: 'шт', quantity: 1, total: 500 },
      ],
    },
    {
      id: 'receipt-2',
      shift: shiftId,
      number: 5,
      date: '2026-09-19',
      time: '2026-09-19T09:12:00.000',
      department,
      total: 1200,
      cashier: 'Кассир',
      payment: {
        status: 'available',
        methods: [
          {
            id: 'card',
            name: 'Банковская карта',
            group: 'Безналичные',
            kind: 'card',
            amount: 1200,
          },
        ],
        receivedCash: null,
        change: null,
      },
      items: [{ id: 'latte', name: 'Кофе Латте', unit: 'шт', quantity: 1, total: 1200 }],
    },
    {
      id: 'receipt-3',
      shift: otherShiftId,
      number: 6,
      date: '2026-09-18',
      time: '2026-09-18T10:00:00.000',
      department,
      total: 500,
      cashier: 'Кассир',
      payment: {
        status: 'available',
        methods: [{ id: 'cash', name: 'Наличные', group: 'Наличные', kind: 'cash', amount: 500 }],
        receivedCash: null,
        change: null,
      },
      items: [{ id: 'bun', name: 'Булочка Лакомка', unit: 'шт', quantity: 1, total: 500 }],
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
      const shiftReceipts = receipts.filter((receipt) => receipt.shift === query.shift);
      const search = String(query.search ?? '')
        .trim()
        .toLocaleLowerCase('ru');
      const receiptAmount = !query.productId && search === '1 490,00 ₸' ? 1490 : null;
      const matches = (item: (typeof receipts)[number]['items'][number]) =>
        query.productId
          ? item.id === query.productId
          : !search || item.name.toLocaleLowerCase('ru').includes(search);
      const checks = shiftReceipts.filter((receipt) =>
        receiptAmount !== null ? receipt.total === receiptAmount : receipt.items.some(matches),
      );
      const matchingItems = checks.flatMap((receipt) =>
        receiptAmount !== null ? receipt.items : receipt.items.filter(matches),
      );
      return json({
        shifts,
        products: Array.from(
          new Map(
            shiftReceipts.flatMap((receipt) =>
              receipt.items.map((item) => [item.id, { id: item.id, name: item.name }] as const),
            ),
          ).values(),
        ),
        checks,
        summary: {
          checks: checks.length,
          quantity: matchingItems.reduce((sum, item) => sum + item.quantity, 0),
          revenue: matchingItems.reduce((sum, item) => sum + item.total, 0),
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
    '19.09.2026 · Смена 1004 · webkassa SWK00490585 · 2 чеков',
  );
  const initialRequests = requests.length;
  await select.selectOption(shiftId);
  await expect(report.locator('.id-cash-shift-meta')).toContainText('19.09.2026 · Смена 1004');
  await expect(report.locator('.id-cash-shift-meta')).toContainText(department);
  await expect(report.locator('.id-check-card')).toHaveCount(2);
  await expect(report.getByText('Чек № 4', { exact: true })).toBeVisible();
  await expect(report.getByText('Чек № 5', { exact: true })).toBeVisible();
  await expect(report.locator('.id-check-payment-label')).toHaveText([
    'Смешанная оплата',
    'Банковская карта',
  ]);
  await expect(report.getByText('Чек № 6', { exact: true })).toHaveCount(0);
  const totals = report.locator('.id-revision-totals');
  await expect(totals.locator('strong')).toHaveText(['2', '3', /^2\s*690\s*₸$/]);
  await expect(report.locator('.id-found-item')).toHaveCount(0);
  expect(requests.at(-1)).toMatchObject({ shift: shiftId, search: '', productId: '' });
  expect(requests.length).toBe(initialRequests + 1);
  const product = report.getByRole('combobox', { name: 'Товар или сумма чека', exact: true });
  await product.fill('к');
  await expect(report.getByRole('option', { name: 'Кофе Американо', exact: true })).toBeVisible();
  await product.fill('ко');
  await product.fill('кофе');
  await expect(report.getByRole('listbox').getByRole('option')).toHaveCount(2);
  await expect(report.getByRole('option', { name: 'Булочка Лакомка' })).toHaveCount(0);
  expect(requests.length).toBe(initialRequests + 2);
  await report.screenshot({ path: testInfo.outputPath('cash-product-suggestions.png') });
  expect(
    await report
      .getByLabel('Товар или сумма чека', { exact: true })
      .evaluate((input) => Number.parseFloat(getComputedStyle(input).paddingLeft)),
  ).toBeGreaterThanOrEqual(32);
  await report.getByRole('option', { name: 'Кофе Американо', exact: true }).click();
  await expect(product).toHaveValue('Кофе Американо');
  await expect(report.getByRole('listbox')).toHaveCount(0);
  await expect(report.locator('.id-check-card')).toHaveCount(1);
  await expect(totals.locator('strong')).toHaveText(['1', '1', '990 ₸']);
  await report.getByText('Чек № 4', { exact: true }).click();
  await expect(report.getByText('Булочка Лакомка', { exact: true })).toBeVisible();
  await expect(report.locator('.id-found-item')).toContainText('Кофе Американо');
  await expect(report.locator('.id-check-card summary')).toContainText('19.09.2026 · 08:18');
  await expect(report.locator('.id-check-card summary')).toContainText(/1\s*490\s*₸/);
  const payment = report.getByRole('region', { name: 'Оплата чека' });
  await expect(payment).toBeVisible();
  await expect(payment.getByText('Наличные', { exact: true }).locator('..')).toContainText('490 ₸');
  await expect(payment.getByText('Банковская карта', { exact: true }).locator('..')).toContainText(
    /1\s*000\s*₸/,
  );
  await expect(
    payment.getByText('Получено наличными', { exact: true }).locator('..'),
  ).toContainText('500 ₸');
  await expect(payment.getByText('Сдача', { exact: true }).locator('..')).toContainText('10 ₸');
  expect(requests.at(-1)).toMatchObject({
    shift: shiftId,
    search: 'Кофе Американо',
    productId: 'coffee',
    department,
  });
  expect(requests.length).toBe(initialRequests + 3);
  expect(await report.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await report.screenshot({ path: testInfo.outputPath('cash-report.png') });
  await product.fill('');
  await expect(report.locator('.id-check-card')).toHaveCount(2);
  await expect(totals.locator('strong')).toHaveText(['2', '3', /^2\s*690\s*₸$/]);
  await expect(report.locator('.id-found-item')).toHaveCount(0);
  expect(requests.at(-1)).toMatchObject({ shift: shiftId, search: '', productId: '' });
  expect(requests.length).toBe(initialRequests + 4);
  const cardReceipt = report.locator('.id-check-card').filter({ hasText: 'Чек № 5' });
  await cardReceipt.locator('summary').click();
  await expect(cardReceipt.getByRole('region', { name: 'Оплата чека' })).toBeVisible();
  await expect(cardReceipt.getByText('Получено наличными')).toHaveCount(0);
  await expect(cardReceipt.getByText('Сдача')).toHaveCount(0);
  await product.fill('кофе');
  await product.press('ArrowDown');
  await expect(report.getByRole('option', { name: 'Кофе Американо', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await product.press('Enter');
  await expect(report.locator('.id-check-card')).toHaveCount(1);
  await expect(report.getByText('Чек № 4', { exact: true })).toBeVisible();
  expect(requests.at(-1)?.productId).toBe('coffee');
  expect(requests.length).toBe(initialRequests + 5);
  await product.fill('коф');
  await product.press('Enter');
  await expect(report.locator('.id-check-card')).toHaveCount(2);
  await expect(totals.locator('strong')).toHaveText(['2', '2', /^2\s*190\s*₸$/]);
  await expect(report.locator('.id-found-item')).toHaveCount(2);
  await expect(report.getByText('Чек № 4', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ search: 'коф', productId: '' });
  expect(requests.length).toBe(initialRequests + 6);
  await product.fill('1 490,00 ₸');
  await expect(product).toHaveAttribute('aria-expanded', 'false');
  await expect(report.getByRole('listbox')).toHaveCount(0);
  await expect(report.getByText('В этой смене совпадений нет')).toHaveCount(0);
  await product.press('ArrowDown');
  await product.press('Enter');
  await expect(report.locator('.id-check-card')).toHaveCount(1);
  await expect(report.getByText('Чек № 4', { exact: true })).toBeVisible();
  await expect(totals.locator('strong')).toHaveText(['1', '2', /^1\s*490\s*₸$/]);
  await expect(report.locator('.id-found-item')).toHaveCount(0);
  await report.getByText('Чек № 4', { exact: true }).click();
  await expect(report.getByText('Булочка Лакомка', { exact: true })).toBeVisible();
  await expect(report.getByRole('region', { name: 'Оплата чека' })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ search: '1 490,00 ₸', productId: '', shift: shiftId });
  expect(requests.length).toBe(initialRequests + 7);
  await report.screenshot({ path: testInfo.outputPath('cash-report-amount-search.png') });
  await product.fill('');
  await expect(report.locator('.id-check-card')).toHaveCount(2);
  await expect(totals.locator('strong')).toHaveText(['2', '3', /^2\s*690\s*₸$/]);
  await expect(report.locator('.id-found-item')).toHaveCount(0);
  expect(requests.at(-1)).toMatchObject({ search: '', productId: '', shift: shiftId });
  expect(requests.length).toBe(initialRequests + 8);
  await select.selectOption(otherShiftId);
  await expect(product).toHaveValue('');
  await expect(report.locator('.id-cash-shift-meta')).toContainText('18.09.2026 · Смена 1003');
  await expect(report.locator('.id-check-card')).toHaveCount(1);
  await expect(report.getByText('Чек № 6', { exact: true })).toBeVisible();
  await expect(report.getByText('Чек № 4', { exact: true })).toHaveCount(0);
  await expect(report.getByText('Чек № 5', { exact: true })).toHaveCount(0);
  await expect(totals.locator('strong')).toHaveText(['1', '1', '500 ₸']);
  await expect(report.locator('.id-found-item')).toHaveCount(0);
  expect(requests.at(-1)).toMatchObject({
    shift: otherShiftId,
    search: '',
    productId: '',
    department,
  });
  expect(requests.length).toBe(initialRequests + 9);
  await report.getByText('Чек № 6', { exact: true }).click();
  await expect(report.getByLabel('iiko не передала полученную сумму')).toHaveText('—');
  await expect(report.getByLabel('iiko не передала сумму сдачи')).toHaveText('—');
});

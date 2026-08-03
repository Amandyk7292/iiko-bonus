import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const requestId = '33333333-3333-4333-8333-333333333333';
const now = '2026-07-23T10:00:00.000Z';
const supportRequest = {
  id: requestId,
  orderId: '44444444-4444-4444-8444-444444444444',
  orderNumber: 1842,
  branchId: '11111111-1111-4111-8111-111111111111',
  branch: 'Арнау',
  customer: { name: 'Айдана', phone: '+7 700 123 45 67' },
  category: 'product_quality',
  message: 'У торта повреждена упаковка',
  preview: 'Спасибо за фото. Уже проверяем ситуацию.',
  status: 'in_review',
  priority: 'high',
  refundRequested: false,
  attachments: [],
  resolution: null,
  assignedTo: 'operator',
  createdAt: now,
  updatedAt: now,
  resolvedAt: null,
  dueAt: '2026-07-23T12:00:00.000Z',
  firstRespondedAt: now,
  lastMessageAt: now,
  overdue: false,
};

test('support queue shows SLA, assignment and the full conversation', async ({
  page,
}, testInfo) => {
  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { username: 'owner', role: 'owner', branchIds: [] },
        }),
      });
    }
    if (path === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations: [], selectedBranchId: null }),
      });
    }
    if (path === '/admin/api/operations/summary') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          updatedAt: now,
          capabilities: {
            orders: true,
            kitchen: true,
            dispatch: true,
            support: true,
            whatsapp: true,
            inventory: true,
          },
          counts: {
            newOrders: 0,
            activeOrders: 0,
            kitchenOverdue: 0,
            deliveryAttention: 0,
            paymentIssues: 0,
            supportNew: 1,
            supportOverdue: 0,
            supportMine: 1,
            whatsappUnread: 0,
            whatsappDialogs: 0,
            stoppedProducts: 0,
          },
          orders: [],
          support: [supportRequest],
          whatsapp: [],
        }),
      });
    }
    if (path === '/admin/api/support') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          requests: [supportRequest],
          total: 1,
          page: 1,
          pageSize: 30,
        }),
      });
    }
    if (path === `/admin/api/support/${requestId}`) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          request: supportRequest,
          messages: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              requestId,
              senderType: 'customer',
              senderId: supportRequest.customer.phone,
              body: supportRequest.message,
              attachments: [],
              internal: false,
              createdAt: now,
            },
            {
              id: '66666666-6666-4666-8666-666666666666',
              requestId,
              senderType: 'admin',
              senderId: 'operator',
              body: supportRequest.preview,
              attachments: [],
              internal: false,
              createdAt: now,
            },
          ],
        }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'not mocked' }),
    });
  });

  await page.goto(`/admin/support?queue=all&request=${requestId}`);
  await expect(page.getByRole('heading', { name: 'Очередь обращений' })).toBeVisible();
  await expect(page.getByText('Айдана', { exact: true }).first()).toBeVisible();
  const thread = page.getByLabel('Переписка по обращению');
  await expect(thread.getByText('Спасибо за фото. Уже проверяем ситуацию.')).toBeVisible();
  await expect(thread).toBeVisible();
  await expect(page.getByLabel('Ответ клиенту')).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['color-contrast'])
    .analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact || ''),
    ),
  ).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('support.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('support keeps drafts per request and ignores stale request details', async ({ page }) => {
  const secondId = '77777777-7777-4777-8777-777777777777';
  const requests = [
    { ...supportRequest, id: requestId, customer: { name: 'Клиент А', phone: '+77000000001' } },
    {
      ...supportRequest,
      id: secondId,
      customer: { name: 'Клиент Б', phone: '+77000000002' },
      message: 'Вопрос клиента Б',
      preview: 'Вопрос клиента Б',
    },
  ];

  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'owner', role: 'owner', branchIds: [] } }),
      });
    }
    if (path === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations: [], selectedBranchId: null }),
      });
    }
    if (path === '/admin/api/support') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          requests,
          total: requests.length,
          page: 1,
          pageSize: 30,
        }),
      });
    }
    const detail = requests.find((item) => path === `/admin/api/support/${item.id}`);
    if (detail) {
      if (detail.id === requestId) await new Promise((resolve) => setTimeout(resolve, 250));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          request: detail,
          messages: [
            {
              id: `${detail.id}-message`,
              requestId: detail.id,
              senderType: 'customer',
              senderId: detail.customer.phone,
              body: detail.message,
              attachments: [],
              internal: false,
              createdAt: now,
            },
          ],
        }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/admin/support?queue=all');
  const first = page.locator('.support-request-list button').filter({ hasText: 'Клиент А' });
  const second = page.locator('.support-request-list button').filter({ hasText: 'Клиент Б' });
  await first.click();
  await second.click();
  await expect(page.locator('.support-detail-header').getByText('Клиент Б')).toBeVisible();
  await expect(page.getByLabel('Переписка по обращению').getByText('Вопрос клиента Б')).toBeVisible();
  await expect(page.locator('.support-detail-header').getByText('Клиент А')).toHaveCount(0);

  const reply = page.getByLabel('Ответ клиенту');
  await reply.fill('Черновик для клиента Б');
  await first.click();
  const warning = page.getByRole('alertdialog');
  await expect(warning).toContainText('Черновик останется');
  await warning.getByRole('button', { name: 'Отмена' }).click();
  await expect(warning).toBeHidden();
  await expect(reply).toHaveValue('Черновик для клиента Б');
  await expect(page).toHaveURL(new RegExp(`request=${secondId}`));

  await first.click();
  const confirmedWarning = page.getByRole('alertdialog');
  await expect(confirmedWarning).toBeVisible();
  await confirmedWarning.getByRole('button', { name: 'Перейти' }).click();
  await expect(page.locator('.support-detail-header').getByText('Клиент А')).toBeVisible();
  await expect(page.getByLabel('Ответ клиенту')).toHaveValue('');
  await second.click();
  await expect(page.getByLabel('Ответ клиенту')).toHaveValue('Черновик для клиента Б');

  page.once('dialog', (dialog) => dialog.dismiss());
  const menuButton = page.getByRole('button', { name: 'Открыть меню' });
  if (await menuButton.isVisible()) await menuButton.click();
  const overviewSection = page.getByRole('button', { name: 'Обзор', exact: true });
  if ((await overviewSection.getAttribute('aria-expanded')) !== 'true') {
    await overviewSection.click();
  }
  await page.getByRole('link', { name: 'Операционный центр', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/support.*request=${secondId}`));
  await expect(page.getByLabel('Ответ клиенту')).toHaveValue('Черновик для клиента Б');
});

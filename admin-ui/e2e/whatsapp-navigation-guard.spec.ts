import { expect, test, type Page } from '@playwright/test';

const now = '2026-07-29T09:00:00.000Z';
const conversationId = '11111111-1111-4111-8111-111111111111';
const conversation = {
  id: conversationId,
  chatJid: '77001234567@s.whatsapp.net',
  phone: '+7 700 123 45 67',
  displayName: 'Клиент Bulka',
  status: 'open' as const,
  assistantEnabled: true,
  contextResetAt: null,
  unreadCount: 0,
  lastMessagePreview: 'Здравствуйте',
  lastMessageAt: now,
  lastCustomerMessageAt: now,
  lastOperatorMessageAt: null,
  createdAt: now,
  updatedAt: now,
};

const settings = {
  assistantEnabled: true,
  autoReplyEnabled: true,
  memoryEnabled: true,
  provider: 'gemini' as const,
  model: 'gemini-3.1-flash-lite',
  keyConfigured: true,
  providerKeys: { gemini: true, qwen: false, deepseek: false },
  botName: 'Bulka',
  tone: 'friendly' as const,
  supportedLanguages: ['ru'] as const,
  historyMessages: 10,
  businessDescription: 'Пекарня Bulka',
  customInstructions: '',
  welcomeMessage: 'Здравствуйте',
  fallbackMessage: 'Передам вопрос оператору',
  storageReady: true,
  updatedAt: now,
};

const dismissBlockedSidebarNavigation = async (page: Page) => {
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .locator('a[href="/admin/operations"]')
    .evaluate((element: HTMLAnchorElement) => element.click());
  await expect(page).toHaveURL(/\/admin\/whatsapp/);
};

test('WhatsApp SPA guard preserves reply, settings and knowledge drafts', async ({ page }) => {
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
            supportNew: 0,
            supportOverdue: 0,
            supportMine: 0,
            whatsappUnread: 0,
            whatsappDialogs: 1,
            stoppedProducts: 0,
          },
          orders: [],
          support: [],
          whatsapp: [],
        }),
      });
    }
    if (path === '/admin/api/whatsapp/status') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          settings,
          connection: {
            state: 'connected',
            connected: true,
            connectedAt: now,
            updatedAt: now,
            phone: '+7 700 123 45 67',
            qrDataUrl: '',
            qrReceivedAt: null,
            lastError: '',
            assistant: {
              environmentEnabled: true,
              provider: 'gemini',
              keyConfigured: true,
              model: settings.model,
            },
          },
        }),
      });
    }
    if (path === '/admin/api/whatsapp/conversations') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          conversations: [conversation],
          total: 1,
          unread: 0,
          page: 1,
          pageSize: 50,
        }),
      });
    }
    if (path === `/admin/api/whatsapp/conversations/${conversationId}`) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          conversation,
          memories: [],
          messages: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              conversationId,
              whatsappMessageId: 'wa-1',
              direction: 'inbound',
              senderType: 'customer',
              content: 'Здравствуйте',
              deliveryStatus: 'received',
              createdAt: now,
            },
          ],
        }),
      });
    }
    if (path === '/admin/api/whatsapp/knowledge') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, documents: [] }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/admin/whatsapp');
  await expect(page.getByRole('heading', { name: 'WhatsApp и ИИ-ассистент' })).toBeVisible();

  const reply = page.getByLabel('Ответ клиенту');
  if (!(await reply.isVisible())) {
    await page.locator('.whatsapp-conversation-item').first().click();
  }
  await reply.fill('Несохранённый ответ');
  await dismissBlockedSidebarNavigation(page);
  await expect(reply).toHaveValue('Несохранённый ответ');
  await reply.fill('');

  await page.getByRole('tab', { name: 'Настройки ИИ' }).click();
  const botName = page.locator('#whatsapp-bot-name');
  await botName.fill('Bulka помощник');
  await dismissBlockedSidebarNavigation(page);
  await expect(botName).toHaveValue('Bulka помощник');
  await botName.fill(settings.botName);

  await page.getByRole('tab', { name: 'База знаний' }).click();
  await page.getByRole('button', { name: 'Добавить материал' }).first().click();
  await page.locator('#knowledge-title').fill('Правила самовывоза');
  await page.locator('#knowledge-content').fill('Заказ хранится до закрытия филиала.');
  await dismissBlockedSidebarNavigation(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#knowledge-title')).toHaveValue('Правила самовывоза');
  await expect(page.locator('#knowledge-content')).toHaveValue(
    'Заказ хранится до закрытия филиала.',
  );
});

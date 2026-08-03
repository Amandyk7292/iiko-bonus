import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const now = '2026-07-22T10:00:00.000Z';
const conversation = {
  id: '11111111-1111-4111-8111-111111111111',
  chatJid: '77001234567@s.whatsapp.net',
  phone: '+7 700 123 45 67',
  displayName: 'Клиент Bulka',
  status: 'open' as const,
  assistantEnabled: true,
  contextResetAt: null,
  unreadCount: 1,
  lastMessagePreview: 'Здравствуйте, есть ли круассаны?',
  lastMessageAt: now,
  lastCustomerMessageAt: now,
  lastOperatorMessageAt: null,
  createdAt: now,
  updatedAt: now,
};
const secondConversation = {
  ...conversation,
  id: '44444444-4444-4444-8444-444444444444',
  chatJid: '77007654321@s.whatsapp.net',
  phone: '+7 700 765 43 21',
  displayName: 'Второй клиент',
  unreadCount: 0,
  lastMessagePreview: 'Второй диалог',
};

const selectConversation = async (page: Page, index: number) => {
  const backButton = page.getByRole('button', { name: 'К списку диалогов' });
  if (await backButton.isVisible()) await backButton.click();
  await page.locator('.whatsapp-conversation-item').nth(index).click();
};

test('protected operator link opens only chats and allows a reply', async ({ page }) => {
  const exchangedTokens: string[] = [];
  const replies: string[] = [];

  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.postDataJSON?.() as Record<string, unknown> | null;

    if (path === '/admin/api/whatsapp/operator-access') {
      exchangedTokens.push(String(body?.token || ''));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { username: 'whatsapp-operator', role: 'whatsapp_operator', branchIds: [] },
        }),
      });
    }
    if (path === '/admin/api/whatsapp/status') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          settings: null,
          connection: {
            state: 'connected',
            connected: true,
            connectedAt: now,
            updatedAt: now,
            phone: '+7 70• ••• 4567',
            qrDataUrl: '',
            qrReceivedAt: null,
            lastError: '',
            assistant: {
              environmentEnabled: true,
              provider: 'gemini',
              keyConfigured: true,
              model: 'gemini-3.1-flash-lite',
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
          conversations: [conversation, secondConversation],
          total: 2,
          unread: 1,
        }),
      });
    }
    if (path.endsWith('/messages') && request.method() === 'POST') {
      const text = String(body?.text || '');
      replies.push(text);
      const target = path.includes(secondConversation.id) ? secondConversation : conversation;
      const updated = { ...target, assistantEnabled: false, unreadCount: 0 };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          conversation: updated,
          message: {
            id: '22222222-2222-4222-8222-222222222222',
            conversationId: target.id,
            whatsappMessageId: 'wa-1',
            direction: 'outbound',
            senderType: 'operator',
            content: text,
            deliveryStatus: 'sent',
            createdAt: now,
          },
        }),
      });
    }
    const target = path.endsWith(`/${secondConversation.id}`) ? secondConversation : conversation;
    if (
      (path.endsWith(`/${conversation.id}`) || path.endsWith(`/${secondConversation.id}`)) &&
      request.method() === 'PATCH'
    ) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, conversation: { ...target, unreadCount: 0 } }),
      });
    }
    if (path.endsWith(`/${conversation.id}`) || path.endsWith(`/${secondConversation.id}`)) {
      if (target.id === conversation.id) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          conversation: target,
          memories: [],
          messages: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              conversationId: target.id,
              whatsappMessageId: 'wa-in-1',
              direction: 'inbound',
              senderType: 'customer',
              content:
                target.id === conversation.id
                  ? 'Здравствуйте, есть ли круассаны?'
                  : 'Сообщение второго клиента',
              deliveryStatus: 'received',
              createdAt: now,
            },
          ],
        }),
      });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/admin/whatsapp-access#operator-secret-token');
  await expect(page).toHaveURL(/\/admin\/whatsapp$/);
  expect(exchangedTokens).toEqual(['operator-secret-token']);
  expect(await page.evaluate(() => window.location.hash)).toBe('');

  await expect(page.getByRole('heading', { name: 'Переписки WhatsApp' })).toBeVisible();
  await expect(page.getByText('База знаний')).toHaveCount(0);
  await expect(page.getByText('Настройки ИИ')).toHaveCount(0);
  await expect(page.getByText('Память клиента')).toHaveCount(0);
  await expect(page.locator('.sagi-sidebar')).toHaveCount(0);

  const conversationItems = page.locator('.whatsapp-conversation-item');
  await selectConversation(page, 1);
  await expect(page.locator('.whatsapp-chat-person').getByText('Второй клиент')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('.whatsapp-chat-person').getByText('Второй клиент')).toBeVisible();

  await selectConversation(page, 0);
  const reply = page.getByLabel('Ответ клиенту');
  await expect(reply).toBeEnabled();
  await reply.fill('Черновик первого клиента');
  await selectConversation(page, 1);
  const warning = page.getByRole('alertdialog');
  await expect(warning).toContainText('Черновик останется');
  await warning.getByRole('button', { name: 'Отмена' }).click();
  await expect(warning).toBeHidden();
  await expect(reply).toHaveValue('Черновик первого клиента');

  await selectConversation(page, 1);
  const confirmedWarning = page.getByRole('alertdialog');
  await expect(confirmedWarning).toBeVisible();
  await confirmedWarning.getByRole('button', { name: 'Перейти' }).click();
  await expect(page.getByLabel('Ответ клиенту')).toHaveValue('');
  await selectConversation(page, 0);
  await expect(page.getByLabel('Ответ клиенту')).toHaveValue('Черновик первого клиента');
  await reply.fill('Здравствуйте! Да, круассаны есть.');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.getByText('Здравствуйте! Да, круассаны есть.')).toBeVisible();
  expect(replies).toEqual(['Здравствуйте! Да, круассаны есть.']);

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['color-contrast'])
    .analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact || ''),
    ),
  ).toEqual([]);
});

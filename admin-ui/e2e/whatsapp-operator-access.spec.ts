import { expect, test } from '@playwright/test';

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
        body: JSON.stringify({ success: true, conversations: [conversation], total: 1, unread: 1 }),
      });
    }
    if (path.endsWith('/messages') && request.method() === 'POST') {
      const text = String(body?.text || '');
      replies.push(text);
      const updated = { ...conversation, assistantEnabled: false, unreadCount: 0 };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          conversation: updated,
          message: {
            id: '22222222-2222-4222-8222-222222222222',
            conversationId: conversation.id,
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
    if (path.endsWith(`/${conversation.id}`) && request.method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, conversation: { ...conversation, unreadCount: 0 } }),
      });
    }
    if (path.endsWith(`/${conversation.id}`)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          conversation,
          memories: [],
          messages: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              conversationId: conversation.id,
              whatsappMessageId: 'wa-in-1',
              direction: 'inbound',
              senderType: 'customer',
              content: 'Здравствуйте, есть ли круассаны?',
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

  await page.locator('.whatsapp-conversation-item').click();
  const reply = page.getByLabel('Ответ клиенту');
  await expect(reply).toBeEnabled();
  await reply.fill('Здравствуйте! Да, круассаны есть.');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.getByText('Здравствуйте! Да, круассаны есть.')).toBeVisible();
  expect(replies).toEqual(['Здравствуйте! Да, круассаны есть.']);
});

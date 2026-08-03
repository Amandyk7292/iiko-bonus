import { expect, test } from '@playwright/test';

const now = '2026-08-03T18:00:00.000Z';
const qrDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nZkAAAAASUVORK5CYII=';

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

test('owner can clear a stale WhatsApp session and receive a new QR', async ({ page }) => {
  let resetCalls = 0;
  let pairingReset = false;

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
            whatsappDialogs: 0,
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
            state: pairingReset ? 'awaiting_scan' : 'reconnecting',
            connected: false,
            connectedAt: null,
            updatedAt: now,
            phone: '',
            qrDataUrl: pairingReset ? qrDataUrl : '',
            qrReceivedAt: pairingReset ? now : null,
            lastError: pairingReset ? '' : 'Соединение потеряно, выполняется переподключение',
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
    if (path === '/admin/api/whatsapp/pairing/reset' && request.method() === 'POST') {
      resetCalls += 1;
      pairingReset = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          connection: {
            state: 'awaiting_scan',
            connected: false,
            connectedAt: null,
            updatedAt: now,
            phone: '',
            qrDataUrl,
            qrReceivedAt: now,
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
          conversations: [],
          total: 0,
          unread: 0,
          page: 1,
          pageSize: 50,
        }),
      });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/admin/whatsapp');
  await expect(page.getByRole('heading', { name: 'Переподключение' })).toBeVisible();

  await page.getByRole('button', { name: 'Создать новый QR' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('Текущая серверная привязка WhatsApp будет очищена');
  await confirmation.getByRole('button', { name: 'Создать QR' }).click();

  await expect(page.getByRole('heading', { name: 'Нужно связать WhatsApp' })).toBeVisible();
  await expect(page.getByAltText('QR-код для подключения WhatsApp')).toBeVisible();
  expect(resetCalls).toBe(1);
});

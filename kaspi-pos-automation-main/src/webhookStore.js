import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBHOOKS_FILE = path.join(__dirname, '..', 'webhooks.json');

/**
 * Читает webhooks.json и возвращает массив вебхуков.
 * При ошибке чтения/парсинга возвращает [].
 */
export const loadWebhooks = () => {
  let hooks = [];
  try {
    const raw = fs.readFileSync(WEBHOOKS_FILE, 'utf8');
    hooks = JSON.parse(raw);
    if (!Array.isArray(hooks)) hooks = [];
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[WEBHOOK STORE] Error reading webhooks.json:', err.message);
    }
  }

  // Inject local webhook for integrated mode
  if (process.env.KASPI_MOUNTED === 'true' && process.env.KASPI_WEBHOOK_SECRET) {
    const port = process.env.PORT || 3000;
    hooks.push({
      url: `http://127.0.0.1:${port}/webhooks/kaspi`,
      secret: process.env.KASPI_WEBHOOK_SECRET,
      events: ['payment.success', 'payment.failed', 'payment.expired']
    });
  }
  
  return hooks;
};

/**
 * Возвращает вебхуки, подписанные на указанное событие.
 */
export const getWebhooksByEvent = (event) => {
  return loadWebhooks().filter((hook) => hook.url && Array.isArray(hook.events) && hook.events.includes(event));
};

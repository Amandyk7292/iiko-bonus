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
  let fileHooks = [];
  try {
    const raw = fs.readFileSync(WEBHOOKS_FILE, 'utf8');
    const hooks = JSON.parse(raw);
    if (Array.isArray(hooks)) fileHooks = hooks;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[WEBHOOK STORE] Error reading webhooks.json:', err.message);
    }
  }

  const baseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const envUrl = String(process.env.KASPI_WEBHOOK_URL || `${baseUrl}/webhooks/kaspi`).trim();
  const envSecret = String(process.env.KASPI_WEBHOOK_SECRET || '').trim();
  const envHook =
    /^https:\/\//.test(envUrl) && envSecret.length >= 32
      ? [
          {
            url: envUrl,
            events: ['payment.success', 'payment.failed', 'payment.expired'],
            secret: envSecret,
          },
        ]
      : [];

  return [...fileHooks, ...envHook].filter(
    (hook, index, hooks) => hooks.findIndex((candidate) => candidate.url === hook.url) === index,
  );
};

/**
 * Возвращает вебхуки, подписанные на указанное событие.
 */
export const getWebhooksByEvent = (event) => {
  return loadWebhooks().filter((hook) => hook.url && Array.isArray(hook.events) && hook.events.includes(event));
};

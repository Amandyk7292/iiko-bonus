const MAX_TEXT_LENGTH = 4096;

function createTelegramApi({
  token = process.env.PHOTO_REPORT_TELEGRAM_BOT_TOKEN || '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000,
} = {}) {
  // Telegram puts the credential in its URL: never retain provider exceptions or bodies.
  const configured = typeof token === 'string' && /^[A-Za-z0-9:_-]+$/.test(token);
  const deadline = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : 12000;
  async function call(method, data, { signal, longPollSeconds = 0 } = {}) {
    if (!configured || typeof fetchImpl !== 'function') return { status: 'failed' };
    if (signal?.aborted) return { status: 'cancelled' };
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, deadline + longPollSeconds * 1000);
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal,
        redirect: 'error',
      });
      let body;
      try {
        body = await response.json();
      } catch {
        return { status: signal?.aborted ? 'cancelled' : 'uncertain' };
      }
      if (response.ok && body?.ok === true) return { status: 'ok', result: body.result };
      const errorCode = Number.isInteger(body?.error_code) ? body.error_code : response.status;
      if (errorCode === 429) {
        const retry = body?.parameters?.retry_after;
        return {
          status: 'retryable',
          retryAfterSeconds: Number.isInteger(retry) && retry > 0 ? retry : 30,
        };
      }
      if (errorCode === 403) return { status: 'forbidden' };
      // A provider 5xx response does not prove sendMessage was rejected.
      if (errorCode >= 500)
        return method === 'sendMessage'
          ? { status: 'uncertain' }
          : { status: 'retryable', retryAfterSeconds: 5 };
      return { status: 'failed', errorCode: Number.isInteger(errorCode) ? errorCode : 0 };
    } catch {
      return { status: signal?.aborted ? 'cancelled' : 'uncertain' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  async function sendMessage(chatId, text, options) {
    if (
      !/^\d+$/.test(String(chatId)) ||
      typeof text !== 'string' ||
      !text.length ||
      text.length > MAX_TEXT_LENGTH
    )
      return { status: 'failed' };
    const result = await call(
      'sendMessage',
      {
        chat_id: String(chatId),
        text,
        link_preview_options: { is_disabled: true },
      },
      options,
    );
    if (result.status !== 'ok') return result;
    return Number.isSafeInteger(result.result?.message_id)
      ? { status: 'sent', messageId: result.result.message_id }
      : { status: 'uncertain' };
  }
  async function getUpdates({ offset = 0, timeoutSeconds = 25, signal } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0) return { status: 'failed' };
    const seconds = Math.min(50, Math.max(1, Math.trunc(Number(timeoutSeconds) || 25)));
    const result = await call(
      'getUpdates',
      {
        offset,
        timeout: seconds,
        limit: 100,
        allowed_updates: ['message'],
      },
      { signal, longPollSeconds: seconds },
    );
    if (result.status !== 'ok') return result;
    return Array.isArray(result.result)
      ? { status: 'ok', updates: result.result }
      : { status: 'uncertain' };
  }
  async function deleteWebhook(options) {
    const result = await call('deleteWebhook', { drop_pending_updates: false }, options);
    if (result.status !== 'ok') return result;
    return result.result === true ? { status: 'ok' } : { status: 'failed' };
  }
  return { configured, sendMessage, getUpdates, deleteWebhook };
}

module.exports = { createTelegramApi, MAX_TEXT_LENGTH };

const { supabase } = require('../config/supabase');

const rpc = async (db, name, args) => {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
};

function createSuspiciousPurchaseAlertWorker({
  db = supabase,
  sendMessage,
  now = () => new Date(),
  limit = 20,
} = {}) {
  const api = sendMessage
    ? null
    : require('./branch-photo-telegram-api.service').createTelegramApi();
  const sender = sendMessage || api.sendMessage;
  if (typeof sender !== 'function') throw new Error('Telegram alert sender is required');
  let running = false;
  let stopping = false;

  const options = () => ({ p_now: new Date(now()).toISOString() });

  return {
    stop() {
      stopping = true;
    },
    async tick() {
      if (stopping) return { skipped: true, reason: 'stopping' };
      if (running) return { skipped: true, reason: 'busy' };
      running = true;
      try {
        if (api && !api.configured)
          throw Object.assign(new Error('Photo-report Telegram bot is not configured'), {
            code: 'PHOTO_REPORT_TELEGRAM_NOT_CONFIGURED',
          });

        const result = { delivered: 0, retried: 0, uncertain: 0, failed: 0, disabled: 0 };
        const deliveries = await rpc(db, 'claim_photo_report_telegram_alerts', {
          p_limit: Math.min(100, Math.max(1, Math.trunc(Number(limit) || 20))),
          ...options(),
        });
        if (!Array.isArray(deliveries)) throw new Error('Invalid alert delivery claim');

        for (const delivery of deliveries) {
          if (stopping) break;
          if (
            !delivery ||
            !/^[a-f0-9-]{36}$/i.test(String(delivery.id || '')) ||
            !/^[a-f0-9-]{36}$/i.test(String(delivery.leaseToken || '')) ||
            !/^[1-9]\d{0,19}$/.test(String(delivery.chatId || '')) ||
            !/^[a-f0-9-]{36}$/i.test(String(delivery.recipientId || '')) ||
            typeof delivery.text !== 'string' ||
            !delivery.text.length ||
            delivery.text.length > 4096
          )
            throw new Error('Invalid Telegram alert delivery');

          const args = { p_id: delivery.id, p_lease: delivery.leaseToken, ...options() };
          const authorized = await rpc(db, 'authorize_photo_report_telegram_alert', args);
          if (authorized !== true) continue;

          let outcome;
          try {
            outcome = await sender(delivery.chatId, delivery.text);
          } catch {
            outcome = { status: 'uncertain' };
          }

          if (outcome?.status === 'sent' && Number.isSafeInteger(outcome.messageId)) {
            const completed = await rpc(db, 'complete_photo_report_telegram_alert', {
              ...args,
              p_message_id: String(outcome.messageId),
            });
            if (completed !== true) throw new Error('Telegram alert acknowledgement failed');
            result.delivered++;
          } else if (outcome?.status === 'retryable') {
            await rpc(db, 'fail_photo_report_telegram_alert', {
              ...args,
              p_retry: Math.min(
                2147483647,
                Math.max(1, Math.ceil(Number(outcome.retryAfterSeconds) || 60)),
              ),
              p_permanent: false,
              p_uncertain: false,
            });
            result.retried++;
            break;
          } else if (outcome?.status === 'forbidden') {
            await rpc(db, 'fail_photo_report_telegram_alert', {
              ...args,
              p_retry: 0,
              p_permanent: true,
              p_uncertain: false,
            });
            await rpc(db, 'disable_photo_report_telegram_recipient', {
              p_id: delivery.recipientId,
              p_now: options().p_now,
            });
            result.disabled++;
          } else if (outcome?.status === 'failed') {
            await rpc(db, 'fail_photo_report_telegram_alert', {
              ...args,
              p_retry: 0,
              p_permanent: true,
              p_uncertain: false,
            });
            result.failed++;
          } else {
            await rpc(db, 'fail_photo_report_telegram_alert', {
              ...args,
              p_retry: 0,
              p_permanent: false,
              p_uncertain: true,
            });
            result.uncertain++;
          }
        }
        return result;
      } finally {
        running = false;
      }
    },
  };
}

module.exports = { createSuspiciousPurchaseAlertWorker };

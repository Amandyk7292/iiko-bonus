const { supabase } = require('../config/supabase');
const {
  generateDigest,
  localClock,
  previousCalendarDate,
  TIME_ZONE,
} = require('./branch-photo-digest.service');

function createDigestWorker({
  store,
  sendMessage,
  db = supabase,
  now = () => new Date(),
  generate = generateDigest,
  limit = 20,
} = {}) {
  store = store || require('./branch-photo-telegram-store.service');
  const api = sendMessage
    ? null
    : require('./branch-photo-telegram-api.service').createTelegramApi();
  const sender = sendMessage || api.sendMessage;
  if (typeof sender !== 'function') throw new Error('Digest sender is required');
  let running = false;
  let stopping = false;
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
        const instant = new Date(now());
        const options = { db, now: instant };
        const settings = await store.getSettings({ db });
        if (settings.timeZone !== TIME_ZONE || !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.sendTime))
          throw Object.assign(new Error('Invalid digest schedule'), {
            code: 'PHOTO_REPORT_DIGEST_SCHEDULE_INVALID',
          });
        const date = previousCalendarDate(instant);
        const result = {
          date,
          enqueued: false,
          delivered: 0,
          retried: 0,
          uncertain: 0,
          failed: 0,
          disabled: 0,
          skipped: 0,
        };
        if (
          settings.ownerUserId &&
          localClock(instant).time >= settings.sendTime &&
          !(await store.digestExists(date, { db }))
        ) {
          const digest = await generate(date, options);
          const queued = await store.enqueueDigest(date, digest.parts, options);
          result.enqueued = queued.enqueued;
        }
        for (let i = 0; i < Math.min(100, Math.max(1, Number(limit) || 20)); i++) {
          if (stopping) break;
          const deliveryOptions = () => ({ db, now: new Date(now()) });
          const deliveries = await store.claimDeliveries(1, deliveryOptions());
          if (!deliveries.length) break;
          if (deliveries.length !== 1) throw new Error('Invalid digest delivery claim');
          const delivery = deliveries[0];
          const args = [delivery.id, delivery.leaseToken];
          if (!(await store.deliveryAuthorized(...args, deliveryOptions()))) {
            await store.failDelivery(...args, { permanent: true }, deliveryOptions());
            result.skipped++;
            continue;
          }
          let outcome;
          try {
            outcome = await sender(delivery.chatId, delivery.text);
          } catch {
            outcome = { status: 'uncertain' };
          }
          if (outcome?.status === 'sent') {
            try {
              if (!(await store.completeDelivery(...args, outcome.messageId, deliveryOptions())))
                throw new Error('Digest delivery acknowledgement failed');
            } catch (error) {
              await store
                .failDelivery(...args, { uncertain: true }, deliveryOptions())
                .catch(() => {});
              throw error;
            }
            result.delivered++;
          } else if (outcome?.status === 'retryable') {
            const retryAfter = Math.max(1, Math.ceil(Number(outcome.retryAfterSeconds) || 60));
            await store.failDelivery(...args, { retryAfter }, deliveryOptions());
            result.retried++;
            break;
          } else if (outcome?.status === 'forbidden') {
            await store.failDelivery(...args, { permanent: true }, deliveryOptions());
            await store.disableRecipient(delivery.recipientId, deliveryOptions());
            result.disabled++;
          } else if (outcome?.status === 'failed') {
            await store.failDelivery(...args, { permanent: true }, deliveryOptions());
            result.failed++;
          } else {
            await store.failDelivery(...args, { uncertain: true }, deliveryOptions());
            result.uncertain++;
          }
        }
        const unresolved = await store.getUnresolvedDeliveryCounts({ db, now: new Date(now()) });
        if (
          !unresolved ||
          ![unresolved.uncertain, unresolved.failed].every(
            (count) => Number.isSafeInteger(count) && count >= 0,
          )
        )
          throw Object.assign(new Error('Invalid digest delivery state'), {
            code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_STATE_INVALID',
          });
        result.uncertain = Math.max(result.uncertain, unresolved.uncertain);
        result.failed = Math.max(result.failed, unresolved.failed);
        if (result.uncertain || result.failed)
          throw Object.assign(new Error('Telegram photo-report delivery requires attention'), {
            code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_FAILED',
            uncertain: result.uncertain,
            failed: result.failed,
          });
        return result;
      } finally {
        running = false;
      }
    },
  };
}

module.exports = { createDigestWorker };

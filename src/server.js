require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || undefined });
const { installConsoleBridge, logger } = require('./config/logger');
installConsoleBridge();
const app = require('./app');
const { flushWhatsAppOutbox, initWhatsApp } = require('./services/whatsapp-baileys.service');
const {
  getOrCreateCustomerByPhone,
  checkAndExpireInactiveBonuses,
  activatePendingBonusesSafe,
} = require('./services/customer.service');
const { startPolling: startTelegramBot } = require('./services/telegram.service');
const { getSettings } = require('./services/settings.service');
const { shouldRunBots } = require('./config/env');
const kaspiService = require('./services/kaspi.service');
const forteService = require('./services/forte.service');
const forteWidgetService = require('./services/forte-widget.service');
const {
  deliverAutomatedMessages,
  enqueueAutomatedMessages,
} = require('./services/commerce-marketing.service');
const { syncActiveDeliveries } = require('./services/yandex-delivery.service');
const { registerWorker, runMonitoredWorker } = require('./services/operational-health.service');
const { cleanupExpiredPayments } = require('./services/payment-cleanup.service');
const { processPrivacyStorageCleanupJobs } = require('./services/privacy-storage-cleanup.service');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (!process.env.VERCEL) {
  const runWorkers = process.env.RUN_BACKGROUND_WORKERS === 'true';
  const runBots = shouldRunBots();
  registerWorker('pending-bonus-activation', { enabled: runWorkers, intervalMs: 60 * 60 * 1000 });
  const activatePendingBonuses = () =>
    runMonitoredWorker('pending-bonus-activation', activatePendingBonusesSafe);
  if (runWorkers) setInterval(activatePendingBonuses, 60 * 60 * 1000);

  registerWorker('daily-bonus-expiration', {
    enabled: runWorkers,
    intervalMs: 24 * 60 * 60 * 1000,
  });
  const runDailyChecks = () =>
    runMonitoredWorker('daily-bonus-expiration', async () => {
      const settings = await getSettings();
      const expiration = settings.bonus_expiration || {};
      if (expiration.enabled !== false && expiration.auto_write_off !== false) {
        await checkAndExpireInactiveBonuses(Number(expiration.expiration_days || 90));
      }
    });

  if (runWorkers) {
    setTimeout(runDailyChecks, 5000);
    setInterval(runDailyChecks, 24 * 60 * 60 * 1000);

    const reconcileKaspiOrders = () =>
      runMonitoredWorker('kaspi-reconciliation', () => kaspiService.reconcileOrders());
    setTimeout(reconcileKaspiOrders, 15 * 1000);
    setInterval(reconcileKaspiOrders, 60 * 1000);

    const reconcileForteOrders = () =>
      runMonitoredWorker('forte-reconciliation', async () => {
        const [legacy, widget] = await Promise.all([
          forteService.reconcileOrders(),
          forteWidgetService.reconcileOrders(),
        ]);
        return Number(legacy || 0) + Number(widget || 0);
      });
    setTimeout(reconcileForteOrders, 20 * 1000);
    setInterval(reconcileForteOrders, 60 * 1000);

    const cleanupUnpaidOrders = () =>
      runMonitoredWorker('payment-expiration-cleanup', cleanupExpiredPayments);
    setTimeout(cleanupUnpaidOrders, 25 * 1000);
    setInterval(cleanupUnpaidOrders, 60 * 1000);

    const runMarketing = () =>
      runMonitoredWorker('marketing-automation', async () => {
        await enqueueAutomatedMessages();
        await deliverAutomatedMessages();
      });
    setTimeout(runMarketing, 30 * 1000);
    setInterval(runMarketing, 10 * 60 * 1000);

    const cleanupPrivacyStorage = () =>
      runMonitoredWorker('privacy-storage-cleanup', processPrivacyStorageCleanupJobs);
    setTimeout(cleanupPrivacyStorage, 35 * 1000);
    setInterval(cleanupPrivacyStorage, 60 * 1000);
  }
  registerWorker('kaspi-reconciliation', {
    enabled: runWorkers && process.env.KASPI_POS_ENABLED === 'true',
    intervalMs: 60 * 1000,
    critical: true,
  });
  registerWorker('forte-reconciliation', {
    enabled:
      runWorkers &&
      (process.env.FORTE_ENABLED === 'true' || process.env.FORTE_WIDGET_ENABLED === 'true'),
    intervalMs: 60 * 1000,
    critical: true,
  });
  registerWorker('payment-expiration-cleanup', {
    enabled: runWorkers,
    intervalMs: 60 * 1000,
    critical: true,
  });
  registerWorker('marketing-automation', {
    enabled: runWorkers,
    intervalMs: 10 * 60 * 1000,
  });
  registerWorker('privacy-storage-cleanup', {
    enabled: runWorkers,
    intervalMs: 60 * 1000,
    critical: true,
  });

  // Delivery tracking is part of the request lifecycle, not an optional
  // marketing worker. It starts automatically when the integration is enabled.
  if (
    process.env.YANDEX_DELIVERY_ENABLED === 'true' &&
    process.env.RUN_YANDEX_DELIVERY_WORKER !== 'false'
  ) {
    const syncYandexDeliveries = () =>
      runMonitoredWorker('yandex-delivery-sync', syncActiveDeliveries);
    setTimeout(syncYandexDeliveries, 10 * 1000);
    setInterval(syncYandexDeliveries, 15 * 1000);
  }
  registerWorker('yandex-delivery-sync', {
    enabled:
      process.env.YANDEX_DELIVERY_ENABLED === 'true' &&
      process.env.RUN_YANDEX_DELIVERY_WORKER !== 'false',
    intervalMs: 15 * 1000,
    critical: true,
  });

  app.listen(PORT, HOST, () => {
    logger.info({ event: 'server_started', host: HOST, port: Number(PORT) }, 'Server started');

    if (runBots) {
      try {
        startTelegramBot();
      } catch (e) {
        logger.error({ err: e, event: 'telegram_bot_init_failed' }, 'Telegram bot init failed');
      }

      try {
        const otpStore = require('./services/otpStore.service');
        initWhatsApp(otpStore, getOrCreateCustomerByPhone);
        const runWhatsAppOutbox = process.env.RUN_WHATSAPP_OUTBOX_WORKER !== 'false';
        registerWorker('whatsapp-outbox', {
          enabled: runWhatsAppOutbox,
          intervalMs: 5000,
          critical: true,
        });
        if (runWhatsAppOutbox) {
          const outboxTimer = setInterval(() => {
            void runMonitoredWorker('whatsapp-outbox', flushWhatsAppOutbox);
          }, 5000);
          outboxTimer.unref?.();
        }
      } catch (e) {
        logger.error({ err: e, event: 'whatsapp_bot_init_failed' }, 'WhatsApp bot init failed');
      }
    }
  });
}

module.exports = app;

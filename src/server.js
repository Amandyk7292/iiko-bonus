require('dotenv').config();
const app = require('./app');
const { initWhatsApp } = require('./services/whatsapp-baileys.service');
const {
  getOrCreateCustomerByPhone,
  checkAndExpireInactiveBonuses,
  checkAndNotifyInactiveCustomers,
  checkAndNotifyBirthdays,
  activatePendingBonusesSafe,
} = require('./services/customer.service');
const { startPolling: startTelegramBot } = require('./services/telegram.service');
const { getSettings } = require('./services/settings.service');
const { shouldRunBots } = require('./config/env');

const PORT = process.env.PORT || 3000;

if (!process.env.VERCEL) {
  const runWorkers = process.env.RUN_BACKGROUND_WORKERS === 'true';
  const runBots = shouldRunBots();
  if (runWorkers) setInterval(activatePendingBonusesSafe, 60 * 60 * 1000);

  let dailyChecksRunning = false;
  const runDailyChecks = async () => {
    if (dailyChecksRunning) return;
    dailyChecksRunning = true;
    try {
      const settings = await getSettings();
      const expiration = settings.bonus_expiration || {};
      if (expiration.enabled !== false && expiration.auto_write_off !== false) {
        await checkAndExpireInactiveBonuses(Number(expiration.expiration_days || 90));
      }
      if (expiration.enabled !== false && Number(expiration.notify_before_days || 0) > 0) {
        const expirationDays = Number(expiration.expiration_days || 90);
        const notifyBeforeDays = Number(expiration.notify_before_days || 30);
        await checkAndNotifyInactiveCustomers(
          Math.max(1, expirationDays - notifyBeforeDays),
          expirationDays,
        );
      }
      await checkAndNotifyBirthdays(settings);
    } catch (err) {
      console.error('Daily checks failed:', err);
    } finally {
      dailyChecksRunning = false;
    }
  };

  if (runWorkers) {
    setTimeout(runDailyChecks, 5000);
    setInterval(runDailyChecks, 24 * 60 * 60 * 1000);
  }

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);

    if (runBots) {
      try {
        startTelegramBot();
      } catch (e) {
        console.error('Telegram bot init error:', e);
      }

      try {
        const otpStore = require('./services/otpStore.service');
        initWhatsApp(otpStore, getOrCreateCustomerByPhone);
      } catch (e) {
        console.error('WhatsApp bot init error:', e);
      }
    }
  });
}

module.exports = app;

require('dotenv').config();
const app = require('./app');
const { initWhatsApp } = require('./services/whatsapp-baileys.service');
const { getOrCreateCustomerByPhone, checkAndExpireInactiveBonuses, checkAndNotifyInactiveCustomers, checkAndNotifyBirthdays, activatePendingBonusesSafe } = require('./services/customer.service');
const { startTelegramBot } = require('./services/telegram.service'); // Note: index.js did startTelegramBot()

const PORT = process.env.PORT || 3000;

const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.VERCEL;

if (!process.env.VERCEL) {
  // CRON Jobs
  setInterval(activatePendingBonusesSafe, 60 * 60 * 1000); // Every hour
  
  // Daily at noon check
  const runDailyChecks = () => {
    checkAndExpireInactiveBonuses(90).catch(err => console.error('Error auto-expiring bonuses:', err));
    checkAndNotifyInactiveCustomers(30).catch(err => console.error('Error auto-notifying inactive customers:', err));
    checkAndNotifyBirthdays().catch(err => console.error('Error auto-notifying birthdays:', err));
  };
  
  // Start once on boot for safety (optional) or rely on interval
  setTimeout(runDailyChecks, 5000);
  setInterval(runDailyChecks, 24 * 60 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    
    // Telegram Bot
    try {
      startTelegramBot && startTelegramBot();
    } catch(e) { console.error('Telegram bot init error:', e); }

    // WhatsApp Bot
    try {
      const otpStore = require('./services/otpStore.service'); // Not moved yet!
      initWhatsApp(otpStore, getOrCreateCustomerByPhone);
    } catch(e) { console.error('WhatsApp bot init error:', e); }
  });
}

module.exports = app;

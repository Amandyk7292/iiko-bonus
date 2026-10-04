const tokenPattern = /^\d{6,12}:[A-Za-z0-9_-]{35}$/;
const usernamePattern = /^[a-zA-Z0-9_]{5,32}$/;
const validOwnerId = (value) =>
  /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function photoTelegramConfigurationErrors(env = process.env) {
  const enabled = env.PHOTO_REPORT_TELEGRAM_ENABLED;
  if (enabled && !['true', 'false'].includes(enabled))
    return ['PHOTO_REPORT_TELEGRAM_ENABLED(true or false)'];
  if (enabled !== 'true') return [];
  const errors = [];
  if (!tokenPattern.test(String(env.PHOTO_REPORT_TELEGRAM_BOT_TOKEN || '')))
    errors.push('PHOTO_REPORT_TELEGRAM_BOT_TOKEN(valid bot token)');
  const username = String(env.PHOTO_REPORT_TELEGRAM_OWNER_USERNAME || '').replace(/^@/, '');
  const ownerId = env.PHOTO_REPORT_TELEGRAM_OWNER_ID;
  if (!usernamePattern.test(username))
    errors.push('PHOTO_REPORT_TELEGRAM_OWNER_USERNAME(valid username)');
  if (ownerId && !validOwnerId(ownerId))
    errors.push('PHOTO_REPORT_TELEGRAM_OWNER_ID(valid user ID)');
  return errors;
}

// Dedicated report notifications can run while the old loyalty/WhatsApp bots are off.
// Preflight and staging disable all background workers, including this bot.
function shouldRunPhotoTelegram(env = process.env) {
  return (
    env.RUN_BACKGROUND_WORKERS === 'true' &&
    env.PHOTO_REPORT_TELEGRAM_ENABLED === 'true' &&
    photoTelegramConfigurationErrors(env).length === 0
  );
}

module.exports = { photoTelegramConfigurationErrors, shouldRunPhotoTelegram };

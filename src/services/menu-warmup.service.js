const { logger } = require('../config/logger');

async function warmMenus(clients) {
  for (const client of new Set(clients)) {
    if (!client?.apiLogin) continue;
    if (client.cachedMenu && client.cachedMenuExpiresAt - Date.now() > 45000) continue;
    try {
      await client.getMenu({ strict: true, forceRefresh: Boolean(client.cachedMenu) });
    } catch (_) {
      logger.warn({ event: 'menu_warmup_unavailable', profile: client.profileKey });
    }
  }
}

function startMenuWarmup() {
  const { getIikoClientForCity } = require('./iiko-city-profile.service');
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await warmMenus([getIikoClientForCity('aktau'), getIikoClientForCity('astana')]);
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(() => void tick(), 1000);
  const interval = setInterval(() => void tick(), 30000);
  initial.unref?.();
  interval.unref?.();
  return () => {
    clearTimeout(initial);
    clearInterval(interval);
  };
}

module.exports = { warmMenus, startMenuWarmup };

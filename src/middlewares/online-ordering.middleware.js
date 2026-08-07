const { logger } = require('../config/logger');
const {
  ONLINE_ORDERING_DISABLED_MESSAGE,
  getOnlineOrderingConfig,
} = require('../services/online-ordering.service');

function createOnlineOrderingMiddleware({
  loadConfig = getOnlineOrderingConfig,
  log = logger,
} = {}) {
  return async function onlineOrderingGuard(_req, res, next) {
    try {
      const config = await loadConfig();
      if (!config.disabled) return next();
      return res.status(503).json({
        success: false,
        available: false,
        error: ONLINE_ORDERING_DISABLED_MESSAGE,
        code: 'ONLINE_ORDERING_DISABLED',
        retryable: false,
      });
    } catch (error) {
      log.error(
        { err: error, event: 'online_ordering_guard_failed' },
        'Online ordering configuration could not be checked',
      );
      return res.status(503).json({
        success: false,
        available: false,
        error: 'Онлайн-заказы временно недоступны. Попробуйте позже.',
        code: error.code || 'ONLINE_ORDERING_CONFIG_UNAVAILABLE',
        retryable: true,
      });
    }
  };
}

const onlineOrderingMiddleware = createOnlineOrderingMiddleware();

module.exports = { createOnlineOrderingMiddleware, onlineOrderingMiddleware };

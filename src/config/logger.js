const pino = require('pino');

const isTest = process.env.NODE_ENV === 'test';

function redactResetSecrets(value, seen = new WeakMap()) {
  if (typeof value === 'string') {
    return value.replace(/(\/reset-password#reset=)[a-f0-9]{64}/g, '$1[REDACTED]');
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  const copy = Array.isArray(value) ? [] : value instanceof Error ? new Error(value.message) : {};
  seen.set(value, copy);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    copy[key] = ['resetToken', 'reset_token', 'reset_url'].includes(key)
      ? '[REDACTED]'
      : redactResetSecrets(value[key], seen);
  }
  return copy;
}

const logger = pino({
  level: isTest ? 'silent' : process.env.LOG_LEVEL || 'info',
  base: {
    service: 'bulka-bonus-backend',
    environment: process.env.NODE_ENV || 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  hooks: {
    logMethod(args, method) {
      return method.apply(
        this,
        args.map((value) => redactResetSecrets(value)),
      );
    },
  },
  redact: {
    paths: [
      'authorization',
      'cookie',
      'token',
      'resetToken',
      '*.resetToken',
      'req.body.resetToken',
      'password',
      'secret',
      'apiKey',
      'fcmToken',
      'fcm_token',
      'terminalToken',
      '*.terminalToken',
      'req.body.terminalToken',
      'req.body.code',
      'req.body.customerCode',
      'req.body.referralDevice',
      'req.body.proof',
      'req.body.installationId',
      'referralDevice',
      'proof',
      '*.authorization',
      '*.cookie',
      '*.token',
      '*.password',
      '*.secret',
      '*.apiKey',
      '*.fcmToken',
      '*.fcm_token',
      '**.fcmToken',
      '**.fcm_token',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.reportDeviceToken',
      'deviceToken',
      '*.deviceToken',
      'pairingCode',
      '*.pairingCode',
      'req.headers["x-bulka-session-recovery"]',
      'req.headers["x-bulka-report-token"]',
      'req.headers["x-bulka-report-session"]',
      '["x-bulka-report-token"]',
      '["x-bulka-report-session"]',
      '["x-bulka-session-recovery"]',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
});

// Pino deliberately resets the bindings formatter for child loggers. Sanitize
// bindings before serialization so secrets are also absent from their context.
const createChildLogger = logger.child;
logger.child = function child(bindings, options) {
  return createChildLogger.call(this, redactResetSecrets(bindings), options);
};
const setLoggerBindings = logger.setBindings;
logger.setBindings = function setBindings(bindings) {
  return setLoggerBindings.call(this, redactResetSecrets(bindings));
};

const redactLegacyText = (value) =>
  String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?7|8)[\s()-]*\d{3}[\s()-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, '[REDACTED_PHONE]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[REDACTED_TOKEN]');

const legacyArgument = (value) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLegacyText(value.message),
      code: value.code,
      stack: value.stack,
    };
  }
  if (typeof value === 'string') return redactLegacyText(value);
  if (value && typeof value === 'object') return value;
  return value;
};

let consoleBridgeInstalled = false;
const installConsoleBridge = () => {
  if (consoleBridgeInstalled || isTest) return;
  consoleBridgeInstalled = true;
  for (const [method, level] of [
    ['log', 'info'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
    ['debug', 'debug'],
  ]) {
    console[method] = (...args) => {
      const normalized = args.map(legacyArgument);
      const message = normalized.find((value) => typeof value === 'string') || 'Legacy log event';
      logger[level]({ event: 'legacy_console', arguments: normalized }, message);
    };
  }
};

module.exports = { installConsoleBridge, logger };

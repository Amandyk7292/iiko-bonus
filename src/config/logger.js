const pino = require('pino');

const isTest = process.env.NODE_ENV === 'test';

const logger = pino({
  level: isTest ? 'silent' : process.env.LOG_LEVEL || 'info',
  base: {
    service: 'bulka-bonus-backend',
    environment: process.env.NODE_ENV || 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'authorization',
      'cookie',
      'token',
      'password',
      'secret',
      'apiKey',
      '*.authorization',
      '*.cookie',
      '*.token',
      '*.password',
      '*.secret',
      '*.apiKey',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
});

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

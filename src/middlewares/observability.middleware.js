const crypto = require('node:crypto');
const { logger } = require('../config/logger');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const metrics = {
  startedAt: Date.now(),
  requests: 0,
  clientErrors: 0,
  serverErrors: 0,
  durationMs: 0,
};

const requestContextMiddleware = (req, res, next) => {
  const supplied = String(req.headers['x-request-id'] || '').trim();
  req.id = REQUEST_ID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  req.log = logger.child({ requestId: req.id });
  next();
};

const safeErrorResponseMiddleware = (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body) || res.statusCode < 400) {
      return originalJson(body);
    }

    const response = { ...body, requestId: body.requestId || req.id };
    if (res.statusCode >= 500) {
      if (typeof body.error === 'string' && body.error) {
        req.log?.error(
          {
            event: 'unsafe_error_response_intercepted',
            statusCode: res.statusCode,
            errorCode: body.code || 'INTERNAL_ERROR',
            path: req.path,
          },
          'A route attempted to expose an internal server error',
        );
      }
      return originalJson({
        error: 'Internal Server Error',
        code: body.code || 'INTERNAL_ERROR',
        requestId: req.id,
      });
    }
    return originalJson(response);
  };
  next();
};

const requestLoggingMiddleware = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    metrics.requests += 1;
    metrics.durationMs += durationMs;
    if (res.statusCode >= 500) metrics.serverErrors += 1;
    else if (res.statusCode >= 400) metrics.clientErrors += 1;

    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log?.[level](
      {
        event: 'http_request',
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        remoteAddress: req.ip,
      },
      'HTTP request completed',
    );
  };
  res.once('finish', record);
  res.once('close', record);
  next();
};

const metricsSnapshot = () => ({
  ...metrics,
  uptimeSeconds: Math.max(0, Math.floor((Date.now() - metrics.startedAt) / 1000)),
});

const renderPrometheusMetrics = () => {
  const snapshot = metricsSnapshot();
  return [
    '# HELP bulka_http_requests_total Total completed HTTP requests.',
    '# TYPE bulka_http_requests_total counter',
    `bulka_http_requests_total ${snapshot.requests}`,
    '# HELP bulka_http_client_errors_total Total HTTP 4xx responses.',
    '# TYPE bulka_http_client_errors_total counter',
    `bulka_http_client_errors_total ${snapshot.clientErrors}`,
    '# HELP bulka_http_server_errors_total Total HTTP 5xx responses.',
    '# TYPE bulka_http_server_errors_total counter',
    `bulka_http_server_errors_total ${snapshot.serverErrors}`,
    '# HELP bulka_http_request_duration_ms_total Cumulative request duration in milliseconds.',
    '# TYPE bulka_http_request_duration_ms_total counter',
    `bulka_http_request_duration_ms_total ${snapshot.durationMs.toFixed(3)}`,
    '# HELP bulka_process_uptime_seconds Process uptime in seconds.',
    '# TYPE bulka_process_uptime_seconds gauge',
    `bulka_process_uptime_seconds ${snapshot.uptimeSeconds}`,
    '',
  ].join('\n');
};

module.exports = {
  metricsSnapshot,
  renderPrometheusMetrics,
  requestContextMiddleware,
  requestLoggingMiddleware,
  safeErrorResponseMiddleware,
};

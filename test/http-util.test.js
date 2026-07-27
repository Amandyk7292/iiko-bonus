const assert = require('node:assert/strict');
const test = require('node:test');

const { safeErrorResponseMiddleware } = require('../src/middlewares/observability.middleware');
const { badRequest } = require('../src/utils/app-error.util');
const { sendApiError } = require('../src/utils/http.util');

const responseDouble = (req) => ({
  req,
  statusCode: 200,
  body: null,
  status(value) {
    this.statusCode = value;
    return this;
  },
  json(value) {
    this.body = value;
    return this;
  },
});

test('sendApiError never exposes internal diagnostics and returns request ID', () => {
  const req = {
    id: 'request-api-error-500',
    method: 'POST',
    path: '/api/private-operation',
    log: { error() {}, warn() {} },
  };
  const res = responseDouble(req);
  safeErrorResponseMiddleware(req, res, () => {});

  sendApiError(res, Object.assign(new Error('database password was rejected'), {
    code: 'DATABASE_FAILURE',
  }), {
    success: false,
    details: 'private diagnostics',
  });

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    error: 'Internal Server Error',
    code: 'DATABASE_FAILURE',
    requestId: 'request-api-error-500',
  });
});

test('sendApiError preserves an explicitly public 4xx message', () => {
  const req = {
    id: 'request-api-error-400',
    method: 'POST',
    path: '/api/example',
    log: { error() {}, warn() {} },
  };
  const res = responseDouble(req);
  safeErrorResponseMiddleware(req, res, () => {});

  sendApiError(res, badRequest('INVALID_INPUT', 'Проверьте заполненные поля'), {
    success: false,
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    success: false,
    error: 'Проверьте заполненные поля',
    code: 'INVALID_INPUT',
    requestId: 'request-api-error-400',
  });
});

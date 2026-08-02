const assert = require('node:assert/strict');
const test = require('node:test');

const {
  requestContextMiddleware,
  safeErrorResponseMiddleware,
} = require('../src/middlewares/observability.middleware');

const responseDouble = () => ({
  headers: {},
  statusCode: 500,
  body: null,
  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value;
  },
  json(value) {
    this.body = value;
    return this;
  },
});

test('request context accepts only bounded request IDs and always returns one', () => {
  const acceptedResponse = responseDouble();
  const acceptedRequest = {
    headers: { 'x-request-id': 'client-request-1234' },
  };
  requestContextMiddleware(acceptedRequest, acceptedResponse, () => {});
  assert.equal(acceptedRequest.id, 'client-request-1234');
  assert.equal(acceptedResponse.headers['x-request-id'], 'client-request-1234');

  const generatedResponse = responseDouble();
  const generatedRequest = { headers: { 'x-request-id': 'bad id with spaces' } };
  requestContextMiddleware(generatedRequest, generatedResponse, () => {});
  assert.match(generatedRequest.id, /^[0-9a-f-]{36}$/);
  assert.equal(generatedResponse.headers['x-request-id'], generatedRequest.id);
});

test('error guard strips Supabase/SDK secrets from 500 JSON and adds request ID', () => {
  const privateDatabaseUrl = [
    'postgres',
    '://',
    'internal-user',
    ':',
    'internal-password',
    '@database.example/private',
  ].join('');
  const req = {
    id: 'request-guard-1234',
    path: '/api/example',
    log: { error() {} },
  };
  const res = responseDouble();
  safeErrorResponseMiddleware(req, res, () => {});
  res.json({
    error: 'SupabaseError: relation private_table does not exist',
    details: 'service_role JWT secret=super-private-sdk-token',
    message: privateDatabaseUrl,
    success: false,
  });

  assert.deepEqual(res.body, {
    success: false,
    error: 'Не удалось выполнить действие. Повторите попытку.',
    code: 'INTERNAL_ERROR',
    requestId: 'request-guard-1234',
  });
});

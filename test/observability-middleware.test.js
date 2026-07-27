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

test('error guard strips internal 500 details in every runtime and adds request ID', () => {
  const req = {
    id: 'request-guard-1234',
    path: '/api/example',
    log: { error() {} },
  };
  const res = responseDouble();
  safeErrorResponseMiddleware(req, res, () => {});
  res.json({
    error: 'relation private_table does not exist',
    details: 'sensitive database diagnostics',
    message: 'connection string contained a secret',
    success: false,
  });

  assert.deepEqual(res.body, {
    error: 'Internal Server Error',
    code: 'INTERNAL_ERROR',
    requestId: 'request-guard-1234',
  });
});

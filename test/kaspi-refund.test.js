const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const kaspiModulePath = require.resolve('../src/services/kaspi.service');

test('Kaspi refund sends the stored operation and exact order amount', async (t) => {
  let received;
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsedBody = JSON.parse(body);
      received = {
        path: req.url,
        authorization: req.headers.authorization,
        body: parsedBody,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          parsedBody.returnAmount === 1
            ? {}
            : parsedBody.returnAmount === 2
              ? {
                  error: 'Kaspi Pay требует повторного входа администратора.',
                  code: 'KASPI_REAUTH_REQUIRED',
                  retryable: false,
                }
            : { StatusCode: 0, Data: { ReturnOperationId: 987654 } },
        ),
      );
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const previousUrl = process.env.KASPI_MICROSERVICE_URL;
  const previousSecret = process.env.KASPI_INTERNAL_SECRET;
  process.env.KASPI_MICROSERVICE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.KASPI_INTERNAL_SECRET = 'r'.repeat(32);
  delete require.cache[kaspiModulePath];
  t.after(() => {
    delete require.cache[kaspiModulePath];
    if (previousUrl === undefined) delete process.env.KASPI_MICROSERVICE_URL;
    else process.env.KASPI_MICROSERVICE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.KASPI_INTERNAL_SECRET;
    else process.env.KASPI_INTERNAL_SECRET = previousSecret;
  });

  const { KaspiService } = require('../src/services/kaspi.service');
  const result = await new KaspiService().refundPayment('123456', 2500);

  assert.equal(result.reference, '987654');
  assert.deepEqual(received, {
    path: '/api/refund/create',
    authorization: `Bearer ${'r'.repeat(32)}`,
    body: { qrOperationId: '123456', returnAmount: 2500 },
  });
  await assert.rejects(
    () => new KaspiService().refundPayment('123456', 1),
    (error) => error.code === 'KASPI_REFUND_UNKNOWN' && error.refundUncertain === true,
  );
  await assert.rejects(
    () => new KaspiService().refundPayment('123456', 2),
    (error) => error.code === 'KASPI_REAUTH_REQUIRED' && error.retryable === false,
  );
});

test('Kaspi refund rejects non-success response and invalid identifiers', async () => {
  const { KaspiService, isKaspiSuccess } = require('../src/services/kaspi.service');
  const service = new KaspiService();

  assert.equal(isKaspiSuccess({ StatusCode: 0, ResultCode: '0' }), true);
  assert.equal(isKaspiSuccess({ StatusCode: 0, ResultCode: 5 }), false);
  assert.equal(isKaspiSuccess({}), false);
  await assert.rejects(
    () => service.refundPayment('not-an-operation', 2500),
    (error) => error.code === 'KASPI_REFUND_INVALID_OPERATION',
  );
});

test('refunded order remains visible with refund metadata', () => {
  const { normalizeOrder } = require('../src/services/customer-order.service');
  const normalized = normalizeOrder({
    id: 'order-id',
    order_number: 530383,
    status: 'refunded',
    fulfillment_status: 'cancelled',
    amount: 2500,
    refund_status: 'succeeded',
    refund_amount: 2500,
    refunded_at: '2026-07-13T12:00:00.000Z',
    cart_items: [],
  });

  assert.equal(normalized.paymentStatus, 'refunded');
  assert.equal(normalized.orderStatus, 'cancelled');
  assert.equal(normalized.refundAmount, 2500);
});

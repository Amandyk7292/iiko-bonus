const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const kaspiModulePath = require.resolve('../src/services/kaspi.service');

test('Kaspi refund reconciliation confirms cumulative returns and recognizes a declined reference', async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        path: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(body),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          StatusCode: 0,
          Data: {
            Returns: [
              { Id: 201, Amount: 20, StatusDescription: 'Успешно' },
              { Id: 202, Amount: 30, StatusDescription: 'Успешно' },
              { Id: 203, Amount: 15, StatusDescription: 'Отклонено' },
            ],
          },
        }),
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
  process.env.KASPI_INTERNAL_SECRET = 'h'.repeat(32);
  delete require.cache[kaspiModulePath];
  t.after(() => {
    delete require.cache[kaspiModulePath];
    if (previousUrl === undefined) delete process.env.KASPI_MICROSERVICE_URL;
    else process.env.KASPI_MICROSERVICE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.KASPI_INTERNAL_SECRET;
    else process.env.KASPI_INTERNAL_SECRET = previousSecret;
  });

  const { KaspiService } = require('../src/services/kaspi.service');
  const service = new KaspiService();
  const order = { operation_id: '123456' };

  const confirmed = await service.reconcileRefund(
    order,
    { id: 'refund-id', amount: 30 },
    { knownSucceededAmount: 20 },
  );
  const declined = await service.reconcileRefund(order, {
    id: 'refund-id',
    amount: 15,
    provider_reference: '203',
  });

  assert.deepEqual(confirmed, { status: 'confirmed', reference: '202' });
  assert.equal(declined.status, 'declined');
  assert.equal(declined.reference, '203');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], {
    path: '/api/history/details',
    authorization: `Bearer ${'h'.repeat(32)}`,
    body: { id: '123456', operationMethod: 0 },
  });
});

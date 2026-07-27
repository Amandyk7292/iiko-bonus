const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const kaspiModulePath = require.resolve('../src/services/kaspi.service');

test('revoked Kaspi session returns a safe reauth error without QR fallback', async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    req.resume();
    req.on('end', () => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{}');
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
  process.env.KASPI_INTERNAL_SECRET = 's'.repeat(32);
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
  service.existingRequest = async () => null;

  assert.equal(await service.availability(), false);

  await assert.rejects(
    () =>
      service.createInvoice(
        '77771234567',
        { total: 1000, canonicalItems: [{ name: 'Хлеб', quantity: 1 }] },
        'customer-id',
        { requestId: 'request-id', orderType: 'pickup' },
      ),
    (error) =>
      error.statusCode === 503 &&
      error.code === 'KASPI_REAUTH_REQUIRED' &&
      error.retryable === false &&
      !/логин|пароль/i.test(error.message),
  );
  assert.deepEqual(requests, ['/api/payment/availability', '/api/invoice/create']);
});

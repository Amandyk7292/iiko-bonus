const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
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
  service.claimPaymentCreation = async () => ({ id: 'claim-1', status: 'claimed' });
  service.updatePaymentCreationClaim = async () => undefined;

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

test('database-backed claim prevents concurrent duplicate Kaspi create calls', async (t) => {
  let releaseProvider;
  const providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  let providerRequests = 0;
  let providerRequestReceived;
  const received = new Promise((resolve) => {
    providerRequestReceived = resolve;
  });
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/invoice/create') {
      providerRequests += 1;
      providerRequestReceived();
      await providerGate;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'temporary' }));
      return;
    }
    res.writeHead(404).end();
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
  let claims = 0;
  service.claimPaymentCreation = async () => {
    claims += 1;
    return claims === 1
      ? { id: 'claim-1', status: 'claimed' }
      : { id: 'claim-1', status: 'creating' };
  };
  service.updatePaymentCreationClaim = async () => undefined;
  const args = [
    '77771234567',
    { total: 1000, canonicalItems: [{ id: 'bread', name: 'Хлеб', quantity: 1, price: 1000 }] },
    'customer-id',
    { requestId: '317615f9-b35f-4eb4-9f6d-777f2236bb25', orderType: 'pickup' },
  ];
  const first = service.createInvoice(...args);
  await received;
  await assert.rejects(
    () => service.createInvoice(...args),
    (error) => error.code === 'KASPI_CREATE_IN_PROGRESS',
  );
  assert.equal(providerRequests, 1);
  releaseProvider();
  await assert.rejects(first, (error) => error.code === 'KASPI_CREATE_UNKNOWN');
});

test('ambiguous Kaspi create blocks a fresh checkout id for the same customer', async (t) => {
  let providerRequests = 0;
  const server = http.createServer((req) => {
    if (req.url === '/api/invoice/create') {
      providerRequests += 1;
      req.socket.destroy();
    }
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
  let activeClaim = null;
  service.claimPaymentCreation = async (_customerId, requestId) => {
    if (
      activeClaim &&
      activeClaim.requestId !== requestId &&
      ['creating', 'unknown', 'provider_created'].includes(activeClaim.status)
    ) {
      return {
        id: activeClaim.id,
        status: 'customer_active_unknown',
        blockingRequestId: activeClaim.requestId,
      };
    }
    activeClaim = {
      id: activeClaim?.id || 'claim-ambiguous',
      requestId,
      status: 'creating',
    };
    return { id: activeClaim.id, status: 'claimed' };
  };
  service.updatePaymentCreationClaim = async (_claimId, updates) => {
    Object.assign(activeClaim, updates);
  };

  const pricing = {
    total: 1000,
    canonicalItems: [{ id: 'bread', name: 'Хлеб', quantity: 1, price: 1000 }],
  };
  await assert.rejects(
    () =>
      service.createInvoice('77771234567', pricing, 'customer-id', {
        requestId: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
        orderType: 'pickup',
      }),
    (error) => error.code === 'KASPI_CREATE_UNKNOWN',
  );
  await assert.rejects(
    () =>
      service.createInvoice('77771234567', pricing, 'customer-id', {
        requestId: '417615f9-b35f-4eb4-9f6d-777f2236bb25',
        orderType: 'pickup',
      }),
    (error) => error.code === 'KASPI_CUSTOMER_PAYMENT_UNRESOLVED',
  );
  assert.equal(providerRequests, 1);
});

test('payment claim migration serializes customer creates and bounds unknown guards', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260729150000_payment_creation_legal_consent_key_rotation.sql',
    ),
    'utf8',
  );
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /status', 'customer_active_unknown'/i);
  assert.match(migration, /updated_at\s*>=\s*now\(\)\s*-\s*interval '24 hours'/i);
});

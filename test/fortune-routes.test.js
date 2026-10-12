require('./test-env.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { randomUUID } = require('node:crypto');
const {
  registerFortunePublicRoutes,
  registerFortuneCustomerRoutes,
} = require('../src/routes/public/fortune.routes');
const { registerFortuneAdminRoutes } = require('../src/routes/admin/fortune.routes');
const { adminMutationRoleMiddleware } = require('../src/middlewares/auth.middleware');
const { decodeReceipt } = require('../src/services/fortune-receipt-qr');
const { hash, opaqueToken } = require('../src/services/fortune-common');

const campaignId = randomUUID(),
  branchId = randomUUID(),
  drawId = randomUUID(),
  customerId = randomUUID();
const base = `/api/fortune/${campaignId}/${branchId}`;
async function fixture(t, overrides = {}) {
  const calls = [];
  const service = Object.fromEntries(
    [
      'wheel',
      'receipt',
      'spin',
      'list',
      'claim',
      'redeemBonus',
      'save',
      'winners',
      'qr',
      'redeem',
      'voucher',
    ].map((name) => [
      name,
      async (...args) => {
        calls.push({ name, args });
        return overrides[name] ? overrides[name](...args) : { result: name };
      },
    ]),
  );
  const app = express();
  app.use(express.json());
  // Identity is assigned by the outer authentication layer, as in production.
  app.use('/api/customer', (req, res, next) => {
    if (req.headers.authorization !== 'Bearer signed-customer-fixture')
      return res.status(401).json({ code: 'CUSTOMER_AUTH_REQUIRED' });
    req.customerAuth = { id: customerId };
    next();
  });
  app.use('/admin/api', (req, res, next) => {
    const role = req.headers['x-test-admin-role'];
    if (!role) return res.status(401).json({ code: 'ADMIN_AUTH_REQUIRED' });
    req.admin = { role, username: 'staff-fixture', branchIds: [branchId] };
    adminMutationRoleMiddleware(req, res, next);
  });
  registerFortunePublicRoutes(app, service);
  registerFortuneCustomerRoutes(app, service);
  registerFortuneAdminRoutes(app, service);
  app.use((error, _req, res, _next) =>
    res
      .status(error.statusCode || 500)
      .json({ code: error.code, error: error.message, fields: error.fields }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const request = (path, options = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
  return { request, calls };
}
const json = (value, headers = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(value),
});
const image = (bytes, type = 'image/jpeg') => {
  const data = new FormData();
  data.set('photo', new Blob([bytes], { type }), 'receipt.jpg');
  return data;
};

test('guest cookie is secure and opaque; subsequent proof and spin use the same bound guest hash', async (t) => {
  const { request, calls } = await fixture(t);
  const response = await request(base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /__Host-bulka_fortune=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\//);
  const cookie = setCookie.split(';')[0],
    raw = cookie.split('=')[1],
    token = opaqueToken();
  const uploaded = await request(`${base}/receipt`, {
    method: 'POST',
    headers: { origin: 'https://bulka.com.kz', cookie },
    body: image(Buffer.from('photo')),
  });
  assert.equal(uploaded.status, 200);
  assert.equal(calls.at(-1).args[2], hash(raw));
  assert.equal(calls.at(-1).args[3].toString(), 'photo');
  const spun = await request(
    `${base}/spin`,
    json({ receiptToken: token }, { cookie, origin: 'https://bulka.com.kz' }),
  );
  assert.equal(spun.status, 200);
  assert.deepEqual(calls.at(-1).args, [campaignId, branchId, hash(raw), token]);
  assert.equal(JSON.stringify(await spun.json()).includes(raw), false);
});

test('cross-site receipt uploads and spins are denied before provider or database work', async (t) => {
  const { request, calls } = await fixture(t);
  for (const headers of [
    { origin: 'https://evil.test' },
    { origin: 'https://bulka.com.kz', 'sec-fetch-site': 'cross-site' },
  ]) {
    const upload = await request(`${base}/receipt`, {
      method: 'POST',
      headers,
      body: image(Buffer.from('x')),
    });
    assert.equal(upload.status, 403);
    assert.equal((await upload.json()).code, 'FORTUNE_FORBIDDEN');
    const spin = await request(`${base}/spin`, json({ receiptToken: opaqueToken() }, headers));
    assert.equal(spin.status, 403);
  }
  assert.equal(calls.length, 0);
});

test('multipart rejects missing/unsupported/oversized photos; mislabeled corrupt JPEG cannot be verified', async (t) => {
  const { request, calls } = await fixture(t, {
    receipt: async (_campaign, _branch, _guest, buffer) => decodeReceipt(buffer),
  });
  for (const body of [
    new FormData(),
    image(Buffer.from('<svg/>'), 'image/svg+xml'),
    image(Buffer.alloc(8 * 1024 * 1024 + 1)),
  ]) {
    const response = await request(`${base}/receipt`, { method: 'POST', body });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'FORTUNE_RECEIPT_INVALID');
  }
  assert.equal(calls.length, 0);
  const corrupt = await request(`${base}/receipt`, {
    method: 'POST',
    body: image(Buffer.from('not a jpeg')),
  });
  assert.equal(corrupt.status, 400);
  assert.equal((await corrupt.json()).code, 'FORTUNE_RECEIPT_IMAGE_INVALID');
  assert.equal(calls.length, 1);
});

test('strict URL and token contracts reject malformed values and private control fields', async (t) => {
  const { request, calls } = await fixture(t);
  assert.equal((await request('/api/fortune/not-a-uuid/not-a-uuid')).status, 400);
  assert.equal((await request(`${base}/spin`, json({ receiptToken: 'invalid' }))).status, 400);
  assert.equal(
    (
      await request(
        `${base}/spin`,
        json({ receiptToken: opaqueToken(), p_random: 0, prizeId: drawId }),
      )
    ).status,
    400,
  );
  assert.equal(calls.length, 0);
});

test('customer claim/redemption use authenticated identity and reject body identity spoofing', async (t) => {
  const { request, calls } = await fixture(t),
    auth = { authorization: 'Bearer signed-customer-fixture' },
    token = opaqueToken();
  assert.equal((await request('/api/customer/fortune/prizes')).status, 401);
  assert.equal(
    (
      await request(
        '/api/customer/fortune/claim',
        json({ claimToken: token, customerId: randomUUID() }, auth),
      )
    ).status,
    400,
  );
  assert.equal(
    (await request('/api/customer/fortune/claim', json({ claimToken: token }, auth))).status,
    200,
  );
  assert.deepEqual(calls.at(-1).args, [customerId, token]);
  assert.equal(
    (
      await request(
        `/api/customer/fortune/prizes/${drawId}/redeem`,
        json({ customerId: randomUUID() }, auth),
      )
    ).status,
    400,
  );
  assert.equal(
    (await request(`/api/customer/fortune/prizes/${drawId}/redeem`, json({}, auth))).status,
    200,
  );
  assert.deepEqual(calls.at(-1).args, [customerId, drawId]);
});

test('staff RBAC permits only voucher lookup and gift issue, never wheel configuration or winner history', async (t) => {
  const { request, calls } = await fixture(t);
  assert.equal((await request('/admin/api/fortune')).status, 401);
  for (const role of ['cashier', 'branch_manager']) {
    const headers = { 'x-test-admin-role': role };
    assert.equal((await request('/admin/api/fortune', { headers })).status, 403);
    assert.equal(
      (await request(`/admin/api/fortune/campaigns/${campaignId}/winners`, { headers })).status,
      403,
    );
    assert.equal((await request('/admin/api/fortune/campaigns', json({}, headers))).status, 403);
    assert.equal((await request(`/admin/api/fortune/vouchers/${drawId}`, { headers })).status, 200);
    assert.equal(calls.at(-1).args[0].role, role);
    assert.equal(
      (await request(`/admin/api/fortune/winners/${drawId}/redeem`, json({}, headers))).status,
      200,
    );
    assert.equal(calls.at(-1).args[0].role, role);
  }
  for (const role of ['viewer', 'marketer', 'operator', 'employee']) {
    const headers = { 'x-test-admin-role': role };
    assert.equal((await request(`/admin/api/fortune/vouchers/${drawId}`, { headers })).status, 403);
    assert.equal(
      (await request(`/admin/api/fortune/winners/${drawId}/redeem`, json({}, headers))).status,
      403,
    );
  }
  assert.equal(
    (await request('/admin/api/fortune', { headers: { 'x-test-admin-role': 'owner' } })).status,
    200,
  );
});

test('admin save requires revision and validated probabilities; redeemed requests reject arbitrary fields', async (t) => {
  const { request, calls } = await fixture(t),
    headers = { 'x-test-admin-role': 'admin' };
  const prize = (kind, weight) => ({
    label: kind,
    color: '#ffbf28',
    kind,
    bonusAmount: null,
    weight,
    stockLimit: null,
    validityDays: 7,
    active: true,
  });
  const campaign = {
    title: 'Подарки',
    status: 'active',
    branchIds: [branchId],
    startsAt: null,
    endsAt: null,
    minReceiptAmount: 100,
    maxReceiptAgeHours: 24,
    prizes: [prize('gift', 90), prize('none', 10)],
  };
  const patch = (body) =>
    request(`/admin/api/fortune/campaigns/${campaignId}`, {
      ...json(body, headers),
      method: 'PATCH',
    });
  assert.equal((await patch(campaign)).status, 400);
  const wrongWeight = {
    ...campaign,
    expectedVersion: 2,
    prizes: [prize('gift', 80), prize('none', 10)],
  };
  assert.equal((await patch(wrongWeight)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await patch({ ...campaign, expectedVersion: 2 })).status, 200);
  assert.equal(calls.at(-1).args[2].expectedVersion, 2);
  assert.equal(
    (
      await request(
        `/admin/api/fortune/winners/${drawId}/redeem`,
        json({ branchIds: [], customerId }, headers),
      )
    ).status,
    400,
  );
});

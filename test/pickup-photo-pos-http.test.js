const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const sharp = require('sharp');
const contract = require('../src/contracts/pickup-photo-gift.contract');

// iiko SDK .NET Guid: the version/variant bits are not an RFC UUID.
const terminalId = '9b5efb9d-2c17-376e-01a0-4284aa5509be';

function stub(t, path, exports) {
  const id = require.resolve(path),
    previous = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  });
}

function router(t, branchId, services) {
  stub(t, '../src/middlewares/rate-limit.middleware', {
    webhookRateLimit: (_req, _res, next) => next(),
  });
  stub(t, '../src/middlewares/pos-transport.middleware', {
    posTransportMiddleware: (req, res, next) => {
      if (req.headers.authorization !== 'Bearer test-paired-device')
        return res.status(401).json({ success: false, code: 'POS_DEVICE_UNAUTHORIZED' });
      req.pairedPos = { terminal_id: terminalId, branch_id: branchId };
      return next();
    },
  });
  stub(t, '../src/middlewares/branch-pos-auth.middleware', {
    branchPosAuthMiddleware: (req, _res, next) => {
      req.posBranchId = req.pairedPos.branch_id;
      return next();
    },
  });
  stub(t, '../src/services/pickup-photo-gift.service', services);
  const id = require.resolve('../src/routes/pickup-photo-gift.routes'),
    previous = require.cache[id];
  delete require.cache[id];
  t.after(() => {
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  });
  return require('../src/routes/pickup-photo-gift.routes');
}

test('photo POS HTTP routes accept SDK GUIDs without weakening paired terminal or request gates', async (t) => {
  const branchId = crypto.randomUUID(),
    orderId = crypto.randomUUID(),
    photoId = crypto.randomUUID(),
    calls = [];
  const image = await sharp({
    create: { width: 384, height: 1, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  const app = express();
  app.use(express.json());
  app.use(
    router(t, branchId, {
      listPrintJobs: async (branch, body) => {
        calls.push(['poll', branch, body]);
        return { jobs: [{ orderId, photoId, number: 123456, status: 'pending' }] };
      },
      printAction: async (branch, body) => {
        calls.push(['action', branch, body]);
        return { status: 'print', number: 123456, photoId };
      },
      printImage: async (...args) => {
        calls.push(['image', ...args]);
        return image;
      },
    }),
  );
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ success: false, code: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/loyalty/orders/photo-gifts`;
  const headers = {
    authorization: 'Bearer test-paired-device',
    'content-type': 'application/json',
  };
  const post = (endpoint, body, auth = headers) =>
    fetch(`${base}/${endpoint}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  const pollBody = { terminalId: terminalId.toUpperCase(), photoGiftVersion: 1 };
  const poll = await post('poll', pollBody);
  assert.equal(poll.status, 200);
  assert.deepEqual(await poll.json(), {
    success: true,
    jobs: [{ orderId, photoId, number: 123456, status: 'pending' }],
  });
  const actionBody = { terminalId, orderId, action: 'claim' };
  assert.equal((await post('action', actionBody)).status, 200);
  const printedImage = await fetch(
    `${base}/${orderId}/image?terminalId=${terminalId}&widthDots=384`,
    { headers },
  );
  assert.equal(printedImage.status, 200);
  assert.match(printedImage.headers.get('cache-control'), /private.*no-store/);
  assert.match(printedImage.headers.get('content-type'), /^image\/png/);
  assert.equal(
    printedImage.headers.get('x-content-sha256'),
    crypto.createHash('sha256').update(image).digest('hex'),
  );
  assert.deepEqual(Buffer.from(await printedImage.arrayBuffer()), image);
  assert.deepEqual(calls, [
    ['poll', branchId, { terminalId, photoGiftVersion: 1 }],
    ['action', branchId, actionBody],
    ['image', branchId, orderId, terminalId, 384],
  ]);

  for (const [endpoint, body] of [
    ['poll', pollBody],
    ['action', actionBody],
  ]) {
    assert.equal((await post(endpoint, body, { 'content-type': 'application/json' })).status, 401);
    assert.equal((await post(endpoint, { ...body, terminalId: crypto.randomUUID() })).status, 403);
    assert.equal((await post(endpoint, { ...body, terminalId: 'not-a-guid' })).status, 400);
    assert.equal((await post(endpoint, { ...body, branchId: crypto.randomUUID() })).status, 400);
  }
  for (const photoGiftVersion of [0, 2])
    assert.equal((await post('poll', { ...pollBody, photoGiftVersion })).status, 400);
  assert.equal((await post('action', { ...actionBody, orderId: terminalId })).status, 400);
  assert.equal((await fetch(`${base}/${orderId}/image?terminalId=${terminalId}`)).status, 401);
  assert.equal(
    (await fetch(`${base}/${orderId}/image?terminalId=${crypto.randomUUID()}`, { headers })).status,
    403,
  );
  for (const suffix of [
    `${terminalId}/image?terminalId=${terminalId}`,
    `${orderId}/image?terminalId=not-a-guid`,
    `${orderId}/image?terminalId=${terminalId}&widthDots=2000`,
  ])
    assert.equal((await fetch(`${base}/${suffix}`, { headers })).status, 400);
  assert.equal(calls.length, 3, 'rejected requests never reach photo storage or printing');
});

test('only SDK terminal identity accepts non-RFC GUIDs; customer and order identities remain UUIDs', () => {
  assert.equal(
    contract.pickupPhotoPollSchema.safeParse({ terminalId, photoGiftVersion: 1 }).success,
    true,
  );
  for (const schema of [
    contract.pickupPhotoParamsSchema,
    contract.pickupPhotoCapabilitySchema,
    contract.pickupPhotoPrintParamsSchema,
  ]) {
    const field = Object.keys(schema.shape)[0];
    assert.equal(schema.safeParse({ [field]: crypto.randomUUID() }).success, true);
    assert.equal(schema.safeParse({ [field]: terminalId }).success, false);
  }
  for (const invalid of [
    terminalId.replaceAll('-', ''),
    `{${terminalId}}`,
    `${terminalId}extra`,
    'https://example.com/terminal',
  ])
    assert.equal(
      contract.pickupPhotoPollSchema.safeParse({ terminalId: invalid, photoGiftVersion: 1 })
        .success,
      false,
    );
});

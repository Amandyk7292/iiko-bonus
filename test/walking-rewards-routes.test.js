const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('node:crypto');
const owner = { id: crypto.randomUUID(), phone: '+77001234567', deleted_at: null };
const configPath = require.resolve('../src/config/supabase');
const servicePath = require.resolve('../src/services/walking-rewards.service');
const calls = [];
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: {
    supabase: {
      from(table) {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return { data: table === 'customers' ? owner : null, error: null };
          },
        };
      },
    },
  },
};
require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: Object.fromEntries(
    ['walkingStatus', 'createWalkingChallenge', 'registerWalkingDevice', 'syncWalkingSteps'].map(
      (name) => [
        name,
        async (id, body) => {
          calls.push({ name, id, body });
          return { accepted: true };
        },
      ],
    ),
  ),
};
const { customerAuthMiddleware } = require('../src/middlewares/customer-auth.middleware');
const { signCustomerToken } = require('../src/services/auth.service');
const { registerWalkingRewardRoutes } = require('../src/routes/customer/walking-rewards.routes');
test('all walking endpoints require a customer session, bind the account and reject raw manual counts', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/customer', customerAuthMiddleware);
  registerWalkingRewardRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/customer/walking`;
  for (const suffix of ['', '/challenge', '/device', '/sync']) {
    const response = await fetch(base + suffix, {
      method: suffix ? 'POST' : 'GET',
      ...(suffix ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
    });
    assert.equal(response.status, 401);
  }
  assert.equal(calls.length, 0);
  const headers = {
    Authorization: `Bearer ${signCustomerToken(owner)}`,
    'Content-Type': 'application/json',
  };
  const response = await fetch(base, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(calls[0].id, owner.id);
  const identity = {
    deviceId: 'a'.repeat(64),
    keyId: crypto.randomBytes(32).toString('base64'),
    purpose: 'steps',
  };
  assert.equal(
    (await fetch(base + '/challenge', { method: 'POST', headers, body: JSON.stringify(identity) }))
      .status,
    200,
  );
  assert.equal(calls[1].id, owner.id);
  for (const body of [
    { ...identity, customerId: crypto.randomUUID() },
    { ...identity, dayOffset: 7 },
  ]) {
    assert.equal(
      (await fetch(base + '/challenge', { method: 'POST', headers, body: JSON.stringify(body) }))
        .status,
      400,
    );
  }
  assert.equal(
    (
      await fetch(base + '/sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({ steps: 10000, source: 'manual' }),
      })
    ).status,
    400,
  );
  assert.equal(calls.length, 2);
  const android = { ...identity, platform: 'android', dayOffsets: [0, 1] };
  const batch = await fetch(base + '/challenge', {
    method: 'POST',
    headers,
    body: JSON.stringify(android),
  });
  assert.equal(batch.status, 200);
  assert.equal(calls[2].id, owner.id);
  assert.equal(calls[2].body.platform, 'android');
  assert.deepEqual(calls[2].body.dayOffsets, [0, 1]);
  const opaqueProof = 'opaque-integrity.token_with-url-safe.characters';
  for (const [suffix, body] of [
    [
      '/device',
      {
        deviceId: identity.deviceId,
        keyId: identity.keyId,
        platform: 'android',
        challenge: 'x'.repeat(40),
        attestation: opaqueProof,
      },
    ],
    [
      '/sync',
      {
        deviceId: identity.deviceId,
        keyId: identity.keyId,
        platform: 'android',
        challenge: 'x'.repeat(40),
        payload: JSON.stringify({ source: 'android_local_recording', measurements: [] }),
        assertion: opaqueProof,
      },
    ],
  ]) {
    const accepted = await fetch(base + suffix, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(calls.at(-1).id, owner.id);
  }
  for (const patch of [
    { dayOffsets: [0, 0] },
    { dayOffsets: [7] },
    { steps: 10000 },
    { customerId: crypto.randomUUID() },
  ])
    assert.equal(
      (
        await fetch(base + '/challenge', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...android, ...patch }),
        })
      ).status,
      400,
    );
  assert.equal(calls.length, 5);
});

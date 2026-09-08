/* global require, process, console, queueMicrotask */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { generateKeyPairSync } = require('node:crypto');
const http2 = require('node:http2');
const test = require('node:test');

const privateKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
  format: 'pem',
  type: 'pkcs8',
});

function fixture(t, { status = 200, reason, noResponse = false } = {}) {
  const env = { ...process.env };
  Object.assign(process.env, {
    APPLE_APNS_TEAM_ID: 'team',
    APPLE_APNS_KEY_ID: 'key',
    APPLE_APNS_PRIVATE_KEY: privateKey,
    APPLE_APNS_BUNDLE_ID: 'com.bulka.bonus',
  });
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  });
  t.mock.method(console, 'warn', () => {});
  const sent = [];
  const updates = [];
  let destroyed = false;
  t.mock.method(http2, 'connect', (host) => {
    const client = new EventEmitter();
    client.destroy = () => {
      destroyed = true;
      client.emit('close');
    };
    client.request = (headers) => {
      const request = new EventEmitter();
      request.setEncoding = () => {};
      request.close = () => {};
      request.end = (body) => {
        sent.push({ host, headers, payload: JSON.parse(body) });
        if (noResponse) return;
        queueMicrotask(() => {
          request.emit('response', { ':status': status });
          if (reason) request.emit('data', JSON.stringify({ reason }));
          request.emit('end');
        });
      };
      return request;
    };
    return client;
  });
  const order = {
    id: 'order',
    status: 'paid',
    fulfillment_status: 'preparing',
    promised_ready_at: '2026-09-08T16:00:00Z',
  };
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/live-activity.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      supabase: {
        from() {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            upsert() {
              return this;
            },
            update(data) {
              updates.push(data);
              return this;
            },
            maybeSingle: async () => ({ data: order }),
            single: async () => ({ data: { active: true } }),
            then(resolve) {
              return Promise.resolve({
                data: [{ id: 'token', push_token: 'a'.repeat(64), environment: 'sandbox' }],
              }).then(resolve);
            },
          };
        },
      },
    },
  };
  delete require.cache[servicePath];
  return { service: require(servicePath), order, sent, updates, destroyed: () => destroyed };
}

test('late activity registration receives the current kitchen status and ETA', async (t) => {
  const { service, sent, destroyed } = fixture(t);
  await service.registerLiveActivityToken('customer', {
    activityId: 'activity',
    installationId: 'phone',
    orderId: 'order',
    pushToken: 'a'.repeat(64),
    environment: 'sandbox',
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].host, 'https://api.sandbox.push.apple.com');
  assert.equal(sent[0].headers['apns-push-type'], 'liveactivity');
  assert.equal(sent[0].headers['apns-topic'], 'com.bulka.bonus.push-type.liveactivity');
  assert.equal(sent[0].headers['apns-priority'], '10');
  assert.equal(sent[0].payload.aps['content-state'].orderStatus, 'preparing');
  assert.equal(sent[0].payload.aps['content-state'].etaTimestamp, 1788883200);
  assert.equal(destroyed(), true);
});

for (const reason of ['BadPayload', 'BadDeviceToken']) {
  test(`APNs ${reason} only retires an invalid token`, async (t) => {
    const { service, order, updates } = fixture(t, { status: 400, reason });
    const result = await service.sendOrderLiveActivity(order);
    assert.equal(result.failed, 1);
    assert.equal(updates.length, reason === 'BadDeviceToken' ? 1 : 0);
  });
}

test('a failed terminal push stays retryable', async (t) => {
  const { service, order, updates } = fixture(t, { status: 503, reason: 'ServiceUnavailable' });
  await service.sendOrderLiveActivity(order, { end: true });
  assert.equal(updates.length, 0);
});

test('APNs transport timeout closes the connection without hanging status changes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { service, destroyed } = fixture(t, { noResponse: true });
  const request = service.sendApnsRequest({
    token: 'a'.repeat(64),
    environment: 'sandbox',
    payload: {},
    config: service.apnsConfiguration(),
  });
  t.mock.timers.tick(10000);
  assert.deepEqual(await request, { ok: false, error: 'apns_timeout' });
  assert.equal(destroyed(), true);
});

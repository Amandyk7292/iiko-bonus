const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const jwt = require('jsonwebtoken');
const configPath = require.resolve('../src/config/supabase');
const supabase = {};
const diagnostics = [];
const loggerPath = require.resolve('../src/config/logger');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: { logger: { warn: (fields, message) => diagnostics.push({ fields, message }) } },
};
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: { supabase },
};
const {
  stableDeviceHash,
  createDeviceChallenge,
  verifyChallenge,
  checkAndroidVerdict,
  verifyDeviceProof,
} = require('../src/services/referral-device-proof.service');
const { referralDeviceBodySchema } = require('../src/contracts/referral-device.contract');
const android = { kind: 'android_id', id: 'abcdef0123456789' };
const ios = { kind: 'ios_keychain', id: 'a'.repeat(64) };

test('proof is bound to the authenticated account, device, installation, audience and expiry', () => {
  const id = randomUUID(),
    { challenge, nonce } = createDeviceChallenge(id, android, 'installation-1');
  assert.equal(verifyChallenge(id, android, 'installation-1', { challenge }).nonce, nonce);
  assert.notEqual(createDeviceChallenge(id, android, 'installation-1').nonce, nonce);
  assert.match(stableDeviceHash(android), /^[a-f0-9]{64}$/);
  for (const [customer, device, installation, token] of [
    [randomUUID(), android, 'installation-1', challenge],
    [id, { ...android, id: '1111111111111111' }, 'installation-1', challenge],
    [id, android, 'installation-2', challenge],
    [id, android, null, challenge],
    [id, android, 'installation-1', challenge.slice(0, -6) + 'broken'],
    [
      id,
      android,
      'installation-1',
      jwt.sign({ deviceHash: stableDeviceHash(android) }, process.env.CUSTOMER_JWT_SECRET, {
        expiresIn: -1,
        subject: id,
        audience: 'bulka-referral-device',
        issuer: 'bulka',
      }),
    ],
  ])
    assert.throws(() => verifyChallenge(customer, device, installation, { challenge: token }), {
      statusCode: 409,
    });
});

test('Android rejects forged app, replayed nonce, stale or uncertified device and sideloaded install', () => {
  const now = Date.now(),
    nonce = 'test-nonce';
  const valid = {
    requestDetails: { requestPackageName: 'com.bulka.bonus', nonce, timestampMillis: String(now) },
    appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: 'com.bulka.bonus' },
    deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    accountDetails: { appLicensingVerdict: 'LICENSED' },
  };
  checkAndroidVerdict(valid, nonce, now);
  for (const patch of [
    { requestDetails: { ...valid.requestDetails, nonce: 'replay' } },
    { requestDetails: { ...valid.requestDetails, requestPackageName: 'fake.app' } },
    { requestDetails: { ...valid.requestDetails, timestampMillis: now - 300001 } },
    { requestDetails: { ...valid.requestDetails, timestampMillis: now + 30001 } },
    { appIntegrity: { ...valid.appIntegrity, appRecognitionVerdict: 'UNRECOGNIZED_VERSION' } },
    { deviceIntegrity: { deviceRecognitionVerdict: [] } },
    { deviceIntegrity: { deviceRecognitionVerdict: 'MEETS_DEVICE_INTEGRITY' } },
    { accountDetails: { appLicensingVerdict: 'UNLICENSED' } },
  ])
    assert.throws(() => checkAndroidVerdict({ ...valid, ...patch }, nonce, now), {
      statusCode: 409,
    });
  assert.throws(() => checkAndroidVerdict(null, nonce, now), { statusCode: 409 });
});

test('client cannot submit unrestricted IDs, owner identity or eligibility in a proof request', () => {
  assert.equal(referralDeviceBodySchema.safeParse({ referralDevice: android }).success, true);
  for (const body of [
    { customerId: randomUUID(), referralDevice: android },
    { referralDevice: { ...android, id: randomUUID() } },
    { referralDevice: { kind: 'installation', id: 'a'.repeat(64) } },
    { referralDevice: ios, eligible: true },
  ]) {
    assert.equal(referralDeviceBodySchema.safeParse(body).success, false);
  }
});

test('Apple persistent claim rejects a new Keychain identity and reserves legitimate retry ownership', async () => {
  const previousFetch = global.fetch,
    previousEnv = { ...process.env };
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  process.env.APPLE_DEVICECHECK_TEAM_ID = 'TESTTEAM';
  process.env.APPLE_DEVICECHECK_KEY_ID = 'TESTKEY';
  process.env.APPLE_DEVICECHECK_PRIVATE_KEY = key;
  const id = randomUUID();
  let owner = null,
    bits = { bit0: true, bit1: true },
    writes = [],
    calls = [],
    used = false;
  supabase.from = (table) => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async maybeSingle() {
      return {
        data:
          table === 'referral_device_proofs'
            ? used
              ? {}
              : null
            : table === 'referral_stable_device_owners'
              ? owner
              : null,
      };
    },
    async upsert(value) {
      writes.push(value);
      return { error: null };
    },
  });
  global.fetch = async (url, request) => {
    calls.push({ url, body: JSON.parse(request.body) });
    return {
      ok: true,
      async text() {
        return typeof bits === 'string' ? bits : JSON.stringify(bits);
      },
    };
  };
  const check = () =>
    verifyDeviceProof(id, ios, 'installation-1', {
      challenge: createDeviceChallenge(id, ios, 'installation-1').challenge,
      token: 'device-token-123456789',
    });
  try {
    assert.equal((await check()).blocked, true);
    assert.equal(writes.length, 0);
    assert.equal(calls.length, 1, 'must not clear or overwrite the previous Apple claim');
    for (const sentinel of ['Bit State Not Found', 'Failed to find bit state']) {
      calls = [];
      diagnostics.length = 0;
      bits = sentinel;
      assert.equal((await check()).blocked, false);
      assert.equal(writes.at(-1).customer_id, id);
      assert.equal(calls[1].body.bit0, true);
      assert.equal(calls[1].body.bit1, false);
      assert.equal(diagnostics.length, 0, 'an Apple success is not a verification failure');
    }
    calls = [];
    owner = { customer_id: id };
    bits = { bit0: true, bit1: true };
    assert.equal((await check()).blocked, false);
    assert.equal(calls[1].body.bit1, true, 'preserve the other Apple bit');
    used = true;
    await assert.rejects(check(), { statusCode: 409 });
    used = false;
    global.fetch = async () => {
      throw new Error('raw internal network details');
    };
    await assert.rejects(
      check(),
      (error) => error.statusCode === 503 && !error.message.includes('raw internal'),
    );
    delete process.env.APPLE_DEVICECHECK_PRIVATE_KEY;
    await assert.rejects(check(), { statusCode: 503 });
  } finally {
    global.fetch = previousFetch;
    for (const name of [
      'APPLE_DEVICECHECK_TEAM_ID',
      'APPLE_DEVICECHECK_KEY_ID',
      'APPLE_DEVICECHECK_PRIVATE_KEY',
    ]) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  }
});

test('Apple failures report only safe stages and known reasons without tokens, keys or raw responses', async (t) => {
  const previousFetch = global.fetch;
  const previousFrom = supabase.from;
  const names = [
    'APPLE_DEVICECHECK_TEAM_ID',
    'APPLE_DEVICECHECK_KEY_ID',
    'APPLE_DEVICECHECK_PRIVATE_KEY',
  ];
  const previousEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  process.env.APPLE_DEVICECHECK_TEAM_ID = 'TESTTEAM';
  process.env.APPLE_DEVICECHECK_KEY_ID = 'TESTKEY';
  process.env.APPLE_DEVICECHECK_PRIVATE_KEY = key;
  t.after(() => {
    global.fetch = previousFetch;
    supabase.from = previousFrom;
    for (const name of names) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  });
  supabase.from = () => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async maybeSingle() {
      return { data: null, error: null };
    },
    async upsert() {
      assert.fail('an Apple verification failure must not reserve a referral owner');
    },
  });
  const customerId = randomUUID();
  const deviceToken = 'private-native-device-token';
  const proof = {
    challenge: createDeviceChallenge(customerId, ios, null).challenge,
    token: deviceToken,
  };
  for (const [status, body, stage, reason] of [
    [401, 'Unable to verify authorization token', 'http', 'authorization_invalid'],
    [401, 'Bit State Not Found', 'http', 'unrecognized_response'],
    [404, 'Failed to find bit state', 'http', 'unrecognized_response'],
    [400, 'Bad Device Token', 'http', 'device_token_malformed'],
    [429, 'Too Many Requests', 'http', 'rate_limited'],
    [403, `unknown raw body: ${deviceToken}; ${proof.challenge}`, 'http', 'unrecognized_response'],
    [200, `unknown raw body: ${deviceToken}`, 'response', 'response_not_json'],
    [200, '{"bit0":true}', 'response', 'response_invalid_bits'],
  ]) {
    diagnostics.length = 0;
    global.fetch = async () => ({
      status,
      ok: status === 200,
      async text() {
        return body;
      },
    });
    await assert.rejects(verifyDeviceProof(customerId, ios, null, proof), { statusCode: 503 });
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(diagnostics[0].fields, {
      event: 'referral_apple_devicecheck_failed',
      action: 'query_two_bits',
      stage,
      reason,
      providerStatus: status,
    });
    const logged = JSON.stringify(diagnostics);
    for (const secret of [deviceToken, proof.challenge, customerId, ios.id, key, 'unknown raw']) {
      assert.equal(logged.includes(secret), false, `must not log ${secret.slice(0, 12)}`);
    }
  }
  for (const [error, reason] of [
    [new Error(`network error carrying ${deviceToken}`), 'transport_failed'],
    [Object.assign(new Error(deviceToken), { name: 'TimeoutError' }), 'transport_timeout'],
  ]) {
    diagnostics.length = 0;
    global.fetch = async () => {
      throw error;
    };
    await assert.rejects(verifyDeviceProof(customerId, ios, null, proof), { statusCode: 503 });
    assert.equal(diagnostics[0].fields.stage, 'request');
    assert.equal(diagnostics[0].fields.reason, reason);
    assert.equal(diagnostics[0].fields.providerStatus, null);
    assert.equal(JSON.stringify(diagnostics).includes(deviceToken), false);
  }
  diagnostics.length = 0;
  delete process.env.APPLE_DEVICECHECK_PRIVATE_KEY;
  await assert.rejects(verifyDeviceProof(customerId, ios, null, proof), { statusCode: 503 });
  assert.equal(diagnostics[0].fields.stage, 'authorization');
  assert.equal(diagnostics[0].fields.reason, 'authorization_failed');
});

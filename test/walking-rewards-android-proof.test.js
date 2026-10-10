const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const customer = crypto.randomUUID();
const identity = {
  deviceId: 'a'.repeat(64),
  keyId: crypto.randomBytes(32).toString('base64'),
  platform: 'android',
};
let key, rpcCalls, syncCalls, tokens, rpcError, policy;
const previousCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;
process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
test.after(() => {
  if (previousCredentials === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
  else process.env.FIREBASE_SERVICE_ACCOUNT = previousCredentials;
});
const mockModule = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
mockModule('../src/config/supabase', {
  supabase: {
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        upsert(value, options) {
          assert.deepEqual(options, { onConflict: 'key_id', ignoreDuplicates: true });
          if (!key) key = { ...value, sign_count: 0 };
          return Promise.resolve({ error: null });
        },
        async maybeSingle() {
          return { data: key, error: null };
        },
        async single() {
          return { data: table === 'walking_reward_policy' ? policy : key, error: null };
        },
      };
    },
    async rpc(name, args) {
      assert.equal(name, 'apply_android_walking_steps');
      rpcCalls.push(args);
      return {
        data: {
          days: args.p_measurements.map((day) => ({
            ...day,
            credited: day.steps >= 10000,
            rewardAmount: 100,
            creditedAmount: day.steps >= 10000 ? 100 : 0,
          })),
        },
        error: rpcError,
      };
    },
  },
});
mockModule('../src/services/loyalty-sync.service', {
  queueCustomerLoyaltySync: (id) => syncCalls.push(id),
});
// Exercise the production nonce/package/license/device verdict checks. Only
// Google's network response is replaced; no real credential or token is used.
mockModule('google-auth-library', {
  GoogleAuth: class {
    constructor(options) {
      assert.deepEqual(options.scopes, ['https://www.googleapis.com/auth/playintegrity']);
    }
    async getClient() {
      return {
        request: async ({ url, data, timeout }) => {
          assert.equal(
            url,
            'https://playintegrity.googleapis.com/v1/com.bulka.bonus:decodeIntegrityToken',
          );
          assert.equal(timeout, 15000);
          if (!tokens.has(data.integrity_token)) throw new Error('provider unavailable');
          return { data: { tokenPayloadExternal: tokens.get(data.integrity_token) } };
        },
      };
    }
  },
});
const walking = require('../src/services/walking-rewards.service');
const contracts = require('../src/contracts/walking-rewards.contract');
test.beforeEach(() => {
  key = {
    key_id: identity.keyId,
    device_hash: walking.deviceHash(identity.deviceId),
    public_key: 'play_integrity:com.bulka.bonus',
    sign_count: 0,
    platform: 'android',
  };
  rpcCalls = [];
  syncCalls = [];
  tokens = new Map();
  rpcError = null;
  policy = { enabled: true, starts_on: walking.walkingPeriod(6).date };
});
function integrity(content, patch = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  tokens.set(token, {
    requestDetails: {
      requestPackageName: 'com.bulka.bonus',
      nonce: crypto.createHash('sha256').update(content).digest('base64url'),
      timestampMillis: String(Date.now()),
    },
    appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: 'com.bulka.bonus' },
    deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    accountDetails: { appLicensingVerdict: 'LICENSED' },
    ...patch,
  });
  return token;
}
async function proof(dayOffsets = [0, 1], steps = 10000) {
  const { challenge, periods } = await walking.createWalkingChallenge(customer, {
    ...identity,
    purpose: 'steps',
    dayOffsets,
  });
  const payload = JSON.stringify({
    challenge,
    source: 'android_local_recording',
    measurements: periods.map((day) => ({ ...day, steps })),
  });
  return { ...identity, challenge, payload, assertion: integrity(payload) };
}
test('one integrity token binds a native multi-day measurement; counters come only from the enrolled server key', async () => {
  key.sign_count = 17;
  const body = await proof();
  assert.equal(contracts.walkingSyncSchema.safeParse(body).success, true);
  const result = await walking.syncWalkingSteps(customer, body);
  assert.equal(result.days.length, 2);
  assert.ok(result.days.every((day) => day.rewardAmount === 100 && day.creditedAmount === 100));
  assert.deepEqual(rpcCalls[0], {
    p_customer_id: customer,
    p_key_id: identity.keyId,
    p_previous_counter: 17,
    p_challenge_id: jwt.decode(body.challenge).jti,
    p_measurements: JSON.parse(body.payload).measurements,
  });
  assert.deepEqual(syncCalls, [customer]);
});
test('changed native totals, another token, stale integrity verdicts and unlicensed/unrecognized devices never award', async () => {
  const body = await proof([0], 1);
  const parsed = JSON.parse(body.payload);
  const payload = JSON.stringify({
    ...parsed,
    measurements: parsed.measurements.map((day) => ({ ...day, steps: 10000 })),
  });
  await assert.rejects(walking.syncWalkingSteps(customer, { ...body, payload }), {
    code: 'WALKING_PROOF_INVALID',
  });
  for (const patch of [
    {
      requestDetails: {
        requestPackageName: 'other.package',
        nonce: crypto.createHash('sha256').update(body.payload).digest('base64url'),
        timestampMillis: String(Date.now()),
      },
    },
    {
      requestDetails: {
        requestPackageName: 'com.bulka.bonus',
        nonce: crypto.createHash('sha256').update(body.payload).digest('base64url'),
        timestampMillis: String(Date.now() - 300001),
      },
    },
    {
      appIntegrity: {
        appRecognitionVerdict: 'UNRECOGNIZED_VERSION',
        packageName: 'com.bulka.bonus',
      },
    },
    { accountDetails: { appLicensingVerdict: 'UNLICENSED' } },
    { deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } },
  ])
    await assert.rejects(
      walking.syncWalkingSteps(customer, { ...body, assertion: integrity(body.payload, patch) }),
      { code: 'WALKING_PROOF_INVALID' },
    );
  await assert.rejects(
    walking.syncWalkingSteps(customer, { ...body, assertion: integrity('different measurement') }),
    { code: 'WALKING_PROOF_INVALID' },
  );
  assert.equal(rpcCalls.length, 0);
});
test('account, identity, platform, source, periods and batch order cannot be replaced even with a fresh verdict', async () => {
  const body = await proof();
  await assert.rejects(walking.syncWalkingSteps(crypto.randomUUID(), body), {
    code: 'WALKING_PROOF_INVALID',
  });
  for (const patch of [
    { platform: 'ios' },
    { deviceId: 'b'.repeat(64) },
    { keyId: crypto.randomBytes(32).toString('base64') },
  ])
    await assert.rejects(walking.syncWalkingSteps(customer, { ...body, ...patch }), {
      code: 'WALKING_PROOF_INVALID',
    });
  const parsed = JSON.parse(body.payload);
  for (const changed of [
    { ...parsed, source: 'manual' },
    { ...parsed, measurements: parsed.measurements.slice(0, 1) },
    { ...parsed, measurements: [...parsed.measurements].reverse() },
    { ...parsed, measurements: [parsed.measurements[0], parsed.measurements[0]] },
    { ...parsed, measurements: parsed.measurements.map((day) => ({ ...day, startAt: day.endAt })) },
  ]) {
    const payload = JSON.stringify(changed);
    await assert.rejects(
      walking.syncWalkingSteps(customer, { ...body, payload, assertion: integrity(payload) }),
      { code: 'WALKING_PROOF_INVALID' },
    );
  }
  key.platform = 'ios';
  await assert.rejects(walking.syncWalkingSteps(customer, body), { code: 'WALKING_PROOF_INVALID' });
  assert.equal(rpcCalls.length, 0);
});
test('registration binds a fresh integrity proof to the challenge and never replaces another platform or device', async () => {
  key = null;
  const { challenge } = await walking.createWalkingChallenge(customer, {
    ...identity,
    purpose: 'register',
  });
  const body = { ...identity, challenge, attestation: integrity(challenge) };
  assert.equal(contracts.walkingRegistrationSchema.safeParse(body).success, true);
  await assert.rejects(
    walking.registerWalkingDevice(customer, {
      ...body,
      attestation: integrity('another challenge'),
    }),
    { code: 'WALKING_PROOF_INVALID' },
  );
  assert.equal(key, null);
  assert.deepEqual(await walking.registerWalkingDevice(customer, body), { registered: true });
  assert.equal(key.platform, 'android');
  assert.equal(key.device_hash, walking.deviceHash(identity.deviceId));
  key.platform = 'ios';
  await assert.rejects(walking.registerWalkingDevice(customer, body), {
    code: 'WALKING_PROOF_INVALID',
  });
  await assert.rejects(
    walking.createWalkingChallenge(customer, { ...identity, purpose: 'steps' }),
    { code: 'WALKING_PROOF_INVALID' },
  );
});
test('missing keys, unknown provider result and atomic replay/counter failure fail closed without loyalty sync', async () => {
  const body = await proof();
  key = null;
  await assert.rejects(walking.syncWalkingSteps(customer, body), { code: 'WALKING_KEY_UNKNOWN' });
  key = {
    platform: 'android',
    device_hash: walking.deviceHash(identity.deviceId),
    public_key: 'play_integrity:com.bulka.bonus',
    sign_count: 0,
  };
  await assert.rejects(
    walking.syncWalkingSteps(customer, { ...body, assertion: 'unavailable-token' }),
    { code: 'WALKING_UNAVAILABLE', statusCode: 503 },
  );
  rpcError = { code: 'P0001' };
  await assert.rejects(walking.syncWalkingSteps(customer, body), { code: 'WALKING_PROOF_INVALID' });
  assert.equal(syncCalls.length, 0);
});
test('default batch stays bounded and removes pre-launch periods; schemas reject duplicate days and raw client totals', async () => {
  const response = await walking.createWalkingChallenge(customer, {
    ...identity,
    purpose: 'steps',
  });
  assert.equal(response.periods.length, 7);
  assert.ok(response.challenge.length <= 2500);
  policy.starts_on = walking.walkingPeriod().date;
  assert.equal(
    (await walking.createWalkingChallenge(customer, { ...identity, purpose: 'steps' })).periods
      .length,
    1,
  );
  for (const patch of [
    { dayOffsets: [0, 0] },
    { dayOffsets: [7] },
    { dayOffset: 1 },
    { platform: 'web' },
    { steps: 10000 },
  ])
    assert.equal(
      contracts.walkingChallengeSchema.safeParse({ ...identity, purpose: 'steps', ...patch })
        .success,
      false,
    );
  assert.equal(contracts.walkingSyncSchema.safeParse({ ...identity, steps: 10000 }).success, false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const cbor = require('cbor');
const jwt = require('jsonwebtoken');
const configPath = require.resolve('../src/config/supabase');
const syncPath = require.resolve('../src/services/loyalty-sync.service');
const deviceId = 'a'.repeat(64);
const keyId = crypto.randomBytes(32).toString('base64');
const customer = crypto.randomUUID();
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = publicKey.export({ type: 'spki', format: 'pem' });
let dbKey, rpcCalls, syncCalls, rpcError;
const supabase = {
  from() {
    return {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      async maybeSingle() {
        return { data: dbKey, error: null };
      },
    };
  },
  async rpc(name, args) {
    assert.equal(name, 'apply_walking_steps');
    rpcCalls.push(args);
    return { data: { credited: true, rewardAmount: 100, creditedAmount: 100 }, error: rpcError };
  },
};
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: { supabase },
};
require.cache[syncPath] = {
  id: syncPath,
  filename: syncPath,
  loaded: true,
  exports: { queueCustomerLoyaltySync: (id) => syncCalls.push(id) },
};
const walking = require('../src/services/walking-rewards.service');
const contracts = require('../src/contracts/walking-rewards.contract');
test.beforeEach(() => {
  dbKey = { device_hash: walking.deviceHash(deviceId), public_key: pem, sign_count: 0 };
  rpcCalls = [];
  syncCalls = [];
  rpcError = null;
});
async function proof({
  source = 'ios_core_motion',
  steps = 10000,
  signer = privateKey,
  appId,
  counter = 1,
} = {}) {
  const { challenge, period } = await walking.createWalkingChallenge(customer, {
    deviceId,
    keyId,
    purpose: 'steps',
    dayOffset: 0,
  });
  const payload = JSON.stringify({ ...period, challenge, source, steps });
  const auth = Buffer.alloc(37);
  crypto
    .createHash('sha256')
    .update(
      appId ||
        `${process.env.APPLE_DEVICECHECK_TEAM_ID || process.env.APPLE_TEAM_ID || 'GKRRT4JU9G'}.com.bulka.bonus`,
    )
    .digest()
    .copy(auth);
  auth.writeUInt32BE(counter, 33);
  const nonce = crypto
    .createHash('sha256')
    .update(Buffer.concat([auth, crypto.createHash('sha256').update(payload).digest()]))
    .digest();
  const signature = crypto.sign('sha256', nonce, signer);
  return {
    deviceId,
    keyId,
    challenge,
    payload,
    assertion: cbor.encode({ signature, authenticatorData: auth }).toString('base64'),
  };
}
test('a verified native measurement reaches the atomic reward RPC and schedules loyalty sync', async () => {
  const body = await proof();
  const result = await walking.syncWalkingSteps(customer, body);
  assert.equal(result.rewardAmount, 100);
  assert.equal(result.creditedAmount, 100);
  assert.equal(rpcCalls[0].p_customer_id, customer);
  assert.equal(rpcCalls[0].p_steps, 10000);
  assert.equal(rpcCalls[0].p_counter, 1);
  assert.equal(rpcCalls[0].p_previous_counter, 0);
  assert.deepEqual(syncCalls, [customer]);
});
test('changing a signed step count or signing with another key never reaches the reward RPC', async () => {
  const body = await proof({ steps: 1 });
  const payload = JSON.stringify({ ...JSON.parse(body.payload), steps: 10000 });
  await assert.rejects(walking.syncWalkingSteps(customer, { ...body, payload }), {
    code: 'WALKING_PROOF_INVALID',
  });
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  await assert.rejects(
    walking.syncWalkingSteps(customer, await proof({ signer: other.privateKey })),
    { code: 'WALKING_PROOF_INVALID' },
  );
  assert.equal(rpcCalls.length, 0);
});
test('account, phone, key, purpose, expired challenge, day and source cannot be substituted', async () => {
  const body = await proof();
  const claims = jwt.decode(body.challenge);
  const expired = jwt.sign(
    { ...claims, exp: Math.floor(Date.now() / 1000) - 10 },
    process.env.CUSTOMER_JWT_SECRET,
  );
  for (const [owner, patch] of [
    [crypto.randomUUID(), {}],
    [customer, { deviceId: 'b'.repeat(64) }],
    [customer, { keyId: crypto.randomBytes(32).toString('base64') }],
    [customer, { challenge: expired }],
    [customer, { payload: JSON.stringify({ ...JSON.parse(body.payload), date: '2099-01-01' }) }],
  ])
    await assert.rejects(walking.syncWalkingSteps(owner, { ...body, ...patch }), {
      code: 'WALKING_PROOF_INVALID',
    });
  assert.throws(() => walking.verifyWalkingChallenge(customer, body, 'register'), {
    code: 'WALKING_PROOF_INVALID',
  });
  await assert.rejects(walking.syncWalkingSteps(customer, await proof({ source: 'manual' })), {
    code: 'WALKING_PROOF_INVALID',
  });
  assert.equal(rpcCalls.length, 0);
});
test('wrong app identifier, replayed counter and missing enrolled key are rejected', async () => {
  await assert.rejects(
    walking.syncWalkingSteps(customer, await proof({ appId: 'other.team.other.app' })),
    { code: 'WALKING_PROOF_INVALID' },
  );
  const body = await proof();
  dbKey.sign_count = 1;
  await assert.rejects(walking.syncWalkingSteps(customer, body), { code: 'WALKING_PROOF_INVALID' });
  dbKey = null;
  await assert.rejects(walking.syncWalkingSteps(customer, body), { code: 'WALKING_KEY_UNKNOWN' });
  assert.equal(rpcCalls.length, 0);
});
test('forged Apple attestation cannot enroll a device', async () => {
  const { challenge } = await walking.createWalkingChallenge(customer, {
    deviceId,
    keyId,
    purpose: 'register',
  });
  await assert.rejects(
    walking.registerWalkingDevice(customer, {
      deviceId,
      keyId,
      challenge,
      attestation: Buffer.from('not-apple-attestation').toString('base64'),
    }),
    { code: 'WALKING_PROOF_INVALID' },
  );
});
test('counter conflict from the database cannot schedule a balance sync or claim success', async () => {
  rpcError = { code: 'P0001' };
  await assert.rejects(walking.syncWalkingSteps(customer, await proof()), {
    code: 'WALKING_PROOF_INVALID',
  });
  assert.equal(syncCalls.length, 0);
});
test('Kazakhstan midnight is server-defined; yesterday ends at midnight rather than at request time', () => {
  const before = Date.parse('2026-10-02T18:59:59Z');
  assert.equal(walking.walkingPeriod(0, before).date, '2026-10-02');
  const after = Date.parse('2026-10-02T19:00:01Z');
  assert.deepEqual(walking.walkingPeriod(0, after), {
    date: '2026-10-03',
    startAt: '2026-10-02T19:00:00.000Z',
    endAt: '2026-10-02T19:00:01.000Z',
  });
  assert.equal(walking.walkingPeriod(1, after).endAt, '2026-10-02T19:00:00.000Z');
});
test('contracts reject manual counts, arbitrary extra account IDs, and invalid historical days', () => {
  assert.equal(
    contracts.walkingChallengeSchema.safeParse({ deviceId, keyId, purpose: 'steps', dayOffset: 7 })
      .success,
    false,
  );
  assert.equal(
    contracts.walkingSyncSchema.safeParse({
      deviceId,
      keyId,
      challenge: 'x'.repeat(40),
      steps: 10000,
    }).success,
    false,
  );
  assert.equal(
    contracts.walkingChallengeSchema.safeParse({
      deviceId,
      keyId,
      purpose: 'steps',
      customerId: customer,
    }).success,
    false,
  );
  assert.equal(
    contracts.walkingPayloadSchema.safeParse({ source: 'manual', steps: 10000 }).success,
    false,
  );
});

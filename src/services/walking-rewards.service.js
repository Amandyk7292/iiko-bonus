const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const cbor = require('cbor');
const { supabase } = require('../config/supabase');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');
const { walkingPayloadSchema } = require('../contracts/walking-rewards.contract');
const DAY = 86400000;
const OFFSET = 5 * 3600000;
const walkingError = (code, statusCode = 409) =>
  Object.assign(new Error(code), { code, statusCode });
const deviceHash = (id) =>
  crypto.createHash('sha256').update(`bulka:walking:v1:${id}`).digest('hex');
const appIdentity = () => ({
  bundleIdentifier: 'com.bulka.bonus',
  teamIdentifier:
    process.env.APPLE_DEVICECHECK_TEAM_ID || process.env.APPLE_TEAM_ID || 'GKRRT4JU9G',
});
function walkingPeriod(dayOffset = 0, now = Date.now()) {
  const date = new Date(now + OFFSET - dayOffset * DAY).toISOString().slice(0, 10);
  const start = Date.parse(`${date}T00:00:00+05:00`);
  return {
    date,
    startAt: new Date(start).toISOString(),
    endAt: new Date(Math.min(now, start + DAY)).toISOString(),
  };
}
function verifyWalkingChallenge(customerId, body, purpose) {
  let claims;
  try {
    claims = jwt.verify(body.challenge, process.env.CUSTOMER_JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'bulka',
      audience: 'bulka-walking-v1',
      subject: customerId,
    });
  } catch {
    throw walkingError('WALKING_PROOF_INVALID');
  }
  if (
    claims.purpose !== purpose ||
    claims.keyId !== body.keyId ||
    claims.deviceHash !== deviceHash(body.deviceId)
  )
    throw walkingError('WALKING_PROOF_INVALID');
  return claims;
}
async function createWalkingChallenge(customerId, body) {
  const period = walkingPeriod(body.dayOffset);
  const { data: key, error } = await supabase
    .from('walking_device_keys')
    .select('device_hash')
    .eq('key_id', body.keyId)
    .maybeSingle();
  if (error) throw walkingError('WALKING_UNAVAILABLE', 503);
  if (key && key.device_hash !== deviceHash(body.deviceId))
    throw walkingError('WALKING_PROOF_INVALID');
  const challenge = jwt.sign(
    { purpose: body.purpose, keyId: body.keyId, deviceHash: deviceHash(body.deviceId), period },
    process.env.CUSTOMER_JWT_SECRET,
    {
      algorithm: 'HS256',
      issuer: 'bulka',
      audience: 'bulka-walking-v1',
      subject: customerId,
      expiresIn: '5m',
      jwtid: crypto.randomUUID(),
    },
  );
  return { challenge, period, registered: !!key };
}
async function registerWalkingDevice(customerId, body) {
  verifyWalkingChallenge(customerId, body, 'register');
  let verified;
  try {
    const attestation = Buffer.from(body.attestation, 'base64');
    const decoded = cbor.decodeAllSync(attestation, { max_depth: 16, preventDuplicateKeys: true });
    if (decoded.length !== 1 || decoded[0].attStmt?.x5c?.length !== 2)
      throw new Error('invalid certificate chain');
    for (const certificate of decoded[0].attStmt.x5c) {
      const cert = new crypto.X509Certificate(certificate);
      if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) < Date.now())
        throw new Error('certificate expired');
    }
    const { verifyAttestation } = await import('node-app-attest');
    verified = verifyAttestation({
      attestation,
      challenge: body.challenge,
      keyId: body.keyId,
      ...appIdentity(),
      allowDevelopmentEnvironment: false,
    });
  } catch {
    throw walkingError('WALKING_PROOF_INVALID');
  }
  const { error } = await supabase.from('walking_device_keys').upsert(
    {
      key_id: body.keyId,
      public_key: verified.publicKey,
      device_hash: deviceHash(body.deviceId),
    },
    { onConflict: 'key_id', ignoreDuplicates: true },
  );
  if (error) throw walkingError('WALKING_UNAVAILABLE', 503);
  const { data: key, error: readError } = await supabase
    .from('walking_device_keys')
    .select('device_hash,public_key')
    .eq('key_id', body.keyId)
    .single();
  if (readError) throw walkingError('WALKING_UNAVAILABLE', 503);
  if (key.device_hash !== deviceHash(body.deviceId) || key.public_key !== verified.publicKey)
    throw walkingError('WALKING_PROOF_INVALID');
  return { registered: true };
}
async function syncWalkingSteps(customerId, body) {
  const claims = verifyWalkingChallenge(customerId, body, 'steps');
  let payload;
  try {
    payload = walkingPayloadSchema.parse(JSON.parse(body.payload));
  } catch {
    throw walkingError('WALKING_PROOF_INVALID');
  }
  if (
    payload.challenge !== body.challenge ||
    payload.date !== claims.period.date ||
    payload.startAt !== claims.period.startAt ||
    payload.endAt !== claims.period.endAt
  )
    throw walkingError('WALKING_PROOF_INVALID');
  const { data: key, error: readError } = await supabase
    .from('walking_device_keys')
    .select('device_hash,public_key,sign_count')
    .eq('key_id', body.keyId)
    .maybeSingle();
  if (readError) throw walkingError('WALKING_UNAVAILABLE', 503);
  if (!key) throw walkingError('WALKING_KEY_UNKNOWN');
  if (key.device_hash !== claims.deviceHash) throw walkingError('WALKING_PROOF_INVALID');
  let verified;
  try {
    const { verifyAssertion } = await import('node-app-attest');
    verified = verifyAssertion({
      assertion: Buffer.from(body.assertion, 'base64'),
      payload: body.payload,
      publicKey: key.public_key,
      signCount: Number(key.sign_count),
      ...appIdentity(),
    });
  } catch {
    throw walkingError('WALKING_PROOF_INVALID');
  }
  const { data, error } = await supabase.rpc('apply_walking_steps', {
    p_customer_id: customerId,
    p_key_id: body.keyId,
    p_previous_counter: Number(key.sign_count),
    p_counter: verified.signCount,
    p_challenge_id: claims.jti,
    p_date: payload.date,
    p_steps: payload.steps,
    p_start_at: payload.startAt,
    p_end_at: payload.endAt,
  });
  if (error) {
    if (['22023', 'P0001'].includes(error.code)) throw walkingError('WALKING_PROOF_INVALID');
    throw walkingError('WALKING_UNAVAILABLE', 503);
  }
  if (data.credited === true) queueCustomerLoyaltySync(customerId);
  return data;
}
async function walkingStatus(customerId) {
  const today = walkingPeriod().date;
  const { data: policy, error: policyError } = await supabase
    .from('walking_reward_policy')
    .select('enabled,starts_on')
    .eq('id', true)
    .single();
  if (policyError) throw walkingError('WALKING_UNAVAILABLE', 503);
  const { data, error } = await supabase
    .from('walking_daily_progress')
    .select('walking_date,steps,reward_amount,credited_at,measurement_end_at')
    .eq('customer_id', customerId)
    .gte('walking_date', walkingPeriod(6).date)
    .order('walking_date', { ascending: false });
  if (error) throw walkingError('WALKING_UNAVAILABLE', 503);
  return {
    date: today,
    enabled: policy.enabled,
    startsOn: policy.starts_on,
    targetSteps: 10000,
    rewardAmount: 1000,
    timezone: 'Asia/Almaty',
    days: (data || []).map((row) => ({
      date: row.walking_date,
      steps: row.steps,
      rewardAmount: row.reward_amount,
      credited: !!row.credited_at,
      complete:
        Date.parse(row.measurement_end_at) >=
        Date.parse(`${row.walking_date}T00:00:00+05:00`) + DAY,
    })),
  };
}
module.exports = {
  deviceHash,
  walkingPeriod,
  verifyWalkingChallenge,
  createWalkingChallenge,
  registerWalkingDevice,
  syncWalkingSteps,
  walkingStatus,
};

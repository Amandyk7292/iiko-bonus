const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const cbor = require('cbor');
const { supabase } = require('../config/supabase');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');
const { publishWalkingRewardEvents } = require('./walking-reward-events.service');
const {
  walkingError,
  walkingAssertionError,
  walkingDatabaseError,
} = require('../utils/walking-error.util');
const {
  walkingPayloadSchema,
  walkingAndroidPayloadSchema,
} = require('../contracts/walking-rewards.contract');
const DAY = 86400000;
const OFFSET = 5 * 3600000;
const deviceHash = (id) =>
  crypto.createHash('sha256').update(`bulka:walking:v1:${id}`).digest('hex');
const platformOf = (value) => value.platform || 'ios';
const androidPublicKey = 'play_integrity:com.bulka.bonus';
const integrityNonce = (value) =>
  crypto.createHash('sha256').update(value, 'utf8').digest('base64url');
async function verifyAndroidProof(token, content) {
  const { androidVerdict, checkAndroidVerdict } = require('./referral-device-proof.service');
  try {
    checkAndroidVerdict(await androidVerdict(token), integrityNonce(content));
  } catch (error) {
    throw walkingError(
      error.statusCode === 503 ? 'WALKING_UNAVAILABLE' : 'WALKING_PROOF_INVALID',
      error.statusCode === 503 ? 503 : 409,
    );
  }
}
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
  } catch (error) {
    throw walkingError(
      'WALKING_PROOF_INVALID',
      409,
      'challenge',
      error.name === 'TokenExpiredError' ? 'expired' : 'signature_invalid',
    );
  }
  if (
    claims.purpose !== purpose ||
    platformOf(claims) !== platformOf(body) ||
    claims.keyId !== body.keyId ||
    claims.deviceHash !== deviceHash(body.deviceId)
  )
    throw walkingError('WALKING_PROOF_INVALID', 409, 'challenge', 'binding_invalid');
  return claims;
}
async function createWalkingChallenge(customerId, body) {
  const now = Date.now();
  const platform = platformOf(body);
  const period = walkingPeriod(body.dayOffset, now);
  let periods =
    platform === 'android' && body.purpose === 'steps'
      ? (body.dayOffsets || [0, 1, 2, 3, 4, 5, 6]).map((offset) => walkingPeriod(offset, now))
      : undefined;
  if (periods) {
    const { data: policy, error: policyError } = await supabase
      .from('walking_reward_policy')
      .select('enabled,starts_on')
      .eq('id', true)
      .single();
    if (policyError) throw walkingDatabaseError(policyError, 'challenge_policy');
    periods = periods.filter((day) => day.date >= policy.starts_on);
    if (!policy.enabled || periods.length === 0) throw walkingError('WALKING_UNAVAILABLE', 503);
  }
  const { data: key, error } = await supabase
    .from('walking_device_keys')
    .select('device_hash,platform')
    .eq('key_id', body.keyId)
    .maybeSingle();
  if (error) throw walkingDatabaseError(error, 'challenge_key');
  if (key && (key.device_hash !== deviceHash(body.deviceId) || platformOf(key) !== platform))
    throw walkingError('WALKING_PROOF_INVALID', 409, 'challenge_key', 'identity_invalid');
  const challenge = jwt.sign(
    {
      purpose: body.purpose,
      keyId: body.keyId,
      deviceHash: deviceHash(body.deviceId),
      platform,
      ...(platform === 'ios' ? { period } : periods ? { periods } : {}),
    },
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
  return {
    challenge,
    ...(platform === 'ios' ? { period } : periods ? { periods } : {}),
    registered: !!key,
  };
}
async function registerWalkingDevice(customerId, body) {
  verifyWalkingChallenge(customerId, body, 'register');
  const platform = platformOf(body);
  let verified;
  if (platform === 'android') {
    await verifyAndroidProof(body.attestation, body.challenge);
    verified = { publicKey: androidPublicKey };
  } else
    try {
      const attestation = Buffer.from(body.attestation, 'base64');
      const decoded = cbor.decodeAllSync(attestation, {
        max_depth: 16,
        preventDuplicateKeys: true,
      });
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
      throw walkingError('WALKING_PROOF_INVALID', 409, 'attestation', 'verification_rejected');
    }
  const { error } = await supabase.from('walking_device_keys').upsert(
    {
      key_id: body.keyId,
      public_key: verified.publicKey,
      device_hash: deviceHash(body.deviceId),
      platform,
    },
    { onConflict: 'key_id', ignoreDuplicates: true },
  );
  if (error) throw walkingDatabaseError(error, 'registration_write');
  const { data: key, error: readError } = await supabase
    .from('walking_device_keys')
    .select('device_hash,public_key,platform')
    .eq('key_id', body.keyId)
    .single();
  if (readError) throw walkingDatabaseError(readError, 'registration_read');
  if (
    key.device_hash !== deviceHash(body.deviceId) ||
    key.public_key !== verified.publicKey ||
    platformOf(key) !== platform
  )
    throw walkingError('WALKING_PROOF_INVALID', 409, 'registration_read', 'identity_invalid');
  return { registered: true };
}
async function syncWalkingSteps(customerId, body) {
  const claims = verifyWalkingChallenge(customerId, body, 'steps');
  const platform = platformOf(body);
  let payload;
  try {
    payload = (platform === 'android' ? walkingAndroidPayloadSchema : walkingPayloadSchema).parse(
      JSON.parse(body.payload),
    );
  } catch {
    throw walkingError('WALKING_PROOF_INVALID', 409, 'measurement', 'payload_invalid');
  }
  if (
    payload.challenge !== body.challenge ||
    (platform === 'ios' &&
      (!claims.period ||
        payload.date !== claims.period.date ||
        payload.startAt !== claims.period.startAt ||
        payload.endAt !== claims.period.endAt)) ||
    (platform === 'android' &&
      (!Array.isArray(claims.periods) ||
        payload.measurements.length !== claims.periods.length ||
        new Set(payload.measurements.map((day) => day.date)).size !== payload.measurements.length ||
        payload.measurements.some(
          (day, index) =>
            day.date !== claims.periods[index].date ||
            day.startAt !== claims.periods[index].startAt ||
            day.endAt !== claims.periods[index].endAt,
        )))
  )
    throw walkingError('WALKING_PROOF_INVALID', 409, 'measurement', 'period_invalid');
  const { data: key, error: readError } = await supabase
    .from('walking_device_keys')
    .select('device_hash,public_key,sign_count,platform')
    .eq('key_id', body.keyId)
    .maybeSingle();
  if (readError) throw walkingDatabaseError(readError, 'measurement_key');
  if (!key) throw walkingError('WALKING_KEY_UNKNOWN', 409, 'measurement_key', 'key_missing');
  if (key.device_hash !== claims.deviceHash || platformOf(key) !== platform)
    throw walkingError('WALKING_PROOF_INVALID', 409, 'measurement_key', 'identity_invalid');
  if (platform === 'android') {
    if (key.public_key !== androidPublicKey || !Number.isSafeInteger(Number(key.sign_count)))
      throw walkingError('WALKING_PROOF_INVALID');
    await verifyAndroidProof(body.assertion, body.payload);
    const { data, error } = await supabase.rpc('apply_android_walking_steps', {
      p_customer_id: customerId,
      p_key_id: body.keyId,
      p_previous_counter: Number(key.sign_count),
      p_challenge_id: claims.jti,
      p_measurements: payload.measurements,
    });
    if (error) throw walkingDatabaseError(error, 'apply_android', ['22023', 'P0001', '23505']);
    if (data.days.some((day) => day.credited === true)) {
      queueCustomerLoyaltySync(customerId);
      publishWalkingRewardEvents(customerId, data);
    }
    return data;
  }
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
  } catch (error) {
    throw walkingAssertionError(error);
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
  if (error) throw walkingDatabaseError(error, 'apply_ios', ['22023', 'P0001']);
  if (data.credited === true) {
    queueCustomerLoyaltySync(customerId);
    publishWalkingRewardEvents(customerId, data);
  }
  return data;
}
async function walkingStatus(customerId) {
  const now = Date.now();
  const today = walkingPeriod(0, now).date;
  const { data: policy, error: policyError } = await supabase
    .from('walking_reward_policy')
    .select('enabled,starts_on')
    .eq('id', true)
    .single();
  if (policyError) throw walkingDatabaseError(policyError, 'status_policy');
  const { data, error } = await supabase
    .from('walking_daily_progress')
    .select('walking_date,steps,reward_amount,credited_at,measurement_end_at')
    .eq('customer_id', customerId)
    .gte('walking_date', walkingPeriod(6, now).date)
    .order('walking_date', { ascending: false });
  if (error) throw walkingDatabaseError(error, 'status_progress');
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

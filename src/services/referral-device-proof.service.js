const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');

const packageName = 'com.bulka.bonus';
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const stableDeviceHash = (device) =>
  hash(`bulka:referral:v2:${device.kind}:${device.id.toLowerCase()}`);
const unavailable = () =>
  Object.assign(new Error('Проверка устройства пока недоступна. Попробуйте позже.'), {
    statusCode: 503,
  });
const invalid = () =>
  Object.assign(new Error('Не удалось подтвердить устройство'), { statusCode: 409 });

function createDeviceChallenge(customerId, device, installationId) {
  const challenge = jwt.sign(
    {
      deviceHash: stableDeviceHash(device),
      installationHash: installationId ? hash(installationId) : null,
      kind: device.kind,
    },
    process.env.CUSTOMER_JWT_SECRET,
    {
      algorithm: 'HS256',
      subject: customerId,
      audience: 'bulka-referral-device',
      issuer: 'bulka',
      expiresIn: '5m',
      jwtid: crypto.randomUUID(),
    },
  );
  return { challenge, nonce: crypto.createHash('sha256').update(challenge).digest('base64url') };
}

function verifyChallenge(customerId, device, installationId, proof) {
  let payload;
  try {
    payload = jwt.verify(proof.challenge, process.env.CUSTOMER_JWT_SECRET, {
      algorithms: ['HS256'],
      audience: 'bulka-referral-device',
      issuer: 'bulka',
      subject: customerId,
    });
  } catch {
    throw invalid();
  }
  if (
    payload.deviceHash !== stableDeviceHash(device) ||
    payload.kind !== device.kind ||
    payload.installationHash !== (installationId ? hash(installationId) : null)
  )
    throw invalid();
  return {
    payload,
    nonce: crypto.createHash('sha256').update(proof.challenge).digest('base64url'),
  };
}

function checkAndroidVerdict(verdict, nonce, now = Date.now()) {
  const timestamp = Number(verdict?.requestDetails?.timestampMillis);
  if (
    verdict?.requestDetails?.requestPackageName !== packageName ||
    verdict.requestDetails.nonce !== nonce ||
    !Number.isFinite(timestamp) ||
    timestamp > now + 30000 ||
    now - timestamp > 300000 ||
    verdict.appIntegrity?.appRecognitionVerdict !== 'PLAY_RECOGNIZED' ||
    verdict.appIntegrity?.packageName !== packageName ||
    !Array.isArray(verdict.deviceIntegrity?.deviceRecognitionVerdict) ||
    !verdict.deviceIntegrity.deviceRecognitionVerdict.includes('MEETS_DEVICE_INTEGRITY') ||
    verdict.accountDetails?.appLicensingVerdict !== 'LICENSED'
  )
    throw invalid();
}

async function androidVerdict(token) {
  try {
    const { GoogleAuth } = require('google-auth-library');
    const credentials = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_CREDENTIALS_JSON || 'null',
    );
    if (!credentials) throw unavailable();
    const client = await new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/playintegrity'],
    }).getClient();
    const { data } = await client.request({
      url: `https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`,
      method: 'POST',
      data: { integrity_token: token },
      timeout: 15000,
    });
    return data.tokenPayloadExternal;
  } catch {
    throw unavailable();
  }
}

function appleAuthorization() {
  const teamId = process.env.APPLE_DEVICECHECK_TEAM_ID;
  const keyId = process.env.APPLE_DEVICECHECK_KEY_ID;
  const privateKey = String(process.env.APPLE_DEVICECHECK_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!teamId || !keyId || !privateKey) throw unavailable();
  return jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    issuer: teamId,
    keyid: keyId,
    expiresIn: '5m',
  });
}

// Only these static classifications may enter logs. Never log Apple's raw
// response or exception: either may contain credentials or a device token.
const appleResponseReasons = new Map([
  ['Invalid Authorization Token', 'authorization_invalid'],
  ['Unable to verify authorization token', 'authorization_invalid'],
  ['Authorization Token Expired', 'authorization_expired'],
  ['Bad Authorization Token', 'authorization_malformed'],
  ['Missing or badly formatted authorization token', 'authorization_malformed'],
  ['Bad Device Token', 'device_token_malformed'],
  ['Missing or badly formatted device token', 'device_token_malformed'],
  ['Invalid Device Token', 'device_token_invalid'],
  ['Bad Timestamp', 'timestamp_invalid'],
  ['Bad Payload', 'payload_invalid'],
  ['Bad Bits', 'bits_invalid'],
  ['Forbidden', 'forbidden'],
  ['Too Many Requests', 'rate_limited'],
  ['Server Error', 'provider_error'],
  ['Service Unavailable', 'provider_unavailable'],
]);

async function appleRequest(action, token, values = {}) {
  let stage = 'authorization';
  let reason = 'authorization_failed';
  let providerStatus = null;
  try {
    const authorization = appleAuthorization();
    stage = 'request';
    reason = 'transport_failed';
    const response = await fetch(`https://api.devicecheck.apple.com/v1/${action}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authorization}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_token: token,
        transaction_id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...values,
      }),
      signal: AbortSignal.timeout(15000),
    });
    providerStatus = Number.isInteger(response.status) ? response.status : null;
    if (!response.ok) {
      stage = 'http';
      const text = await response.text().catch(() => '');
      reason = appleResponseReasons.get(text.trim()) || 'unrecognized_response';
      throw unavailable();
    }
    if (action !== 'query_two_bits') return null;
    stage = 'response';
    reason = 'response_unreadable';
    const text = await response.text();
    // Apple has used both exact success bodies for a device with no stored bits.
    // Only HTTP success qualifies; an error status never grants eligibility.
    if (['Bit State Not Found', 'Failed to find bit state'].includes(text.trim())) {
      return { bit0: false, bit1: false };
    }
    reason = 'response_not_json';
    const result = JSON.parse(text);
    reason = 'response_invalid_bits';
    if (typeof result.bit0 !== 'boolean' || typeof result.bit1 !== 'boolean') throw unavailable();
    return result;
  } catch (error) {
    if (stage === 'request' && ['TimeoutError', 'AbortError'].includes(error?.name)) {
      reason = 'transport_timeout';
    }
    logger.warn(
      { event: 'referral_apple_devicecheck_failed', action, stage, reason, providerStatus },
      'Apple referral device verification failed',
    );
    throw unavailable();
  }
}

async function verifyDeviceProof(customerId, device, installationId, proof) {
  const { payload, nonce } = verifyChallenge(customerId, device, installationId, proof);
  const proofHash = hash(`${device.kind}:${proof.token}`);
  const { data: used, error: readError } = await supabase
    .from('referral_device_proofs')
    .select('proof_hash')
    .eq('proof_hash', proofHash)
    .maybeSingle();
  if (readError) throw unavailable();
  if (used) throw invalid();
  if (device.kind === 'android_id') {
    checkAndroidVerdict(await androidVerdict(proof.token), nonce);
  } else {
    const { data: owner, error } = await supabase
      .from('referral_stable_device_owners')
      .select('customer_id')
      .eq('device_hash', payload.deviceHash)
      .maybeSingle();
    if (error) throw unavailable();
    const bits = await appleRequest('query_two_bits', proof.token);
    // Bit 0 is reserved for Bulka referral eligibility. It survives loss of the
    // Keychain identity. Existing owners keep their rights on the same account.
    if (bits.bit0 === true && owner?.customer_id !== customerId)
      return { hash: proofHash, blocked: true };
    // Reserve the owner before marking Apple. A failed final DB write can then
    // be retried by that same account without losing its entitlement. This
    // reservation alone cannot qualify an account: the verified binding and
    // consumed proof are committed together by the subsequent database RPC.
    if (!owner) {
      let firstOwner = customerId;
      if (payload.installationHash) {
        const { data: legacy, error: legacyError } = await supabase
          .from('referral_device_owners')
          .select('customer_id')
          .eq('device_hash', payload.installationHash)
          .maybeSingle();
        if (legacyError) throw unavailable();
        firstOwner = legacy?.customer_id || customerId;
      }
      const { error: claimError } = await supabase
        .from('referral_stable_device_owners')
        .upsert(
          { device_hash: payload.deviceHash, customer_id: firstOwner, kind: device.kind },
          { onConflict: 'device_hash', ignoreDuplicates: true },
        );
      if (claimError) throw unavailable();
    }
    await appleRequest('update_two_bits', proof.token, { bit0: true, bit1: bits.bit1 === true });
  }
  return { hash: proofHash, blocked: false };
}

module.exports = {
  stableDeviceHash,
  createDeviceChallenge,
  verifyChallenge,
  checkAndroidVerdict,
  androidVerdict,
  verifyDeviceProof,
};

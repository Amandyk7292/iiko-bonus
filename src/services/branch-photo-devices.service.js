const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { credentialHash, encryptSecret, decryptSecret } = require('../utils/secret-envelope.util');
const {
  resolveLink,
  branchFields,
  rows,
  tokenHash,
  fail,
} = require('./branch-photo-report-access.service');
const CODE_PURPOSE = 'branch-photo-device-code';
const codeHash = (id, code, env = process.env) =>
  credentialHash(`${id}:${code}`, CODE_PURPOSE, env);
const deviceStatus = (d, now = new Date()) => {
  if (!d) return 'unregistered';
  if (d.status === 'pending' && (d.code_attempts >= 5 || new Date(d.expires_at) <= now))
    return 'expired';
  return d.status;
};
const deviceDto = (d, now) =>
  d
    ? {
        id: d.id,
        name: d.name || null,
        status: deviceStatus(d, now),
        approvedAt: d.approved_at || null,
        expiresAt: d.expires_at || null,
      }
    : { status: 'unregistered' };
async function findDevice(token, { db = supabase } = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) return null;
  return rows(
    db.from('branch_closing_devices').select('*').eq('token_hash', tokenHash(token)).maybeSingle(),
  );
}
function deviceError(status) {
  const codes = {
    unregistered: ['Подтвердите этот планшет у управляющего.', 'DEVICE_REQUIRED'],
    pending: ['Управляющий ещё не подтвердил этот планшет.', 'DEVICE_REQUIRED'],
    revoked: ['Доступ планшета отозван. Обратитесь к управляющему.', 'DEVICE_REVOKED'],
    expired: ['Код подтверждения истёк. Запросите новый.', 'DEVICE_EXPIRED'],
    wrong_branch: ['Планшет закреплён за другой точкой.', 'DEVICE_BRANCH_MISMATCH'],
  };
  const [message, code] = codes[status] || codes.unregistered;
  return fail(message, 403, `PHOTO_REPORT_${code}`);
}
async function requireDevice(token, branchId, { db = supabase, now = new Date(), deviceId } = {}) {
  const d = await findDevice(token, { db });
  if (d && d.branch_id !== branchId) throw deviceError('wrong_branch');
  const status = deviceStatus(d, now);
  if (status !== 'active') throw deviceError(status);
  if (deviceId !== undefined && (!deviceId || d.id !== deviceId)) throw deviceError('unregistered');
  return d;
}
async function resolveDeviceLink(qrToken, deviceToken, { db = supabase, now = new Date() } = {}) {
  // A scanned QR chooses a branch; after approval, the HttpOnly device credential
  // restores that branch without keeping its reusable QR in browser storage.
  if (qrToken) return resolveLink(qrToken, { db });
  const device = await findDevice(deviceToken, { db });
  const status = deviceStatus(device, now);
  if (status !== 'active') throw deviceError(status);
  const [branch, link] = await Promise.all([
    rows(db.from('bulka_locations').select(branchFields).eq('id', device.branch_id).maybeSingle()),
    rows(
      db
        .from('branch_closing_links')
        .select('branch_id,generation')
        .eq('branch_id', device.branch_id)
        .maybeSingle(),
    ),
  ]);
  if (!branch?.active || !link)
    throw fail('Точка недоступна. Обратитесь к управляющему.', 401, 'PHOTO_REPORT_LINK_INVALID');
  return { branch, link };
}
async function touchDevice(d, { db = supabase, now = new Date() } = {}) {
  await rows(
    db
      .from('branch_closing_devices')
      .update({ last_seen_at: now.toISOString() })
      .eq('id', d.id)
      .eq('status', 'active'),
  );
}
async function disconnect(token, { db = supabase } = {}) {
  const d = await findDevice(token, { db });
  if (!d) return;
  // The cookie can revoke only its own device; it cannot select another ID.
  const result = await rows(
    db.rpc('revoke_branch_closing_device', {
      p_id: d.id,
      p_branch: d.branch_id,
      p_admin: 'tablet-logout',
    }),
  );
  if (result.error) throw deviceError('unregistered');
}
function publicState(branch, d, { now = new Date(), env = process.env } = {}) {
  const response = {
    branch: { id: branch.id, name: branch.name, city: branch.city },
    device: deviceDto(d, now),
  };
  if (d && d.branch_id !== branch.id) return { ...response, device: { status: 'wrong_branch' } };
  if (deviceStatus(d, now) === 'pending') {
    response.pairingCode = decryptSecret(d.code_ciphertext, {
      purpose: CODE_PURPOSE,
      aad: d.id,
      env,
    });
    response.expiresAt = d.expires_at;
  }
  return response;
}
async function status(
  qrToken,
  deviceToken,
  { db = supabase, now = new Date(), env = process.env } = {},
) {
  const { branch } = await resolveDeviceLink(qrToken, deviceToken, { db, now });
  const d = await findDevice(deviceToken, { db });
  if (d?.branch_id === branch.id && d.status === 'active') await touchDevice(d, { db, now });
  return publicState(branch, d, { now, env });
}
async function request(
  qrToken,
  previousToken,
  { db = supabase, env = process.env, now = new Date() } = {},
) {
  const { branch } = await resolveLink(qrToken, { db });
  const previous = await findDevice(previousToken, { db });
  if (previous && previous.branch_id !== branch.id) throw deviceError('wrong_branch');
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  const result = await rows(
    db.rpc('request_branch_closing_device', {
      p_id: id,
      p_branch: branch.id,
      p_token_hash: tokenHash(token),
      p_code_hash: codeHash(id, code, env),
      p_code_ciphertext: encryptSecret(code, { purpose: CODE_PURPOSE, aad: id, env }),
      p_previous_hash: previous ? tokenHash(previousToken) : null,
    }),
  );
  if (result.error === 'device_branch_mismatch') throw deviceError('wrong_branch');
  if (result.error === 'link_invalid')
    throw fail('QR точки больше не действует.', 401, 'PHOTO_REPORT_LINK_INVALID');
  if (result.error)
    throw fail(
      'Слишком много заявок. Обратитесь к управляющему.',
      429,
      'PHOTO_REPORT_DEVICE_RATE_LIMIT',
    );
  const d = await rows(db.from('branch_closing_devices').select('*').eq('id', result.id).single());
  if (d.status === 'active') await touchDevice(d, { db, now });
  return { body: publicState(branch, d, { now, env }), token: d.id === id ? token : previousToken };
}
module.exports = {
  codeHash,
  deviceStatus,
  deviceDto,
  findDevice,
  deviceError,
  requireDevice,
  resolveDeviceLink,
  disconnect,
  touchDevice,
  status,
  request,
};

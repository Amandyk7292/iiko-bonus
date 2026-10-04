const { supabase } = require('../config/supabase');
const { branchScopeForAdmin } = require('../utils/admin-scope.util');
const { rows, assertScope, fail } = require('./branch-photo-report-access.service');
const { deviceStatus, codeHash } = require('./branch-photo-devices.service');
function assertManager(admin) {
  if (!['owner', 'admin', 'branch_manager'].includes(admin?.role))
    throw fail('Планшеты подтверждает владелец или управляющий.', 403, 'PHOTO_REPORT_FORBIDDEN');
}
const adminDto = (d, branch, now) => ({
  id: d.id,
  branchId: d.branch_id,
  branchName: branch.name,
  city: branch.city,
  name: d.name || null,
  status: deviceStatus(d, now),
  createdAt: d.created_at,
  approvedAt: d.approved_at || null,
  lastSeenAt: d.last_seen_at || null,
  expiresAt: d.expires_at || null,
});
async function list(admin, { branchId } = {}, { db = supabase, now = new Date() } = {}) {
  assertManager(admin);
  if (branchId) assertScope(admin, branchId);
  const scope = branchScopeForAdmin(admin);
  let branchQuery = db.from('bulka_locations').select('id,name,city');
  if (branchId) branchQuery = branchQuery.eq('id', branchId);
  else if (scope.length) branchQuery = branchQuery.in('id', scope);
  const branches = await rows(branchQuery);
  if (!branches.length) return { devices: [] };
  const devices = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rows(
      db
        .from('branch_closing_devices')
        .select(
          'id,branch_id,name,status,code_attempts,created_at,approved_at,last_seen_at,expires_at',
        )
        .in(
          'branch_id',
          branches.map((b) => b.id),
        )
        .order('created_at')
        .order('id')
        .range(offset, offset + 999),
    );
    devices.push(...page);
    if (page.length < 1000) break;
  }
  const byId = new Map(branches.map((b) => [b.id, b]));
  return { devices: devices.map((d) => adminDto(d, byId.get(d.branch_id), now)) };
}
async function context(admin, deviceId, db) {
  assertManager(admin);
  const d = await rows(
    db.from('branch_closing_devices').select('*').eq('id', deviceId).maybeSingle(),
  );
  if (!d) throw fail('Планшет не найден.', 404, 'PHOTO_REPORT_DEVICE_NOT_FOUND');
  assertScope(admin, d.branch_id);
  const branch = await rows(
    db.from('bulka_locations').select('id,name,city').eq('id', d.branch_id).single(),
  );
  return { d, branch };
}
async function mutation(admin, deviceId, action, args, { db = supabase, now = new Date() } = {}) {
  const { d, branch } = await context(admin, deviceId, db);
  const result = await rows(
    db.rpc(`${action}_branch_closing_device`, {
      p_id: d.id,
      p_branch: d.branch_id,
      p_admin: String(admin.sub || admin.id || admin.username || admin.login || admin.role),
      ...args,
    }),
  );
  if (result.error) {
    const errors = {
      invalid_code: ['Код не совпадает с кодом на планшете.', 'PHOTO_REPORT_DEVICE_CODE_INVALID'],
      device_expired: [
        'Код истёк. Запросите новый код на планшете.',
        'PHOTO_REPORT_DEVICE_EXPIRED',
      ],
      device_revoked: [
        'Заявка отозвана. Запросите новый код на планшете.',
        'PHOTO_REPORT_DEVICE_REVOKED',
      ],
      device_active: ['Планшет уже подтверждён.', 'PHOTO_REPORT_DEVICE_ALREADY_ACTIVE'],
      link_invalid: ['Точка не активна.', 'PHOTO_REPORT_LINK_INVALID'],
    };
    const [message, code] = errors[result.error] || [
      'Планшет не найден.',
      'PHOTO_REPORT_DEVICE_NOT_FOUND',
    ];
    throw fail(message, result.error === 'invalid_code' ? 400 : 409, code);
  }
  const updated = await rows(
    db.from('branch_closing_devices').select('*').eq('id', deviceId).single(),
  );
  return { device: adminDto(updated, branch, now) };
}
async function approve(admin, deviceId, body, options = {}) {
  if (
    !/^\d{6}$/.test(String(body.code || '')) ||
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    body.name.trim().length > 80
  )
    throw fail('Укажите код из шести цифр и название планшета.');
  return mutation(
    admin,
    deviceId,
    'approve',
    { p_code_hash: codeHash(deviceId, body.code, options.env), p_name: body.name.trim() },
    options,
  );
}
const revoke = (admin, deviceId, options) => mutation(admin, deviceId, 'revoke', {}, options);
module.exports = { assertManager, list, approve, revoke };

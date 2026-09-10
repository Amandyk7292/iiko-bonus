const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { credentialHash } = require('../utils/secret-envelope.util');
const { branchScopeForAdmin } = require('../utils/admin-scope.util');

const posDeviceTokenHash = (token) => credentialHash(token, 'pos-device-token');
const pairingHash = (code) => credentialHash(code, 'pos-pairing-code');
const failure = (message, statusCode = 400, code = 'POS_PAIRING_FAILED') =>
  Object.assign(new Error(message), { statusCode, code });

async function selectedBranch(admin, db = supabase) {
  if (!['owner', 'admin', 'manager', 'cashier'].includes(admin?.role)) {
    throw failure('Недостаточно прав для привязки кассы', 403);
  }
  const scope = branchScopeForAdmin(admin);
  if (scope.length !== 1) throw failure('Выберите один филиал', 409);
  const { data, error } = await db
    .from('bulka_locations')
    .select('id,name')
    .eq('id', scope[0])
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw failure('Филиал недоступен', 403);
  return data;
}

async function issuePosPairingCode(admin, db = supabase) {
  const branch = await selectedBranch(admin, db);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = String(crypto.randomInt(100000, 1000000));
    const { data, error } = await db.rpc('issue_pos_pairing_code', {
      p_branch: branch.id,
      p_code_hash: pairingHash(code),
    });
    if (error?.code === '23505') continue;
    if (error?.code === 'P0001') throw failure('Подождите перед созданием нового кода', 429);
    if (error) throw error;
    return {
      code,
      pairingId: data.id,
      expiresAt: data.expiresAt,
      branchId: branch.id,
      branchName: branch.name,
    };
  }
  throw failure('Не удалось создать код. Повторите попытку.', 503);
}

async function activatePosDevice(input, source, db = supabase) {
  const { data: allowed, error: limitError } = await db.rpc('allow_pos_pairing_attempt', {
    p_source_hash: credentialHash(source, 'pos-pairing-source'),
  });
  if (limitError) throw limitError;
  if (!allowed)
    throw failure(
      'Слишком много попыток. Повторите через 10 минут.',
      429,
      'POS_PAIRING_RATE_LIMITED',
    );
  const { data, error } = await db.rpc('activate_pos_device', {
    p_code_hash: pairingHash(input.code),
    p_terminal: input.terminalId,
    p_group: input.terminalGroupId,
    p_name: input.terminalName,
    p_token_hash: posDeviceTokenHash(input.terminalToken),
    p_expected_branch: input.expectedBranchId || null,
  });
  if (error) throw error;
  const errors = {
    invalid_code: 'Код неверный или истёк. Создайте новый код в приложении кассира.',
    different_branch: 'Эта касса уже привязана к другому филиалу. Обратитесь к администратору.',
    different_group:
      'Кассы филиала должны входить в одну группу iikoFront. Проверьте выбранный филиал.',
    device_limit: 'Достигнут лимит касс филиала. Обратитесь к администратору.',
  };
  if (!data || data.error) throw failure(errors[data?.error] || errors.invalid_code, 409);
  return data;
}

async function listPosDevices(admin, pairingId = '', db = supabase) {
  const branch = await selectedBranch(admin, db);
  let pairing = null;
  if (pairingId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pairingId))
      throw failure('Некорректный код привязки');
    const { data, error } = await db
      .from('pos_pairing_codes')
      .select('id,terminal_id,consumed_at,expires_at')
      .eq('id', pairingId)
      .eq('branch_id', branch.id)
      .maybeSingle();
    if (error) throw error;
    pairing = {
      id: pairingId,
      terminalId: data?.terminal_id || null,
      status: data?.consumed_at
        ? 'paired'
        : data && Date.parse(data.expires_at) > Date.now()
          ? 'waiting'
          : 'expired',
    };
  }
  const [{ data: devices, error }, { data: presence, error: presenceError }] = await Promise.all([
    db
      .from('pos_devices')
      .select('terminal_id,name,paired_at')
      .eq('branch_id', branch.id)
      .eq('active', true)
      .order('paired_at'),
    db
      .from('front_order_inbox_terminals')
      .select('terminal_id,last_seen_at')
      .eq('branch_id', branch.id),
  ]);
  if (error || presenceError) throw error || presenceError;
  const seen = new Map((presence || []).map((row) => [row.terminal_id, row.last_seen_at]));
  return {
    pairing,
    branchId: branch.id,
    branchName: branch.name,
    devices: (devices || []).map((row) => ({
      terminalId: row.terminal_id,
      name: row.name,
      pairedAt: row.paired_at,
      online: Date.parse(seen.get(row.terminal_id) || '') > Date.now() - 45000,
      lastSeenAt: seen.get(row.terminal_id) || null,
    })),
  };
}

module.exports = { activatePosDevice, issuePosPairingCode, listPosDevices, posDeviceTokenHash };

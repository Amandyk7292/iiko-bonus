const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { credentialHash } = require('../utils/secret-envelope.util');

const POS_TOKEN_PREFIX = 'bp1_';

const branchPosTokenHash = (token) => credentialHash(token, 'branch-pos-token');

const branchPosError = (message, statusCode = 400, code = 'BRANCH_POS_CREDENTIAL_ERROR') =>
  Object.assign(new Error(message), { statusCode, code });

async function rotateBranchPosCredential(branchId, rotatedBy) {
  const token = `${POS_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const { data, error } = await supabase.rpc('rotate_branch_pos_credential', {
    p_branch_id: branchId,
    p_token_hash: branchPosTokenHash(token),
    p_rotated_by: String(rotatedBy || 'admin').slice(0, 160),
  });
  if (error) {
    if (/branch not found/i.test(String(error.message || ''))) {
      throw branchPosError('Филиал не найден', 404, 'BRANCH_POS_BRANCH_NOT_FOUND');
    }
    throw error;
  }
  return {
    branchId: String(data.branchId),
    token,
    version: Number(data.version),
    rotatedAt: data.rotatedAt,
    headers: {
      branch: 'X-Bulka-Branch-Id',
      token: 'X-Bulka-POS-Token',
    },
  };
}

async function getBranchPosCredentialStatus(branchId) {
  const [{ data: branch, error: branchError }, { data: credential, error: credentialError }] =
    await Promise.all([
      supabase.from('bulka_locations').select('id,name,active').eq('id', branchId).maybeSingle(),
      supabase
        .from('branch_pos_credentials')
        .select('branch_id,version,active,rotated_by,rotated_at')
        .eq('branch_id', branchId)
        .maybeSingle(),
    ]);
  if (branchError) throw branchError;
  if (credentialError) throw credentialError;
  if (!branch) {
    throw branchPosError('Филиал не найден', 404, 'BRANCH_POS_BRANCH_NOT_FOUND');
  }
  return {
    branchId: String(branch.id),
    branchName: branch.name || null,
    branchActive: branch.active === true,
    configured: Boolean(credential?.active),
    version: credential ? Number(credential.version) : null,
    rotatedBy: credential?.rotated_by || null,
    rotatedAt: credential?.rotated_at || null,
  };
}

async function getBranchPosCoverage({ db = supabase } = {}) {
  const countActiveLegacyReservations = async () => {
    const activeQuery = () =>
      db
        .from('loyalty_reservations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString());

    const indexedResult = await activeQuery().is('pos_branch_id', null);
    if (!indexedResult.error) return Number(indexedResult.count || 0);

    // Deployment starts the new app before applying pending DDL. Fall back only
    // for that short pre-migration window; after DDL the indexed query above wins.
    // Some PostgREST/Supabase versions return only { message: '' } for a HEAD
    // request that references an unknown column, so the fallback itself is the
    // capability check. Any real database/auth/network failure also fails the
    // second query and therefore still makes readiness fail closed.
    const fallbackResult = await activeQuery().not('order_id', 'like', 'bp1:%');
    if (fallbackResult.error) throw fallbackResult.error;
    return Number(fallbackResult.count || 0);
  };

  const [
    { data: branches, error: branchError },
    { data: credentials, error: credentialError },
    activeLegacyReservations,
  ] = await Promise.all([
    db.from('bulka_locations').select('id').eq('active', true),
    db.from('branch_pos_credentials').select('branch_id').eq('active', true),
    countActiveLegacyReservations(),
  ]);
  if (branchError) throw branchError;
  if (credentialError) throw credentialError;
  const configured = new Set((credentials || []).map((row) => String(row.branch_id)));
  const activeBranchIds = (branches || []).map((row) => String(row.id));
  const configuredActiveBranches = activeBranchIds.filter((id) => configured.has(id)).length;
  return {
    activeBranches: activeBranchIds.length,
    configuredActiveBranches,
    missingActiveBranches: activeBranchIds.length - configuredActiveBranches,
    activeLegacyReservations,
    readyForEnforcement:
      activeBranchIds.length > 0 &&
      configuredActiveBranches === activeBranchIds.length &&
      activeLegacyReservations === 0,
  };
}

module.exports = {
  POS_TOKEN_PREFIX,
  branchPosTokenHash,
  getBranchPosCoverage,
  getBranchPosCredentialStatus,
  rotateBranchPosCredential,
};

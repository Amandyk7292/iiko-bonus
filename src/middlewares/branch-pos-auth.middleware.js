const { supabase } = require('../config/supabase');
const { safeEqual } = require('../services/auth.service');
const { branchPosTokenHash } = require('../services/branch-pos-credential.service');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const authCounters = { branch: 0, legacy: 0, rejected: 0 };

const reject = (res) => {
  authCounters.rejected += 1;
  return res.status(401).json({
    success: false,
    error: 'Branch POS authentication failed',
    code: 'BRANCH_POS_UNAUTHORIZED',
  });
};

const readHeader = (req, name) => {
  const value = req.headers?.[name];
  return Array.isArray(value) ? '' : String(value || '').trim();
};

const branchPosEnforcementMode = (env = process.env) =>
  String(env.LOYALTY_BRANCH_POS_ENFORCEMENT || '')
    .trim()
    .toLowerCase() === 'required'
    ? 'required'
    : 'compatibility';

async function branchPosAuthMiddleware(req, res, next) {
  try {
    if (req.posAuthMode === 'branch' && UUID_PATTERN.test(String(req.posBranchId || ''))) {
      return next();
    }
    const branchId = readHeader(req, 'x-bulka-branch-id');
    const token = readHeader(req, 'x-bulka-pos-token');
    if (!UUID_PATTERN.test(branchId) || token.length < 40 || token.length > 160) {
      return reject(res);
    }

    const [
      { data: credential, error: credentialError },
      { data: activeBranch, error: branchError },
    ] = await Promise.all([
      supabase
        .from('branch_pos_credentials')
        .select('branch_id,token_hash,active')
        .eq('branch_id', branchId)
        .eq('active', true)
        .maybeSingle(),
      supabase
        .from('bulka_locations')
        .select('id')
        .eq('id', branchId)
        .eq('active', true)
        .maybeSingle(),
    ]);
    if (credentialError) throw credentialError;
    if (branchError) throw branchError;

    const suppliedHash = branchPosTokenHash(token);
    const expectedHash = credential?.token_hash || '0'.repeat(64);
    if (!credential || !activeBranch || !safeEqual(suppliedHash, expectedHash)) {
      return reject(res);
    }

    const bodyBranchId = String(req.body?.branchId || '').trim();
    if (bodyBranchId && bodyBranchId !== branchId) {
      return reject(res);
    }

    // Gift-card reservation IDs are branch-bound in their own table. Loyalty
    // reservations are scoped by the branch-derived order key in the loyalty
    // service and must not be looked up in the gift-card table.
    if (req.body?.reservationId && String(req.path || '').includes('/gift-cards/')) {
      const { data: reservation, error: reservationError } = await supabase
        .from('gift_card_pos_reservations')
        .select('branch_id')
        .eq('id', req.body.reservationId)
        .maybeSingle();
      if (reservationError) throw reservationError;
      if (!reservation || String(reservation.branch_id) !== branchId) {
        return reject(res);
      }
    }

    req.posBranchId = branchId;
    req.posAuthMode = 'branch';
    authCounters.branch += 1;
    return next();
  } catch (error) {
    if (error.code === 'SECRET_ENVELOPE_NOT_CONFIGURED') {
      return res.status(503).json({
        success: false,
        error: 'Branch POS authentication is not configured',
        code: error.code,
      });
    }
    return next(error);
  }
}

function branchPosRolloutMiddleware(req, res, next) {
  const hasBranchHeader = Boolean(readHeader(req, 'x-bulka-branch-id'));
  const hasTokenHeader = Boolean(readHeader(req, 'x-bulka-pos-token'));
  if (branchPosEnforcementMode() === 'required' || hasBranchHeader || hasTokenHeader) {
    return branchPosAuthMiddleware(req, res, next);
  }
  req.posAuthMode = 'legacy';
  authCounters.legacy += 1;
  return next();
}

const branchPosAuthSnapshot = () => ({ ...authCounters });

module.exports = {
  branchPosAuthMiddleware,
  branchPosAuthSnapshot,
  branchPosEnforcementMode,
  branchPosRolloutMiddleware,
};

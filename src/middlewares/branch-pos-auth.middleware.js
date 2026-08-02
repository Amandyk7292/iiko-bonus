const { supabase } = require('../config/supabase');
const { safeEqual } = require('../services/auth.service');
const { branchPosTokenHash } = require('../services/branch-pos-credential.service');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const reject = (res) =>
  res.status(401).json({
    success: false,
    error: 'Branch POS authentication failed',
    code: 'BRANCH_POS_UNAUTHORIZED',
  });

const readHeader = (req, name) => {
  const value = req.headers?.[name];
  return Array.isArray(value) ? '' : String(value || '').trim();
};

async function branchPosAuthMiddleware(req, res, next) {
  try {
    const branchId = readHeader(req, 'x-bulka-branch-id');
    const token = readHeader(req, 'x-bulka-pos-token');
    if (!UUID_PATTERN.test(branchId) || token.length < 40 || token.length > 160) {
      return reject(res);
    }

    const { data: credential, error } = await supabase
      .from('branch_pos_credentials')
      .select('branch_id,token_hash,active')
      .eq('branch_id', branchId)
      .eq('active', true)
      .maybeSingle();
    if (error) throw error;

    const suppliedHash = branchPosTokenHash(token);
    const expectedHash = credential?.token_hash || '0'.repeat(64);
    if (!credential || !safeEqual(suppliedHash, expectedHash)) {
      return reject(res);
    }

    const bodyBranchId = String(req.body?.branchId || '').trim();
    if (bodyBranchId && bodyBranchId !== branchId) {
      return reject(res);
    }

    if (req.body?.reservationId) {
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

module.exports = { branchPosAuthMiddleware };

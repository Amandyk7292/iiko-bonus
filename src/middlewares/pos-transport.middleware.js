const { supabase } = require('../config/supabase');
const { safeEqual } = require('../services/auth.service');
const { posDeviceTokenHash } = require('../services/pos-pairing.service');
const { webhookMiddleware } = require('./webhook.middleware');

// Only POS routes accept device credentials. They cannot authenticate webhooks,
// staff sessions or any other register / branch.
async function posTransportMiddleware(req, res, next) {
  const authorization = String(req.headers?.authorization || '');
  if (!/^Bearer pt1_/i.test(authorization)) return webhookMiddleware(req, res, next);
  const reject = () =>
    res.status(401).json({
      success: false,
      code: 'POS_DEVICE_UNAUTHORIZED',
      error: 'Привязка кассы недействительна. Привяжите кассу заново.',
    });
  const token = authorization.replace(/^Bearer /i, '');
  if (!/^pt1_[a-f0-9]{64}$/.test(token)) return reject();
  try {
    const { data, error } = await supabase
      .from('pos_devices')
      .select('terminal_id,branch_id,token_hash,terminal_group_id')
      .eq('token_hash', posDeviceTokenHash(token))
      .eq('active', true)
      .maybeSingle();
    if (error) throw error;
    if (!data || !safeEqual(data.token_hash, posDeviceTokenHash(token))) return reject();
    const terminalId = String(req.headers?.['x-bulka-terminal-id'] || '').toLowerCase();
    const branchId = String(req.headers?.['x-bulka-branch-id'] || '').toLowerCase();
    if (terminalId !== data.terminal_id || (branchId && branchId !== data.branch_id))
      return reject();
    if (req.body?.terminalId && String(req.body.terminalId).toLowerCase() !== terminalId)
      return reject();
    if (
      req.body?.terminalGroupId &&
      String(req.body.terminalGroupId).toLowerCase() !== data.terminal_group_id
    )
      return reject();
    req.pairedPos = data;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { posTransportMiddleware };

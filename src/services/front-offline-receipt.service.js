const { stockArgs, rpc } = require('./front-stock-guard.service');
const realtime = require('./realtime.service');
async function recordOfflineReceipt(branchId, payload) {
  const data = await rpc('record_front_offline_receipt', {
    ...(await stockArgs(branchId, payload)),
    p_closed_at: payload.closedAt,
  });
  if (data.changed && !data.duplicate)
    realtime.publish('menu.updated', { inventory: true, branchId }, { adminOnly: true, branchId });
  return data;
}
module.exports = { recordOfflineReceipt };

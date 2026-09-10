const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { getIikoClientForBranch } = require('./iiko-city-profile.service');
const realtime = require('./realtime.service');
const { addQuantity } = require('../utils/quantity.util');

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    throw Object.assign(
      new Error(
        ['P0001', '22023', '23505'].includes(error.code)
          ? error.code === '23505'
            ? 'Этот онлайн-заказ уже связан с другим чеком'
            : error.message
          : 'Нет подтверждения учёта товара. Оплата на кассе приостановлена.',
      ),
      {
        statusCode: ['P0001', '22023', '23505'].includes(error.code) ? 409 : 503,
        code: 'FRONT_STOCK_NOT_CONFIRMED',
      },
    );
  }
  return data;
}

async function stockArgs(branchId, payload) {
  const client = await getIikoClientForBranch(branchId);
  const prefix =
    client.profileKey && client.profileKey !== 'default' ? `${client.profileKey}:` : '';
  const items = {};
  for (const item of payload.items) {
    const key = `${prefix}${item.productId.toLowerCase()}`;
    items[key] = addQuantity(items[key] || 0, item.quantity);
    if (items[key] > 9999)
      throw Object.assign(new Error('Слишком большое количество товара'), { statusCode: 400 });
  }
  return {
    p_branch: branchId,
    p_terminal: payload.terminalId,
    p_receipt: payload.receiptId,
    p_items: items,
    p_total: payload.total,
  };
}

async function heartbeatFrontStock(branchId, payload) {
  return rpc('front_stock_heartbeat', {
    p_branch: branchId,
    p_terminal: payload.terminalId,
    p_connected: payload.connected,
  });
}
async function authorizeFrontStock(branchId, payload) {
  const args = await stockArgs(branchId, payload);
  const digest = crypto
    .createHash('sha256')
    .update(`${branchId}\0${payload.receiptId}`, 'utf8')
    .digest('hex');
  const data = await rpc('authorize_front_stock_sale', {
    ...args,
    p_loyalty_key: `bp1:${branchId}:${digest}`,
    p_online_number: payload.onlineNumber || null,
  });
  realtime.publish('menu.updated', { inventory: true, branchId }, { adminOnly: true, branchId });
  return data;
}
async function finishFrontStock(branchId, payload) {
  const data = await rpc('finish_front_stock_sale', {
    ...(await stockArgs(branchId, payload)),
    p_state: payload.state,
  });
  realtime.publish('menu.updated', { inventory: true, branchId }, { adminOnly: true, branchId });
  return data;
}

async function recountFrontStock(branchId, payload) {
  const args = { p_branch: branchId, p_terminal: payload.terminalId, p_id: payload.recountId };
  if (!payload.items) return rpc('begin_front_stock_recount', args);
  const client = await getIikoClientForBranch(branchId);
  const prefix =
    client.profileKey && client.profileKey !== 'default' ? `${client.profileKey}:` : '';
  const data = await rpc('finish_front_stock_recount', {
    ...args,
    p_items: payload.items.map((item) => ({
      ...item,
      productId: `${prefix}${item.productId.toLowerCase()}`,
    })),
  });
  realtime.publish('menu.updated', { inventory: true, branchId }, { adminOnly: true, branchId });
  return data;
}
async function lookupFrontReceipt(branchId, payload) {
  return rpc('lookup_front_stock_receipt', {
    p_branch: branchId,
    p_terminal: payload.terminalId,
    p_receipt: payload.receiptId,
  });
}
module.exports = {
  stockArgs,
  rpc,
  heartbeatFrontStock,
  authorizeFrontStock,
  finishFrontStock,
  recountFrontStock,
  lookupFrontReceipt,
};

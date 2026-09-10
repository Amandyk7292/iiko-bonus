const { supabase } = require('../config/supabase');
const { getIikoClientForBranch } = require('./iiko-city-profile.service');
const realtime = require('./realtime.service');

const FRONT_FRESHNESS_MS = 45_000;

function frontSyncStatus(row, now = Date.now()) {
  return {
    configured: Boolean(row),
    connected: Boolean(
      row &&
      now - Date.parse(row.last_seen_at) <= FRONT_FRESHNESS_MS &&
      (!row.guard_enabled || row.guard_ready),
    ),
    guardEnabled: row?.guard_enabled === true,
    lastSyncedAt: row?.last_seen_at || null,
    terminalGroupId: row?.terminal_group_id || null,
  };
}

async function getFrontInventoryStatus(branchId) {
  const { data, error } = await supabase
    .from('branch_front_inventory_health')
    .select('last_seen_at,terminal_group_id,guard_enabled,guard_ready')
    .eq('branch_id', branchId)
    .maybeSingle();
  if (error) throw error;
  return frontSyncStatus(data);
}

async function applyFrontInventorySnapshot(branchId, snapshot) {
  const captured = Date.parse(snapshot.capturedAt);
  if (
    !Number.isFinite(captured) ||
    captured < Date.now() - 120_000 ||
    captured > Date.now() + 60_000
  ) {
    throw Object.assign(new Error('Время кассы не синхронизировано. Проверьте часы iikoFront.'), {
      statusCode: 409,
    });
  }
  const client = await getIikoClientForBranch(branchId);
  const prefix =
    client.profileKey && client.profileKey !== 'default' ? `${client.profileKey}:` : '';
  const { data, error } = await supabase.rpc('apply_front_inventory_snapshot', {
    p_branch_id: branchId,
    p_terminal_id: snapshot.terminalId,
    p_terminal_group_id: snapshot.terminalGroupId,
    p_session_id: snapshot.sessionId,
    p_sequence: snapshot.sequence,
    p_captured_at: snapshot.capturedAt,
    p_items: snapshot.items.map((item) => ({ ...item, productId: `${prefix}${item.productId}` })),
  });
  if (error)
    throw Object.assign(new Error('Не удалось синхронизировать остатки кассы'), {
      statusCode: error.code === '22023' ? 409 : 503,
    });
  if (data?.changed) {
    realtime.publish('menu.updated', { inventory: true, branchId }, { adminOnly: true, branchId });
    if (data.productIds?.length) {
      const { runBackgroundTask } = require('../utils/background-task.util');
      const { notifyAvailableStock } = require('./stock-subscription.service');
      runBackgroundTask('Front stock notifications', async () => {
        for (let offset = 0; offset < data.productIds.length; offset += 500) {
          await notifyAvailableStock(branchId, data.productIds.slice(offset, offset + 500));
        }
      });
    }
  }
  return data;
}

module.exports = {
  FRONT_FRESHNESS_MS,
  frontSyncStatus,
  getFrontInventoryStatus,
  applyFrontInventorySnapshot,
};

const { supabase } = require('../config/supabase');
const { sendOrderLiveActivity } = require('./live-activity.service');
const { isPickupLiveActivityExpired } = require('../utils/live-activity-expiry.util');

async function expireReadyPickupActivities({
  now = Date.now(),
  client = supabase,
  send = sendOrderLiveActivity,
} = {}) {
  const seen = new Set();
  const totals = { orders: 0, attempted: 0, delivered: 0, failed: 0 };
  let cursor;
  while (true) {
    let query = client
      .from('customer_live_activity_tokens')
      .select(
        'id,order:kaspi_orders!inner(id,status,fulfillment_status,delivery_status,fulfillment_type,preorder_fulfillment_type,kitchen_ready_at,updated_at,created_at)',
      )
      .eq('active', true)
      .order('id', { ascending: true })
      .limit(200);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data || []) {
      const order = row.order;
      if (!order?.id || seen.has(order.id) || !isPickupLiveActivityExpired(order, now)) continue;
      seen.add(order.id);
      const result = await send(order, { now });
      totals.orders++;
      for (const key of ['attempted', 'delivered', 'failed']) totals[key] += result[key] || 0;
    }
    if (!data || data.length < 200) break;
    cursor = data.at(-1).id;
  }
  if (totals.failed)
    throw new Error(`Live Activity expiry: ${totals.failed} deliveries need retry`);
  return totals;
}

module.exports = { expireReadyPickupActivities };

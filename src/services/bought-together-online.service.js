const { supabase } = require('../config/supabase');
const { countPairs, rankPairs, rankPopularity, shiftDay } = require('./bought-together.service');
const cache = new Map();
const pending = new Map();
async function buildBranch(branchId, db = supabase, now = new Date()) {
  const to = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(now);
  const from = shiftDay(to, -29);
  const counts = new Map();
  const popularity = new Map();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from('kaspi_orders')
      .select('id,cart_items,refund_amount,refund_status,fulfillment_status')
      .eq('branch_id', branchId)
      .eq('status', 'paid')
      .gte('created_at', from + 'T00:00:00+05:00')
      .lt('created_at', shiftDay(to, 1) + 'T00:00:00+05:00')
      .order('id', { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    const rows = (data || [])
      .filter(
        (order) =>
          !Number(order.refund_amount) &&
          !['processing', 'unknown', 'succeeded'].includes(order.refund_status) &&
          order.fulfillment_status !== 'cancelled',
      )
      .flatMap((order) =>
        (Array.isArray(order.cart_items) ? order.cart_items : []).map((item) => ({
          'UniqOrderId.Id': order.id,
          DishId: item.id,
          DishAmountInt: item.quantity,
        })),
      );
    countPairs(rows, counts, popularity);
    if ((data || []).length < 500) break;
  }
  return {
    products: rankPairs(counts, rankPopularity(popularity)),
    popularProducts: rankPopularity(popularity),
    day: to,
    expires: Date.now() + 300000,
  };
}
async function recommendations(productId, branchId) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  let value = cache.get(branchId);
  if (!value || value.expires < Date.now() || value.day !== today) {
    if (!pending.has(branchId)) {
      if (pending.size >= 4) return { productIds: [], days: 30, ready: false };
      pending.set(
        branchId,
        buildBranch(branchId)
          .then((result) => {
            if (cache.size >= 100) cache.delete(cache.keys().next().value);
            cache.set(branchId, result);
            return result;
          })
          .finally(() => pending.delete(branchId)),
      );
    }
    value = await pending.get(branchId);
  }
  const key = String(productId).toLowerCase();
  return {
    productIds: (value.products[key] || value.popularProducts)
      .filter((id) => id !== key)
      .slice(0, 40),
    days: 30,
    ready: true,
    source: 'branch-online',
  };
}
module.exports = { recommendations, buildBranch };

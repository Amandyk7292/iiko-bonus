const { supabase } = require('../config/supabase');

// Historical prices and quantities stay untouched; only display photos are added.
async function attachOrderImages(orders, { db = supabase } = {}) {
  const ids = [...new Set(orders.flatMap((order) => order.items || [])
    .filter((item) => !item.imageUrl && !item.image_url)
    .map((item) => String(item.id || item.productId || ''))
    .filter((id) => /^[a-z0-9._:-]{1,100}$/i.test(id)))];
  if (!ids.length) return orders;
  const candidates = new Map();
  try {
    for (let start = 0; start < ids.length; start += 150) {
      const batch = ids.slice(start, start + 150);
      const customIds = batch.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      const results = await Promise.all([
        db.from('menu_overrides').select('iiko_product_id,custom_image_url').in('iiko_product_id', batch),
        customIds.length ? db.from('custom_products').select('id,image_url').in('id', customIds)
          : Promise.resolve({ data: [] }),
      ]);
      for (const result of results) {
        if (result.error) continue;
        for (const row of result.data || []) {
          const imageUrl = row.custom_image_url || row.image_url;
          if (!String(imageUrl || '').startsWith('https://')) continue;
          const id = String(row.iiko_product_id || row.id);
          if (!candidates.has(id)) candidates.set(id, new Set());
          candidates.get(id).add(imageUrl);
        }
      }
    }
  } catch {
    // Photo availability must never hide a customer's purchase history.
    return orders;
  }
  if (!candidates.size) return orders;
  return orders.map((order) => ({ ...order, items: (order.items || []).map((item) => {
    const photos = candidates.get(String(item.id || item.productId || ''));
    return item.imageUrl || item.image_url || photos?.size !== 1 ? item
      : { ...item, imageUrl: [...photos][0] };
  }) }));
}

module.exports = { attachOrderImages };

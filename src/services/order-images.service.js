const { supabase } = require('../config/supabase');
const { catalogNameTranslations } = require('../utils/catalog-localization.util');

// Historical prices, names and quantities stay untouched. Add missing display
// photos and translated names, only when branches agree on the value.
async function attachOrderImages(orders, { db = supabase } = {}) {
  const translatedOrders = orders.map((order) => {
    const items = (order.items || []).map((item) => {
      if (!item.name) return item;
      const names = catalogNameTranslations(item.name, item.name_translations);
      return names.kk || names.en ? { ...item, name_translations: names } : item;
    });
    return items.some((item, index) => item !== order.items[index]) ? { ...order, items } : order;
  });
  if (translatedOrders.some((order, index) => order !== orders[index])) orders = translatedOrders;
  const ids = [
    ...new Set(
      orders
        .flatMap((order) => order.items || [])
        .filter(
          (item) =>
            (!item.imageUrl && !item.image_url) ||
            !item.name_translations?.kk ||
            !item.name_translations?.en,
        )
        .map((item) => String(item.id || item.productId || ''))
        .filter((id) => /^[a-z0-9._:-]{1,100}$/i.test(id)),
    ),
  ];
  if (!ids.length) return orders;
  const candidates = new Map();
  try {
    for (let start = 0; start < ids.length; start += 150) {
      const batch = ids.slice(start, start + 150);
      const customIds = batch.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      const results = await Promise.all([
        db
          .from('menu_overrides')
          .select('iiko_product_id,custom_image_url,name_translations')
          .in('iiko_product_id', batch),
        customIds.length
          ? db.from('custom_products').select('id,image_url').in('id', customIds)
          : Promise.resolve({ data: [] }),
      ]);
      for (const result of results) {
        if (result.error) continue;
        for (const row of result.data || []) {
          const imageUrl = row.custom_image_url || row.image_url;
          const id = String(row.iiko_product_id || row.id);
          if (!candidates.has(id))
            candidates.set(id, { photos: new Set(), kk: new Set(), en: new Set() });
          const candidate = candidates.get(id);
          if (String(imageUrl || '').startsWith('https://')) candidate.photos.add(imageUrl);
          for (const lang of ['kk', 'en']) {
            const name = row.name_translations?.[lang];
            if (typeof name === 'string' && name.trim())
              candidate[lang].add(name.trim().slice(0, 160));
          }
        }
      }
    }
  } catch {
    // Photo availability must never hide a customer's purchase history.
    return orders;
  }
  if (!candidates.size) return orders;
  return orders.map((order) => ({
    ...order,
    items: (order.items || []).map((item) => {
      const candidate = candidates.get(String(item.id || item.productId || ''));
      if (!candidate) return item;
      const names = { ...item.name_translations };
      for (const lang of ['kk', 'en']) {
        if (!names[lang] && candidate[lang].size === 1) names[lang] = [...candidate[lang]][0];
      }
      return {
        ...item,
        ...(!item.imageUrl &&
          !item.image_url &&
          candidate.photos.size === 1 && { imageUrl: [...candidate.photos][0] }),
        ...(Object.keys(names).length && { name_translations: names }),
      };
    }),
  }));
}

module.exports = { attachOrderImages };

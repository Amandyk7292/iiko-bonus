const { supabase } = require('../config/supabase');
async function badgeCatalog(db = supabase) {
  const { data, error } = await db
    .from('product_badges')
    .select('id,label,background,foreground')
    .order('label')
    .limit(300);
  if (error) throw error;
  return data || [];
}
async function publicBadgeMap(db = supabase) {
  const [badges, assignments] = await Promise.all([
    badgeCatalog(db),
    db.from('product_badge_assignments').select('product_id,badge_ids').limit(10000),
  ]);
  if (assignments.error) throw assignments.error;
  const byId = new Map(badges.map((b) => [b.id, b]));
  return new Map(
    (assignments.data || []).map((row) => [
      row.product_id,
      row.badge_ids.map((id) => byId.get(id)).filter(Boolean),
    ]),
  );
}
module.exports = { badgeCatalog, publicBadgeMap };

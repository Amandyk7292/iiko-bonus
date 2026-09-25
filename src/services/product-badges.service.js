const { supabase } = require('../config/supabase');
function badgeDto(row, language = 'ru') {
  const labelKk = String(row.label_kk || '').trim();
  return {
    id: row.id,
    label: language === 'kk' && labelKk ? labelKk : row.label,
    labelKk,
    background: row.background,
    foreground: row.foreground,
  };
}
async function badgeCatalog(db = supabase) {
  const { data, error } = await db
    .from('product_badges')
    .select('id,label,label_kk,background,foreground')
    .order('label')
    .limit(300);
  if (error) throw error;
  return (data || []).map((row) => badgeDto(row));
}
async function publicBadgeMap(db = supabase, language = 'ru') {
  const [badges, assignments] = await Promise.all([
    badgeCatalog(db),
    db.from('product_badge_assignments').select('product_id,badge_ids').limit(10000),
  ]);
  if (assignments.error) throw assignments.error;
  const byId = new Map(
    badges.map((badge) => [
      badge.id,
      { ...badge, label: language === 'kk' && badge.labelKk ? badge.labelKk : badge.label },
    ]),
  );
  return new Map(
    (assignments.data || []).map((row) => [
      row.product_id,
      row.badge_ids.map((id) => byId.get(id)).filter(Boolean),
    ]),
  );
}
module.exports = { badgeCatalog, publicBadgeMap, badgeDto };

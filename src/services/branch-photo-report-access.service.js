const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { branchScopeForAdmin } = require('../utils/admin-scope.util');
const { shiftTimes } = require('../utils/branch-schedule.util');
const branchFields =
  'id,name,city,active,round_the_clock,photo_day_shift_start,photo_night_shift_start';
const branchDto = (b) => ({
  id: b.id,
  name: b.name,
  city: b.city,
  active: b.active,
  roundTheClock: b.round_the_clock === true,
  photoDayShiftStart: shiftTimes(b).day,
  photoNightShiftStart: shiftTimes(b).night,
});
const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const fail = (message, statusCode = 400, code = 'PHOTO_REPORT_INVALID') =>
  Object.assign(new Error(message), { statusCode, code });
const rows = async (query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};
const assertScope = (admin, branchId) => {
  const scope = branchScopeForAdmin(admin);
  if (scope.length && !scope.includes(branchId))
    throw fail('Точка не входит в ваш доступ', 403, 'PHOTO_REPORT_FORBIDDEN');
};
async function resolveLink(token, { db = supabase } = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || '')))
    throw fail(
      'QR-код недействителен. Отсканируйте код вашей точки.',
      401,
      'PHOTO_REPORT_LINK_INVALID',
    );
  const link = await rows(
    db
      .from('branch_closing_links')
      .select('branch_id,generation')
      .eq('token_hash', tokenHash(token))
      .maybeSingle(),
  );
  const branch =
    link &&
    (await rows(
      db.from('bulka_locations').select(branchFields).eq('id', link.branch_id).maybeSingle(),
    ));
  if (!branch?.active)
    throw fail(
      'QR-код недействителен. Обратитесь к управляющему.',
      401,
      'PHOTO_REPORT_LINK_INVALID',
    );
  return { link, branch };
}
module.exports = { branchFields, branchDto, tokenHash, fail, rows, assertScope, resolveLink };

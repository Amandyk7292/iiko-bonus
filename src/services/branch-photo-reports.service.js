const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { encryptSecret, decryptSecret } = require('../utils/secret-envelope.util');
const { branchScopeForAdmin } = require('../utils/admin-scope.util');

const PURPOSE = 'branch-closing-qr';
const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const businessDate = (now = new Date()) =>
  new Date(now.getTime() + 3600000).toISOString().slice(0, 10);
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
const reportDto = (r) => ({
  id: r.id,
  branchId: r.branch_id,
  date: r.business_date,
  kind: r.kind,
  branchName: r.branch_name,
  city: r.city,
  photoCount: r.photo_count,
  submittedAt: r.submitted_at,
});

async function calendar(admin, { end = businessDate(), days = 14 } = {}, { db = supabase } = {}) {
  if (end > businessDate()) throw fail('Будущая дата недоступна');
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const from = start.toISOString().slice(0, 10);
  const scope = branchScopeForAdmin(admin);
  let branchQuery = db
    .from('bulka_locations')
    .select('id,name,city,active,sort_order')
    .order('sort_order')
    .order('name');
  if (scope.length) branchQuery = branchQuery.in('id', scope);
  const branches = await rows(branchQuery);
  const reports = [];
  for (let offset = 0; ; offset += 1000) {
    let query = db
      .from('branch_closing_reports')
      .select('*')
      .gte('business_date', from)
      .lte('business_date', end)
      .order('id')
      .range(offset, offset + 999);
    if (scope.length) query = query.in('branch_id', scope);
    const page = await rows(query);
    reports.push(...page);
    if (page.length < 1000) break;
  }
  const historicalIds = new Set(reports.map((r) => r.branch_id));
  return {
    businessDate: businessDate(),
    from,
    to: end,
    retentionDays: 3,
    cutoffHour: 4,
    branches: (branches || [])
      .filter((b) => b.active || historicalIds.has(b.id))
      .map((b) => ({ id: b.id, name: b.name, city: b.city, active: b.active })),
    reports: reports.map(reportDto),
  };
}

async function details(admin, branchId, date, { db = supabase, now = new Date() } = {}) {
  assertScope(admin, branchId);
  const branch = await rows(
    db.from('bulka_locations').select('id,name,city,active').eq('id', branchId).maybeSingle(),
  );
  if (!branch) throw fail('Точка не найдена', 404);
  const reports = await rows(
    db
      .from('branch_closing_reports')
      .select('*')
      .eq('branch_id', branchId)
      .eq('business_date', date),
  );
  const photos = reports.length
    ? await rows(
        db
          .from('branch_closing_photos')
          .select('id,upload_id,position,expires_at,deleted_at')
          .in(
            'upload_id',
            reports.map((r) => r.upload_id),
          )
          .order('position'),
      )
    : [];
  return {
    branch: { id: branch.id, name: branch.name, city: branch.city },
    date,
    reports: reports.map((r) => ({
      ...reportDto(r),
      photos: photos
        .filter((p) => p.upload_id === r.upload_id)
        .map((p) => ({
          id: p.id,
          expiresAt: p.expires_at,
          available: !p.deleted_at && new Date(p.expires_at) > now,
          url:
            !p.deleted_at && new Date(p.expires_at) > now
              ? `/admin/api/photo-reports/photos/${p.id}`
              : null,
        })),
    })),
  };
}

async function ensureQr(admin, branchId, { db = supabase, env = process.env } = {}) {
  if (!['owner', 'admin', 'branch_manager'].includes(admin.role))
    throw fail('QR выдаёт владелец или управляющий', 403);
  assertScope(admin, branchId);
  const branch = await rows(
    db.from('bulka_locations').select('id,name,city,active').eq('id', branchId).maybeSingle(),
  );
  if (!branch || !branch.active) throw fail('Точка не активна', 409);
  let link = await rows(
    db
      .from('branch_closing_links')
      .select('token_ciphertext')
      .eq('branch_id', branchId)
      .maybeSingle(),
  );
  if (!link) {
    const token = crypto.randomBytes(32).toString('base64url');
    await rows(
      db.from('branch_closing_links').upsert(
        {
          branch_id: branchId,
          token_hash: tokenHash(token),
          token_ciphertext: encryptSecret(token, { purpose: PURPOSE, aad: branchId, env }),
        },
        { onConflict: 'branch_id', ignoreDuplicates: true },
      ),
    );
    link = await rows(
      db.from('branch_closing_links').select('token_ciphertext').eq('branch_id', branchId).single(),
    );
  }
  const token = decryptSecret(link.token_ciphertext, { purpose: PURPOSE, aad: branchId, env });
  const origin = new URL(env.PUBLIC_BASE_URL || 'https://bulka.com.kz').origin;
  return {
    branch: { id: branch.id, name: branch.name, city: branch.city },
    url: `${origin}/branch-reports#t=${token}`,
  };
}

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
      db
        .from('bulka_locations')
        .select('id,name,city,active')
        .eq('id', link.branch_id)
        .maybeSingle(),
    ));
  if (!branch?.active)
    throw fail(
      'QR-код недействителен. Обратитесь к управляющему.',
      401,
      'PHOTO_REPORT_LINK_INVALID',
    );
  return { link, branch };
}

async function openSession(token, { db = supabase } = {}) {
  const { link, branch } = await resolveLink(token, { db });
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const date = businessDate();
  await rows(
    db.from('branch_closing_sessions').insert({
      token_hash: tokenHash(sessionToken),
      branch_id: branch.id,
      link_generation: link.generation,
      business_date: date,
    }),
  );
  const reports = await rows(
    db
      .from('branch_closing_reports')
      .select('*')
      .eq('branch_id', branch.id)
      .eq('business_date', date),
  );
  return {
    sessionToken,
    date,
    branch: { id: branch.id, name: branch.name, city: branch.city },
    reports: reports.map(reportDto),
    maxPhotos: 10,
    retentionDays: 3,
    cutoffHour: 4,
  };
}

async function resolveSession(token, { db = supabase } = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || '')))
    throw fail('Отсканируйте QR точки заново', 401, 'PHOTO_REPORT_SESSION_EXPIRED');
  const session = await rows(
    db.from('branch_closing_sessions').select('*').eq('token_hash', tokenHash(token)).maybeSingle(),
  );
  if (
    !session ||
    new Date(session.expires_at) <= new Date() ||
    session.business_date !== businessDate()
  )
    throw fail(
      'Сеанс завершён. Отсканируйте QR точки заново.',
      401,
      'PHOTO_REPORT_SESSION_EXPIRED',
    );
  const [branch, link] = await Promise.all([
    rows(db.from('bulka_locations').select('id,active').eq('id', session.branch_id).maybeSingle()),
    rows(
      db
        .from('branch_closing_links')
        .select('generation')
        .eq('branch_id', session.branch_id)
        .maybeSingle(),
    ),
  ]);
  if (!branch?.active || link?.generation !== session.link_generation)
    throw fail('QR точки больше не действует', 401, 'PHOTO_REPORT_LINK_INVALID');
  return session;
}

module.exports = {
  tokenHash,
  businessDate,
  fail,
  rows,
  assertScope,
  calendar,
  details,
  ensureQr,
  openSession,
  resolveSession,
};

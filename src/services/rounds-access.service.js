const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { supabase } = require('../config/supabase');
const { publicError } = require('../utils/app-error.util');
const { branchScopeForAdmin } = require('../utils/admin-scope.util');
const inspectorFields = 'id,name,username,city,branch_ids,active';
const branchFields = 'id,name,city,active';
const fail = (message, status = 400, code = 'ROUNDS_INVALID') => publicError(status, code, message);
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const csrf = (token) => hash(`rounds-csrf:${token}`);
const inspectorDto = (i) => ({
  id: i.id,
  name: i.name,
  username: i.username,
  city: i.city,
  branchIds: i.branch_ids,
  active: i.active,
});
async function data(query) {
  const { data: value, error } = await query;
  if (error) {
    const code = String(error.message || '').match(/ROUNDS_[A-Z_]+/)?.[0];
    if (code) {
      const messages = {
        ROUNDS_NOT_FOUND: ['Обход не найден', 404],
        ROUNDS_SESSION_INVALID: ['Войдите в свой кабинет', 401],
        ROUNDS_CANCELLED: ['Обход отменён', 409],
        ROUNDS_TASK_COMPLETED: ['Задание уже сдано', 409],
        ROUNDS_EVIDENCE_REQUIRED: ['Добавьте требуемые фото и видео', 400],
        ROUNDS_BRANCH_FORBIDDEN: ['Проверьте город и доступные точки', 403],
        ROUNDS_INSPECTOR_INVALID: ['Сотрудник недоступен', 400],
        ROUNDS_MEDIA_TYPE: ['Этот материал не подходит к заданию', 400],
        ROUNDS_MEDIA_LIMIT: ['Можно прикрепить не больше 6 материалов', 400],
      };
      const [message, status] = messages[code] || ['Проверьте данные обхода', 400];
      throw fail(message, status, code);
    }
    throw error;
  }
  return value;
}
const assertAdminBranch = (admin, branchId) => {
  const scope = branchScopeForAdmin(admin);
  if (scope.length && !scope.includes(branchId))
    throw fail('Обход не найден', 404, 'ROUNDS_NOT_FOUND');
};
function createRoundsAccess({ db = supabase, now = () => new Date() } = {}) {
  const inspector = async (id) =>
    data(db.from('inspection_inspectors').select(inspectorFields).eq('id', id).maybeSingle());
  const adminInspector = async (admin, id) => {
    const i = await inspector(id);
    if (!i) throw fail('Сотрудник не найден', 404, 'ROUNDS_NOT_FOUND');
    i.branch_ids.forEach((id) => assertAdminBranch(admin, id));
    return i;
  };
  const save = async (admin, id, values) => {
    if (id) await adminInspector(admin, id);
    values.branchIds?.forEach((branch) => assertAdminBranch(admin, branch));
    const savedId = await data(
      db.rpc('inspection_save_inspector', {
        p_id: id,
        p_values: values,
        p_admin_scope: branchScopeForAdmin(admin),
        p_created_by: String(admin.username || admin.id || 'admin'),
      }),
    );
    return inspectorDto(await inspector(savedId));
  };
  return {
    inspector,
    adminInspector,
    async createInspector(admin, values) {
      const password = crypto.randomBytes(12).toString('base64url');
      const username = `rounds.${crypto.randomBytes(6).toString('hex')}`;
      const created = await save(admin, null, {
        ...values,
        username,
        passwordHash: await bcrypt.hash(password, 12),
      });
      return { inspector: created, credentials: { username, password, url: '/rounds' } };
    },
    async patchInspector(admin, id, values) {
      return { inspector: await save(admin, id, values) };
    },
    async resetPassword(admin, id) {
      const current = await adminInspector(admin, id);
      const password = crypto.randomBytes(12).toString('base64url');
      await save(admin, id, { passwordHash: await bcrypt.hash(password, 12) });
      return { credentials: { username: current.username, password, url: '/rounds' } };
    },
    async login(username, password) {
      const i = await data(
        db
          .from('inspection_inspectors')
          .select(`${inspectorFields},password_hash`)
          .eq('username', username.toLowerCase())
          .maybeSingle(),
      );
      // Compare on a constant cost dummy hash too: unknown names don't bypass bcrypt.
      const valid = await bcrypt.compare(
        password,
        i?.password_hash || '$2b$12$zNSq5Pf4Mj8X3DFoym4j2e4Z.SGQhAdfZSuHdeDl4o.QBe7YNBKIS',
      );
      if (!i?.active || !valid)
        throw fail('Неверный логин или пароль', 401, 'ROUNDS_LOGIN_INVALID');
      const token = crypto.randomBytes(32).toString('base64url');
      await data(
        db.rpc('inspection_open_session', {
          p_inspector_id: i.id,
          p_expected_hash: i.password_hash,
          p_token_hash: hash(token),
        }),
      );
      return { token, inspector: inspectorDto(i), csrfToken: csrf(token) };
    },
    async resolve(token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || '')))
        throw fail('Войдите в свой кабинет', 401, 'ROUNDS_SESSION_INVALID');
      const session = await data(
        db
          .from('inspection_sessions')
          .select('id,inspector_id,expires_at')
          .eq('token_hash', hash(token))
          .maybeSingle(),
      );
      if (!session || new Date(session.expires_at) <= now())
        throw fail('Войдите в свой кабинет', 401, 'ROUNDS_SESSION_INVALID');
      const i = await inspector(session.inspector_id);
      if (!i?.active) throw fail('Войдите в свой кабинет', 401, 'ROUNDS_SESSION_INVALID');
      const expires = new Date(now().getTime() + 30 * 86400000).toISOString();
      const renewed = await data(
        db
          .from('inspection_sessions')
          .update({ expires_at: expires, last_seen_at: now().toISOString() })
          .eq('id', session.id)
          .gt('expires_at', now().toISOString())
          .select('id')
          .maybeSingle(),
      );
      if (!renewed) throw fail('Войдите в свой кабинет', 401, 'ROUNDS_SESSION_INVALID');
      return { inspector: i, sessionId: session.id, csrfToken: csrf(token) };
    },
    async logout(token) {
      if (/^[A-Za-z0-9_-]{43}$/.test(String(token || '')))
        await data(db.from('inspection_sessions').delete().eq('token_hash', hash(token)));
    },
    async assertStaffBranch(actor, branchId) {
      const i = actor.inspector;
      if (!i.branch_ids.includes(branchId)) throw fail('Обход не найден', 404, 'ROUNDS_NOT_FOUND');
      const branch = await data(
        db.from('bulka_locations').select(branchFields).eq('id', branchId).maybeSingle(),
      );
      if (!branch?.active || branch.city !== i.city)
        throw fail('Обход не найден', 404, 'ROUNDS_NOT_FOUND');
      return branch;
    },
  };
}
module.exports = {
  createRoundsAccess,
  data,
  fail,
  hash,
  csrf,
  inspectorFields,
  branchFields,
  inspectorDto,
  assertAdminBranch,
};

const { supabase } = require('../../config/supabase');
const { adminMutationSchemas } = require('../../contracts/admin-mutations.contract');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { ADMIN_PHONE_ROLES } = require('../../services/admin-phone-auth.service');
const {
  createCashierAccess,
  normalizeCashierUsername,
  resetCashierPassword,
  updateCashierAccess,
} = require('../../services/admin-credential-auth.service');
const { revokeAdminSessionsForSubject } = require('../../services/admin-session.service');
const { getBulkaLocations } = require('../../services/location.service');
const { normalizeBranchIds } = require('../../utils/admin-scope.util');
const { normalizeKazakhstanPhone } = require('../../utils/phone.util');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PROFILE_COLUMNS = 'username,display_name,role,branch_ids,active,created_at,updated_at';

const configuredAdminUsers = () => {
  let users;
  try {
    users = process.env.ADMIN_USERS_JSON ? JSON.parse(process.env.ADMIN_USERS_JSON) : [];
  } catch {
    users = [];
  }
  if (!Array.isArray(users) || !users.length) users = [{ username: 'admin' }];
  return users.map((user) => String(user?.username || '').trim()).filter(Boolean);
};

const normalizeAccessBranchIds = (value) => {
  if (value !== undefined && !Array.isArray(value)) return null;
  const branchIds = normalizeBranchIds(value);
  if (branchIds.length > 50 || branchIds.some((branchId) => !UUID_PATTERN.test(branchId))) {
    return null;
  }
  return branchIds;
};

const assertExistingBranches = async (branchIds) => {
  if (!branchIds.length) return;
  const locations = await getBulkaLocations({ includeInactive: true });
  const existing = new Set((locations || []).map((location) => String(location.id)));
  if (branchIds.some((branchId) => !existing.has(String(branchId)))) {
    throw Object.assign(new Error('Один из выбранных филиалов не существует'), {
      statusCode: 400,
      code: 'ACCESS_BRANCH_NOT_FOUND',
    });
  }
};

const profileResponse = (profile, credentialUsers, envUsers) => {
  const username = String(profile?.username || '');
  const passwordConfigured = credentialUsers.has(username.toLowerCase());
  return {
    ...profile,
    passwordConfigured,
    authMethod: passwordConfigured
      ? 'password'
      : normalizeKazakhstanPhone(username)
        ? 'whatsapp'
        : envUsers.has(username.toLowerCase())
          ? 'environment'
          : 'unknown',
  };
};

const routeError = (res, error, fallback = 'Не удалось сохранить доступ') => {
  if (error?.code === '23505') {
    return res.status(409).json({
      success: false,
      error: 'Учётная запись с таким логином уже существует',
      code: 'ACCESS_USERNAME_EXISTS',
    });
  }
  return res.status(error?.statusCode || 500).json({
    success: false,
    error: error?.statusCode ? error.message : fallback,
    code: error?.code,
  });
};

const registerAccessAdminRoutes = (router) => {
  router.get('/admin/api/access', async (_req, res) => {
    const [
      { data: profiles, error: profilesError },
      { data: credentials, error: credentialsError },
    ] = await Promise.all([
      supabase.from('admin_user_profiles').select(SAFE_PROFILE_COLUMNS).order('username'),
      supabase.from('admin_staff_credentials').select('username'),
    ]);
    const error = profilesError || credentialsError;
    if (error) return res.status(500).json({ success: false, error: error.message });

    const envUsernames = configuredAdminUsers();
    const envUsers = new Set(envUsernames.map((username) => username.toLowerCase()));
    const credentialUsers = new Set(
      (credentials || []).map((credential) => String(credential.username || '').toLowerCase()),
    );
    const safeProfiles = (profiles || []).map((profile) =>
      profileResponse(profile, credentialUsers, envUsers),
    );
    const configuredUsers = Array.from(
      new Set([
        ...envUsernames,
        ...safeProfiles.map((profile) => String(profile.username || '')).filter(Boolean),
      ]),
    );
    return res.json({ success: true, profiles: safeProfiles, configuredUsers });
  });

  router.post(
    '/admin/api/access',
    validateRequest(adminMutationSchemas.accessCreate),
    async (req, res) => {
      const displayName = String(req.body?.displayName || '')
        .trim()
        .slice(0, 160);
      const role = String(req.body?.role || 'operator');
      const branchIds = normalizeAccessBranchIds(req.body?.branchIds);
      if (!displayName) {
        return res.status(400).json({ success: false, error: 'Укажите имя сотрудника' });
      }
      if (!branchIds) {
        return res.status(400).json({ success: false, error: 'Некорректный список филиалов' });
      }

      try {
        await assertExistingBranches(branchIds);
        if (role === 'cashier') {
          const username = normalizeCashierUsername(req.body?.username);
          const envUsers = new Set(
            configuredAdminUsers().map((candidate) => candidate.toLowerCase()),
          );
          if (envUsers.has(username)) {
            return res.status(409).json({
              success: false,
              error: 'Этот логин уже используется системной учётной записью',
              code: 'ACCESS_USERNAME_EXISTS',
            });
          }
          const profile = await createCashierAccess({
            username,
            displayName,
            branchId: branchIds[0],
            password: req.body?.password,
          });
          return res.status(201).json({
            success: true,
            profile: {
              ...profile,
              passwordConfigured: true,
              authMethod: 'password',
            },
          });
        }

        const phone = normalizeKazakhstanPhone(req.body?.phone);
        if (!phone) {
          return res
            .status(400)
            .json({ success: false, error: 'Введите номер в формате +7 700 000 00 00' });
        }
        if (!ADMIN_PHONE_ROLES.has(role)) {
          return res.status(400).json({ success: false, error: 'Некорректная роль сотрудника' });
        }
        const { data, error } = await supabase
          .from('admin_user_profiles')
          .insert({
            username: phone,
            display_name: displayName,
            role,
            branch_ids: branchIds,
            active: true,
            updated_at: new Date().toISOString(),
          })
          .select(SAFE_PROFILE_COLUMNS)
          .single();
        if (error) throw error;
        return res.status(201).json({
          success: true,
          profile: { ...data, passwordConfigured: false, authMethod: 'whatsapp' },
        });
      } catch (error) {
        return routeError(res, error, 'Не удалось создать учётную запись');
      }
    },
  );

  router.put(
    '/admin/api/access/:username',
    validateRequest(adminMutationSchemas.accessUpdate),
    async (req, res) => {
      const rawUsername = String(req.params.username || '').trim();
      const username = normalizeKazakhstanPhone(rawUsername) || rawUsername.toLowerCase();
      const role = String(req.body?.role || 'viewer');
      const branchIds = normalizeAccessBranchIds(req.body?.branchIds);
      if (!branchIds) {
        return res.status(400).json({ success: false, error: 'Некорректный список филиалов' });
      }

      try {
        await assertExistingBranches(branchIds);
        const { data: existing, error: readError } = await supabase
          .from('admin_user_profiles')
          .select(SAFE_PROFILE_COLUMNS)
          .eq('username', username)
          .maybeSingle();
        if (readError) throw readError;

        if (existing?.role === 'cashier' && role !== 'cashier') {
          return res.status(409).json({
            success: false,
            error: 'Тип учётной записи кассира нельзя изменить',
            code: 'ACCESS_AUTH_METHOD_IMMUTABLE',
          });
        }
        if (role === 'cashier' && existing?.role !== 'cashier') {
          return res.status(409).json({
            success: false,
            error: 'Создайте отдельную учётную запись кассира с логином и паролем',
            code: 'ACCESS_AUTH_METHOD_IMMUTABLE',
          });
        }
        if (normalizeKazakhstanPhone(username) && !ADMIN_PHONE_ROLES.has(role)) {
          return res
            .status(400)
            .json({ success: false, error: 'Эту роль нельзя назначить входу по телефону' });
        }

        const record = {
          username,
          display_name:
            String(req.body?.displayName || '')
              .trim()
              .slice(0, 160) || null,
          role,
          branch_ids: branchIds,
          active: req.body?.active !== false,
          updated_at: new Date().toISOString(),
        };
        if (existing?.role === 'cashier') {
          const data = await updateCashierAccess({
            username,
            displayName: record.display_name,
            branchId: branchIds[0],
            active: record.active,
          });
          return res.json({
            success: true,
            profile: {
              ...data,
              passwordConfigured: true,
              authMethod: 'password',
            },
          });
        }
        const query = existing
          ? supabase.from('admin_user_profiles').update(record).eq('username', username)
          : supabase.from('admin_user_profiles').upsert(record, { onConflict: 'username' });
        const { data, error } = await query.select(SAFE_PROFILE_COLUMNS).single();
        if (error) throw error;
        if (record.active === false) await revokeAdminSessionsForSubject(username);
        return res.json({
          success: true,
          profile: {
            ...data,
            passwordConfigured: role === 'cashier',
            authMethod:
              role === 'cashier'
                ? 'password'
                : normalizeKazakhstanPhone(username)
                  ? 'whatsapp'
                  : 'environment',
          },
        });
      } catch (error) {
        return routeError(res, error);
      }
    },
  );

  router.put(
    '/admin/api/access/:username/password',
    validateRequest(adminMutationSchemas.accessPassword),
    async (req, res) => {
      try {
        await resetCashierPassword(req.params.username, req.body?.password);
        return res.json({ success: true });
      } catch (error) {
        return routeError(res, error, 'Не удалось изменить пароль кассира');
      }
    },
  );
};

module.exports = {
  normalizeAccessBranchIds,
  registerAccessAdminRoutes,
};

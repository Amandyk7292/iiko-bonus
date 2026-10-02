const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const bcrypt = require('bcryptjs');
const {
  authenticateDashboard,
  createDashboardAccess,
} = require('../src/services/iiko-dashboard-access.service');
const { adminMutationRoleMiddleware, ROLE_AREAS } = require('../src/middlewares/auth.middleware');
const { validateAdminSession } = require('../src/services/admin-session.service');
const { registerIikoDashboardRoutes } = require('../src/routes/admin/iiko-dashboard.routes');

test('dashboard credentials are atomic, bcrypt protected and never create an owner', async (t) => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`create role anon;create role authenticated;create role service_role;
    create table admin_user_profiles(username text primary key,display_name text,role text,branch_ids uuid[] default '{}',active boolean default true,
    constraint admin_user_profiles_role_check check(role in ('owner','cashier')));
    create table admin_staff_credentials(username text primary key references admin_user_profiles,password_hash text,auth_version integer default 1);`);
  await pg.exec(
    readFileSync('supabase/migrations/20261001143000_iiko_dashboard_access.sql', 'utf8'),
  );
  const db = {
    rpc: async (name, params) => {
      try {
        const result =
          name === 'get_iiko_dashboard_auth_record'
            ? await pg.query('select * from get_iiko_dashboard_auth_record($1)', [
                params.p_username,
              ])
            : await pg.query('select create_iiko_dashboard_access($1,$2,$3) as result', [
                params.p_username,
                params.p_display_name,
                params.p_password_hash,
              ]);
        return {
          data: name === 'get_iiko_dashboard_auth_record' ? result.rows : result.rows[0].result,
        };
      } catch (error) {
        return { error };
      }
    },
  };
  const result = await createDashboardAccess('fixture-dashboard', 'Fixture482', { db });
  assert.deepEqual(result, { username: 'fixture-dashboard', role: 'iiko_dashboard' });
  const stored = (await pg.query('select * from admin_staff_credentials')).rows[0];
  assert.notEqual(stored.password_hash, 'Fixture482');
  assert.equal(await bcrypt.compare('Fixture482', stored.password_hash), true);
  assert.equal(
    (await authenticateDashboard('fixture-dashboard', 'Fixture482', { db })).role,
    'iiko_dashboard',
  );
  assert.equal(await authenticateDashboard('fixture-dashboard', 'wrong', { db }), null);
  assert.equal(
    (await createDashboardAccess('fixture-dashboard', 'Fixture482', { db })).existing,
    true,
  );
  await assert.rejects(createDashboardAccess('fixture-dashboard', 'Different482', { db }));
  await pg.exec("update admin_user_profiles set active=false where username='fixture-dashboard'");
  assert.equal(await authenticateDashboard('fixture-dashboard', 'Fixture482', { db }), null);
  assert.equal(
    (
      await pg.query(
        "select has_function_privilege('anon','create_iiko_dashboard_access(text,text,text)','execute') permitted",
      )
    ).rows[0].permitted,
    false,
  );
});
test('server denies every other area and dashboard mutations', async (t) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { role: 'iiko_dashboard', branchIds: [] };
    next();
  });
  app.use('/admin/api', adminMutationRoleMiddleware);
  registerIikoDashboardRoutes(app, {
    listServers: async () => [],
    analytics: async () => ({ ok: true }),
  });
  app.use((_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/admin/api`;
  assert.equal((await fetch(`${base}/iiko-dashboard/servers`)).status, 200);
  for (const section of [
    'access',
    'settings',
    'menu',
    'orders',
    'customers',
    'operations',
    'events',
    'iiko',
    'photo-reports',
    'transactions',
  ])
    assert.equal((await fetch(`${base}/${section}`)).status, 403, section);
  for (const path of ['/iiko-dashboard/servers', '/iiko-dashboard/barters/person', '/iiko-dashboard/Servers/', '/iiko-dashboard/barters/Person/'])
    assert.equal(
      (
        await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      403,
      path,
    );
  assert.deepEqual([...ROLE_AREAS.iiko_dashboard], ['session', 'scope', 'iiko-dashboard']);
});
test('dashboard sessions expire when credentials are reset or role is changed', async () => {
  const records = {
    admin_sessions: {
      admin_subject: 'fixture-dashboard',
      role: 'iiko_dashboard',
      branch_ids: [],
      auth_version: 1,
      expires_at: 'infinity',
      revoked_at: null,
    },
    admin_user_profiles: { role: 'iiko_dashboard', branch_ids: [], active: true },
    admin_staff_credentials: { auth_version: 1 },
  };
  const db = {
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        async maybeSingle() {
          return { data: records[table] };
        },
      };
      return query;
    },
  };
  const payload = { jti: 'fixture-session', sub: 'fixture-dashboard', role: 'iiko_dashboard' };
  assert.equal(
    (await validateAdminSession(payload, { db, useLocal: false })).role,
    'iiko_dashboard',
  );
  records.admin_staff_credentials.auth_version = 2;
  assert.equal(await validateAdminSession(payload, { db, useLocal: false }), null);
  records.admin_staff_credentials.auth_version = 1;
  records.admin_user_profiles.role = 'owner';
  assert.equal(await validateAdminSession(payload, { db, useLocal: false }), null);
});

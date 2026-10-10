// Synthetic local database only. No environment files or remote clients are used.
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

async function createLearningDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    create table admin_user_profiles(username text primary key,display_name text,role text not null,
      branch_ids uuid[] not null default '{}',active boolean not null default true,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
      constraint admin_user_profiles_role_check check(role in ('owner','branch_manager','operator',
        'marketer','courier','editor','viewer','cashier','franchisee','iiko_dashboard')));
    create table bulka_locations(id uuid primary key,name text,city text,address text,
      active boolean default true,sort_order integer default 0);
    create table admin_staff_credentials(username text primary key references admin_user_profiles(username),
      password_hash text not null,auth_version integer not null default 1,
      password_changed_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now());
    create table admin_sessions(admin_subject text,revoked_at timestamptz);
    create function get_cashier_auth_record(p_username text) returns table(username text,password_hash text,
      auth_version integer,role text,branch_ids uuid[],active boolean) language sql security definer
      set search_path=public,pg_temp as $$ select c.username,c.password_hash,c.auth_version,p.role,p.branch_ids,p.active
      from admin_staff_credentials c join admin_user_profiles p on p.username=c.username
      where c.username=lower(btrim(p_username)); $$;
    revoke all on function get_cashier_auth_record(text) from public,anon,authenticated;
  `);
  await pg.exec(
    fs.readFileSync(
      path.join(
        __dirname,
        '../../supabase/migrations/20261010153000_employee_learning_platform.sql',
      ),
      'utf8',
    ),
  );
  return pg;
}

module.exports = { createLearningDatabase };

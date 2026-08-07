-- Per-branch cashier accounts use individual username/password credentials.
-- Password hashes are isolated from public staff profile reads.

alter table public.admin_user_profiles
  drop constraint if exists admin_user_profiles_role_check;

alter table public.admin_user_profiles
  add constraint admin_user_profiles_role_check
  check (
    role in (
      'owner',
      'branch_manager',
      'operator',
      'marketer',
      'courier',
      'editor',
      'viewer',
      'cashier'
    )
  );

alter table public.admin_user_profiles
  drop constraint if exists admin_user_profiles_cashier_branch_check;

alter table public.admin_user_profiles
  add constraint admin_user_profiles_cashier_branch_check
  check (role <> 'cashier' or cardinality(branch_ids) = 1);

create table if not exists public.admin_staff_credentials (
  username text primary key
    references public.admin_user_profiles(username) on update cascade on delete cascade,
  password_hash text not null,
  auth_version integer not null default 1,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_staff_credentials_username_check
    check (username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  constraint admin_staff_credentials_password_hash_check
    check (password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
  constraint admin_staff_credentials_auth_version_check
    check (auth_version between 1 and 2147483647)
);

create or replace function public.get_cashier_auth_record(p_username text)
returns table (
  username text,
  password_hash text,
  auth_version integer,
  role text,
  branch_ids uuid[],
  active boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    credentials.username,
    credentials.password_hash,
    credentials.auth_version,
    profile.role,
    profile.branch_ids,
    profile.active
  from public.admin_staff_credentials as credentials
  inner join public.admin_user_profiles as profile
    on profile.username = credentials.username
  where credentials.username = lower(btrim(coalesce(p_username, '')))
  limit 1;
$$;

alter table public.admin_sessions
  add column if not exists auth_version integer not null default 0;

alter table public.admin_sessions
  drop constraint if exists admin_sessions_auth_version_check;

alter table public.admin_sessions
  add constraint admin_sessions_auth_version_check
  check (auth_version between 0 and 2147483647);

create or replace function public.create_cashier_access(
  p_username text,
  p_display_name text,
  p_branch_id uuid,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_profile public.admin_user_profiles%rowtype;
begin
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,63}$' then
    raise exception 'invalid cashier username';
  end if;
  if nullif(btrim(coalesce(p_display_name, '')), '') is null
    or length(btrim(p_display_name)) > 160 then
    raise exception 'invalid cashier display name';
  end if;
  if p_branch_id is null then
    raise exception 'cashier branch is required';
  end if;
  if not exists (
    select 1 from public.bulka_locations where id = p_branch_id
  ) then
    raise exception 'cashier branch not found';
  end if;
  if coalesce(p_password_hash, '') !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception 'invalid cashier password hash';
  end if;

  insert into public.admin_user_profiles(
    username,
    display_name,
    role,
    branch_ids,
    active,
    updated_at
  )
  values (
    v_username,
    btrim(p_display_name),
    'cashier',
    array[p_branch_id],
    true,
    now()
  )
  returning * into v_profile;

  insert into public.admin_staff_credentials(username, password_hash)
  values (v_username, p_password_hash);

  return to_jsonb(v_profile);
end;
$$;

create or replace function public.reset_cashier_password(
  p_username text,
  p_password_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
begin
  if coalesce(p_password_hash, '') !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception 'invalid cashier password hash';
  end if;
  if not exists (
    select 1
    from public.admin_user_profiles
    where username = v_username and role = 'cashier'
  ) then
    raise exception 'cashier account not found';
  end if;

  update public.admin_staff_credentials
  set password_hash = p_password_hash,
      auth_version = auth_version + 1,
      password_changed_at = now(),
      updated_at = now()
  where username = v_username;

  if not found then
    raise exception 'cashier credentials not found';
  end if;

  update public.admin_sessions
  set revoked_at = now()
  where admin_subject = v_username and revoked_at is null;

  return true;
end;
$$;

create or replace function public.update_cashier_access(
  p_username text,
  p_display_name text,
  p_branch_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_profile public.admin_user_profiles%rowtype;
begin
  if p_branch_id is null or not exists (
    select 1 from public.bulka_locations where id = p_branch_id
  ) then
    raise exception 'cashier branch not found';
  end if;

  select *
  into v_profile
  from public.admin_user_profiles
  where username = v_username
  for update;

  if not found or v_profile.role <> 'cashier' then
    raise exception 'cashier account not found';
  end if;

  update public.admin_user_profiles
  set display_name = nullif(left(btrim(coalesce(p_display_name, '')), 160), ''),
      branch_ids = array[p_branch_id],
      active = coalesce(p_active, false),
      updated_at = now()
  where username = v_username
  returning * into v_profile;

  if coalesce(p_active, false) is false then
    update public.admin_staff_credentials
    set auth_version = auth_version + 1,
        updated_at = now()
    where username = v_username;

    if not found then
      raise exception 'cashier credentials not found';
    end if;

    update public.admin_sessions
    set revoked_at = now()
    where admin_subject = v_username and revoked_at is null;
  end if;

  return to_jsonb(v_profile);
end;
$$;

alter table public.admin_staff_credentials enable row level security;

drop policy if exists "service role manages admin staff credentials"
  on public.admin_staff_credentials;
create policy "service role manages admin staff credentials"
  on public.admin_staff_credentials
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.admin_staff_credentials from public, anon, authenticated;
grant all on table public.admin_staff_credentials to service_role;

revoke all on function public.get_cashier_auth_record(text) from public, anon, authenticated;
grant execute on function public.get_cashier_auth_record(text) to service_role;

revoke all on function public.create_cashier_access(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_cashier_access(text, text, uuid, text) to service_role;

revoke all on function public.reset_cashier_password(text, text)
  from public, anon, authenticated;
grant execute on function public.reset_cashier_password(text, text) to service_role;

revoke all on function public.update_cashier_access(text, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.update_cashier_access(text, text, uuid, boolean) to service_role;

-- Revocable admin sessions and append-only business audit context.

create table if not exists public.admin_sessions (
  jti_hash varchar(64) primary key
    check (jti_hash ~ '^[0-9a-f]{64}$'),
  admin_subject varchar(160) not null,
  role varchar(32) not null,
  branch_ids uuid[] not null default '{}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip_hash varchar(64),
  user_agent_hash varchar(64),
  created_at timestamptz not null default now(),
  constraint admin_sessions_expiry_check check (expires_at > created_at)
);

create index if not exists admin_sessions_subject_active_idx
  on public.admin_sessions(admin_subject, expires_at desc)
  where revoked_at is null;
create index if not exists admin_sessions_expiry_idx
  on public.admin_sessions(expires_at);

alter table public.admin_sessions enable row level security;
drop policy if exists service_role_all_admin_sessions
  on public.admin_sessions;
create policy service_role_all_admin_sessions
  on public.admin_sessions for all to service_role
  using (true) with check (true);
revoke all on public.admin_sessions from public, anon, authenticated;
grant all on public.admin_sessions to service_role;

alter table public.admin_audit_logs
  add column if not exists request_id varchar(128),
  add column if not exists action_code varchar(160),
  add column if not exists target_type varchar(80),
  add column if not exists target_id varchar(200),
  add column if not exists branch_id uuid,
  add column if not exists reason varchar(240),
  add column if not exists amount_change numeric(12, 2),
  add column if not exists outcome varchar(24),
  add column if not exists context jsonb not null default '{}'::jsonb;

create index if not exists admin_audit_logs_request_idx
  on public.admin_audit_logs(request_id)
  where request_id is not null;
create index if not exists admin_audit_logs_target_idx
  on public.admin_audit_logs(target_type, target_id, created_at desc)
  where target_id is not null;

create or replace function public.prevent_admin_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.audit_retention_purge', true) <> 'on' then
    raise exception 'admin audit logs are append-only';
  end if;
  return old;
end;
$$;

drop trigger if exists admin_audit_logs_append_only
  on public.admin_audit_logs;
create trigger admin_audit_logs_append_only
before update or delete on public.admin_audit_logs
for each row execute function public.prevent_admin_audit_mutation();

create or replace function public.purge_admin_audit_logs(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if p_before is null or p_before > now() - interval '90 days' then
    raise exception 'audit retention must be at least 90 days';
  end if;
  perform set_config('app.audit_retention_purge', 'on', true);
  delete from public.admin_audit_logs where created_at < p_before;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.prevent_admin_audit_mutation()
  from public, anon, authenticated;
revoke all on function public.purge_admin_audit_logs(timestamptz)
  from public, anon, authenticated;
grant execute on function public.purge_admin_audit_logs(timestamptz)
  to service_role;

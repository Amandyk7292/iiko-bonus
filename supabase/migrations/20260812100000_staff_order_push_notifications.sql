-- Durable, branch-scoped push notifications for cashier iPads.
-- New-order events are created by the database transaction that marks an
-- order paid, so a process crash cannot lose the notification.

create extension if not exists pgcrypto;

create table if not exists public.staff_push_devices (
  id uuid primary key default gen_random_uuid(),
  admin_subject varchar(160) not null,
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  session_jti_hash varchar(64) not null
    references public.admin_sessions(jti_hash) on delete cascade,
  auth_version integer not null,
  platform varchar(16) not null check (platform in ('ios', 'android')),
  installation_id varchar(160) not null,
  token text not null,
  active boolean not null default true,
  revoked_at timestamptz,
  last_test_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_push_devices_session_hash_check
    check (session_jti_hash ~ '^[0-9a-f]{64}$'),
  constraint staff_push_devices_auth_version_check
    check (auth_version between 1 and 2147483647),
  constraint staff_push_devices_installation_check
    check (installation_id ~ '^[A-Za-z0-9._:-]{8,160}$'),
  constraint staff_push_devices_token_check
    check (char_length(token) between 20 and 4096),
  constraint staff_push_devices_active_check
    check ((active and revoked_at is null) or (not active)),
  constraint staff_push_devices_installation_unique
    unique(platform, installation_id)
);

create unique index if not exists staff_push_devices_active_token_unique_idx
  on public.staff_push_devices(token) where active;
create index if not exists staff_push_devices_branch_active_idx
  on public.staff_push_devices(branch_id, last_seen_at desc) where active;
create index if not exists staff_push_devices_session_idx
  on public.staff_push_devices(session_jti_hash) where active;

create table if not exists public.staff_push_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique
    references public.kaspi_orders(id) on delete cascade,
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  order_number bigint not null,
  status varchar(16) not null default 'queued'
    check (status in ('queued', 'processing', 'sent', 'failed', 'skipped', 'uncertain')),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  sent_at timestamptz,
  last_error varchar(500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_push_outbox_pending_idx
  on public.staff_push_outbox(status, expires_at, created_at)
  where status in ('queued', 'processing');

create table if not exists public.staff_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.staff_push_outbox(id) on delete cascade,
  device_id uuid not null references public.staff_push_devices(id) on delete cascade,
  status varchar(16) not null default 'queued'
    check (status in (
      'queued', 'processing', 'dispatching', 'retry', 'sent', 'failed', 'skipped', 'uncertain'
    )),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 8),
  max_attempts smallint not null default 8 check (max_attempts between 1 and 8),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  lease_token uuid,
  provider_message_id varchar(500),
  last_error varchar(500),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(outbox_id, device_id)
);

create index if not exists staff_push_deliveries_pending_idx
  on public.staff_push_deliveries(status, next_attempt_at, created_at)
  where status in ('queued', 'processing', 'dispatching', 'retry');

alter table public.staff_push_devices enable row level security;
alter table public.staff_push_outbox enable row level security;
alter table public.staff_push_deliveries enable row level security;

drop policy if exists service_role_all_staff_push_devices on public.staff_push_devices;
create policy service_role_all_staff_push_devices on public.staff_push_devices
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all_staff_push_outbox on public.staff_push_outbox;
create policy service_role_all_staff_push_outbox on public.staff_push_outbox
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all_staff_push_deliveries on public.staff_push_deliveries;
create policy service_role_all_staff_push_deliveries on public.staff_push_deliveries
  for all to service_role using (true) with check (true);

revoke all on public.staff_push_devices, public.staff_push_outbox,
  public.staff_push_deliveries from public, anon, authenticated;
grant all on public.staff_push_devices, public.staff_push_outbox,
  public.staff_push_deliveries to service_role;

create or replace function public.register_staff_push_device(
  p_session_jti_hash text,
  p_token text,
  p_platform text,
  p_installation_id text
)
returns table(device_id uuid, platform text, installation_id text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.admin_sessions%rowtype;
  v_branch_id uuid;
  v_token text := btrim(coalesce(p_token, ''));
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_installation text := btrim(coalesce(p_installation_id, ''));
  v_device_id uuid;
  v_lock_a bigint;
  v_lock_b bigint;
begin
  if coalesce(p_session_jti_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid staff session';
  end if;
  if char_length(v_token) not between 20 and 4096 then
    raise exception 'invalid push token';
  end if;
  if v_platform not in ('ios', 'android') then
    raise exception 'invalid push platform';
  end if;
  if v_installation !~ '^[A-Za-z0-9._:-]{8,160}$' then
    raise exception 'invalid installation id';
  end if;

  select * into v_session
  from public.admin_sessions
  where jti_hash = p_session_jti_hash
    and role = 'cashier'
    and revoked_at is null
    and expires_at > now()
    and cardinality(branch_ids) = 1
  for update;
  if not found then raise exception 'active cashier session required'; end if;
  v_branch_id := v_session.branch_ids[1];

  if not exists (
    select 1
    from public.admin_user_profiles profile
    inner join public.admin_staff_credentials credential
      on credential.username = profile.username
    where profile.username = v_session.admin_subject
      and profile.active
      and profile.role = 'cashier'
      and profile.branch_ids = array[v_branch_id]
      and credential.auth_version = v_session.auth_version
  ) then
    raise exception 'cashier access changed';
  end if;

  -- Registrations are rare. A global registration lock also serializes token
  -- swaps between two installations, avoiding partial-unique-index deadlocks.
  perform pg_advisory_xact_lock(hashtextextended('staff-push-registration', 0));
  v_lock_a := hashtextextended(
    'staff-push-install:' || v_platform || ':' || v_installation, 0
  );
  v_lock_b := hashtextextended('staff-push-token:' || v_token, 0);
  perform pg_advisory_xact_lock(least(v_lock_a, v_lock_b));
  if v_lock_a <> v_lock_b then
    perform pg_advisory_xact_lock(greatest(v_lock_a, v_lock_b));
  end if;
  update public.staff_push_devices as device
  set active = false, revoked_at = now(), updated_at = now()
  where device.active and device.token = v_token
    and (device.platform, device.installation_id) <> (v_platform, v_installation);

  insert into public.staff_push_devices(
    admin_subject, branch_id, session_jti_hash, auth_version,
    platform, installation_id, token, active, revoked_at,
    last_seen_at, updated_at
  ) values (
    v_session.admin_subject, v_branch_id, v_session.jti_hash,
    v_session.auth_version, v_platform, v_installation, v_token,
    true, null, now(), now()
  )
  -- Name the table constraint explicitly. PL/pgSQL exposes RETURNS TABLE
  -- columns as variables, so the equivalent bare column-list conflict target
  -- is ambiguous inside this function.
  on conflict on constraint staff_push_devices_installation_unique do update set
    admin_subject = excluded.admin_subject,
    branch_id = excluded.branch_id,
    session_jti_hash = excluded.session_jti_hash,
    auth_version = excluded.auth_version,
    token = excluded.token,
    active = true,
    revoked_at = null,
    last_seen_at = now(),
    updated_at = now()
  returning id into v_device_id;

  return query select v_device_id, v_platform, v_installation;
end;
$$;

create or replace function public.unregister_staff_push_device(
  p_session_jti_hash text,
  p_platform text,
  p_installation_id text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_removed integer := 0;
begin
  update public.staff_push_devices
  set active = false, revoked_at = now(), updated_at = now()
  where session_jti_hash = p_session_jti_hash
    and platform = lower(btrim(coalesce(p_platform, '')))
    and installation_id = btrim(coalesce(p_installation_id, ''))
    and active;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

create or replace function public.deactivate_staff_push_devices_for_session(
  p_session_jti_hash text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_removed integer := 0;
begin
  update public.staff_push_devices
  set active = false, revoked_at = now(), updated_at = now()
  where session_jti_hash = p_session_jti_hash and active;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

create or replace function public.deactivate_invalid_staff_push_token(p_token text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_removed integer := 0;
begin
  update public.staff_push_devices
  set active = false, revoked_at = now(), updated_at = now()
  where token = btrim(coalesce(p_token, '')) and active;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

create or replace function public.staff_push_device_status(
  p_session_jti_hash text,
  p_platform text,
  p_installation_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff_push_devices device
    inner join public.admin_sessions session
      on session.jti_hash = device.session_jti_hash
    inner join public.admin_user_profiles profile
      on profile.username = session.admin_subject
    inner join public.admin_staff_credentials credential
      on credential.username = session.admin_subject
    where device.session_jti_hash = p_session_jti_hash
      and device.platform = lower(btrim(coalesce(p_platform, '')))
      and device.installation_id = btrim(coalesce(p_installation_id, ''))
      and device.active and device.revoked_at is null
      and session.revoked_at is null and session.expires_at > now()
      and session.role = 'cashier' and session.admin_subject = device.admin_subject
      and session.auth_version = device.auth_version
      and session.branch_ids = array[device.branch_id]
      and profile.active and profile.role = 'cashier'
      and profile.branch_ids = array[device.branch_id]
      and credential.auth_version = device.auth_version
  );
$$;

create or replace function public.claim_staff_push_test_device(
  p_session_jti_hash text,
  p_platform text,
  p_installation_id text
)
returns table(device_id uuid, token text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_device_id uuid;
declare v_token text;
begin
  select device.id, device.token into v_device_id, v_token
  from public.staff_push_devices device
  inner join public.admin_sessions session on session.jti_hash = device.session_jti_hash
  inner join public.admin_user_profiles profile on profile.username = session.admin_subject
  inner join public.admin_staff_credentials credential on credential.username = session.admin_subject
  where device.session_jti_hash = p_session_jti_hash
    and device.platform = lower(btrim(coalesce(p_platform, '')))
    and device.installation_id = btrim(coalesce(p_installation_id, ''))
    and device.active and device.revoked_at is null
    and (device.last_test_at is null or device.last_test_at <= now() - interval '60 seconds')
    and session.revoked_at is null and session.expires_at > now()
    and session.role = 'cashier' and session.admin_subject = device.admin_subject
    and session.auth_version = device.auth_version
    and session.branch_ids = array[device.branch_id]
    and profile.active and profile.role = 'cashier'
    and profile.branch_ids = array[device.branch_id]
    and credential.auth_version = device.auth_version
  for update of device;
  if not found then
    if exists (
      select 1 from public.staff_push_devices device
      where device.session_jti_hash = p_session_jti_hash
        and device.platform = lower(btrim(coalesce(p_platform, '')))
        and device.installation_id = btrim(coalesce(p_installation_id, ''))
        and device.active
        and device.last_test_at > now() - interval '60 seconds'
    ) then
      raise exception using message = 'staff push test cooldown', errcode = 'P0001';
    end if;
    return;
  end if;
  update public.staff_push_devices set last_test_at = now(), updated_at = now()
  where id = v_device_id;
  return query select v_device_id, v_token;
end;
$$;

create or replace function public.enqueue_staff_new_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_outbox_id uuid;
begin
  if new.status = 'paid'
    and new.branch_id is not null
    and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    insert into public.staff_push_outbox(order_id, branch_id, order_number)
    values (new.id, new.branch_id, new.order_number)
    on conflict (order_id) do nothing
    returning id into v_outbox_id;

    if v_outbox_id is not null then
      insert into public.staff_push_deliveries(outbox_id, device_id)
      select v_outbox_id, device.id
      from public.staff_push_devices device
      where device.branch_id = new.branch_id
        and device.active and device.revoked_at is null
      on conflict (outbox_id, device_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists kaspi_orders_enqueue_staff_new_order_push on public.kaspi_orders;
create trigger kaspi_orders_enqueue_staff_new_order_push
after insert or update of status on public.kaspi_orders
for each row execute function public.enqueue_staff_new_order_push();

create or replace function public.revoke_staff_devices_with_admin_session()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.revoked_at is not null and old.revoked_at is distinct from new.revoked_at then
    perform public.deactivate_staff_push_devices_for_session(new.jti_hash);
  end if;
  return new;
end;
$$;

drop trigger if exists admin_sessions_revoke_staff_devices on public.admin_sessions;
create trigger admin_sessions_revoke_staff_devices
after update of revoked_at on public.admin_sessions
for each row execute function public.revoke_staff_devices_with_admin_session();

create or replace function public.claim_staff_push_deliveries(p_limit integer default 100)
returns table(
  delivery_id uuid, outbox_id uuid, device_id uuid, lease_token uuid,
  token text, platform text, order_id uuid, order_number bigint,
  attempt_count smallint, max_attempts smallint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.staff_push_deliveries as expired
  set status = case when expired.attempt_count >= expired.max_attempts
        then 'failed' else 'retry' end,
      locked_at = null, lease_token = null,
      next_attempt_at = now(),
      last_error = 'Delivery lease expired', updated_at = now()
  where expired.status = 'processing'
    and expired.locked_at < now() - interval '5 minutes';

  -- A dispatching row crossed the durable pre-send boundary. Its provider
  -- outcome may be unknown after a worker crash, so fail closed instead of
  -- risking a duplicate notification on lease recovery.
  update public.staff_push_deliveries
  set status = 'uncertain',
      locked_at = null, lease_token = null,
      last_error = 'Delivery outcome uncertain; automatic resend disabled',
      updated_at = now()
  where status = 'dispatching' and locked_at < now() - interval '5 minutes';

  update public.staff_push_deliveries delivery
  set status = 'skipped', locked_at = null, lease_token = null,
      last_error = 'Notification is no longer current', updated_at = now()
  from public.staff_push_outbox outbox
  inner join public.kaspi_orders orders on orders.id = outbox.order_id
  where delivery.outbox_id = outbox.id
    and delivery.status in ('queued', 'retry', 'processing')
    and (
      outbox.expires_at <= now()
      or orders.status <> 'paid'
      or orders.kitchen_status <> 'queued'
      or orders.fulfillment_status not in ('pending', 'new')
    );

  update public.staff_push_deliveries delivery
  set status = 'skipped', locked_at = null, lease_token = null,
      last_error = 'Staff device authorization changed', updated_at = now()
  from public.staff_push_devices device, public.staff_push_outbox outbox
  where delivery.device_id = device.id
    and delivery.outbox_id = outbox.id
    and delivery.status in ('queued', 'retry', 'processing')
    and (device.branch_id <> outbox.branch_id or not exists (
      select 1
      from public.admin_sessions session
      inner join public.admin_user_profiles profile
        on profile.username = session.admin_subject
      inner join public.admin_staff_credentials credential
        on credential.username = session.admin_subject
      where session.jti_hash = device.session_jti_hash
        and session.admin_subject = device.admin_subject
        and session.role = 'cashier'
        and session.revoked_at is null and session.expires_at > now()
        and session.auth_version = device.auth_version
        and session.branch_ids = array[device.branch_id]
        and profile.active and profile.role = 'cashier'
        and profile.branch_ids = array[device.branch_id]
        and credential.auth_version = device.auth_version
        and device.active and device.revoked_at is null
    ));

  update public.staff_push_outbox outbox
  set status = case when exists (
        select 1 from public.staff_push_deliveries uncertain
        where uncertain.outbox_id = outbox.id and uncertain.status = 'uncertain'
      ) then 'uncertain' when exists (
        select 1 from public.staff_push_deliveries sent
        where sent.outbox_id = outbox.id and sent.status = 'sent'
      ) then 'sent' when exists (
        select 1 from public.staff_push_deliveries failed
        where failed.outbox_id = outbox.id and failed.status = 'failed'
      ) then 'failed' else 'skipped' end,
      sent_at = case when exists (
        select 1 from public.staff_push_deliveries sent
        where sent.outbox_id = outbox.id and sent.status = 'sent'
      ) then coalesce(outbox.sent_at, now()) else outbox.sent_at end,
      last_error = case when exists (
        select 1 from public.staff_push_deliveries uncertain
        where uncertain.outbox_id = outbox.id and uncertain.status = 'uncertain'
      ) then 'Staff push delivery outcome uncertain; automatic resend disabled'
      when exists (
        select 1 from public.staff_push_deliveries sent
        where sent.outbox_id = outbox.id and sent.status = 'sent'
      ) then null when exists (
        select 1 from public.staff_push_deliveries failed
        where failed.outbox_id = outbox.id and failed.status = 'failed'
      ) then 'Staff push delivery failed' else 'No eligible staff devices' end,
      updated_at = now()
  where outbox.status in ('queued', 'processing')
    and not exists (
      select 1 from public.staff_push_deliveries delivery
      where delivery.outbox_id = outbox.id
        and delivery.status in ('queued', 'retry', 'processing', 'dispatching')
    );

  return query
  with candidates as (
    select delivery.id
    from public.staff_push_deliveries delivery
    inner join public.staff_push_outbox outbox on outbox.id = delivery.outbox_id
    inner join public.kaspi_orders orders on orders.id = outbox.order_id
    inner join public.staff_push_devices device on device.id = delivery.device_id
    inner join public.admin_sessions session on session.jti_hash = device.session_jti_hash
    inner join public.admin_user_profiles profile on profile.username = session.admin_subject
    inner join public.admin_staff_credentials credential
      on credential.username = session.admin_subject
    where delivery.status in ('queued', 'retry')
      and delivery.next_attempt_at <= now()
      and delivery.attempt_count < delivery.max_attempts
      and outbox.expires_at > now()
      and orders.status = 'paid'
      and orders.fulfillment_status = 'new'
      and orders.kitchen_status = 'queued'
      and device.active and device.revoked_at is null
      and device.branch_id = outbox.branch_id
      and session.revoked_at is null and session.expires_at > now()
      and session.role = 'cashier'
      and session.admin_subject = device.admin_subject
      and session.auth_version = device.auth_version
      and session.branch_ids = array[device.branch_id]
      and profile.active and profile.role = 'cashier'
      and profile.branch_ids = array[device.branch_id]
      and credential.auth_version = device.auth_version
    order by delivery.next_attempt_at, delivery.created_at
    for update of delivery skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ), claimed as (
    update public.staff_push_deliveries delivery
    set status = 'processing', attempt_count = delivery.attempt_count + 1,
        locked_at = now(), lease_token = gen_random_uuid(), updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select claimed.id, claimed.outbox_id, claimed.device_id, claimed.lease_token,
         device.token, device.platform::text, outbox.order_id, outbox.order_number,
         claimed.attempt_count, claimed.max_attempts
  from claimed
  inner join public.staff_push_devices device on device.id = claimed.device_id
  inner join public.staff_push_outbox outbox on outbox.id = claimed.outbox_id;
end;
$$;

create or replace function public.begin_staff_push_delivery_dispatch(
  p_delivery_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The worker must commit this transition before contacting FCM. Processing
  -- leases are safe to retry because they have not crossed this boundary;
  -- dispatching leases are never automatically resent when their outcome is
  -- unknown.
  update public.staff_push_deliveries
  set status = 'dispatching', locked_at = now(), updated_at = now()
  where id = p_delivery_id
    and status = 'processing'
    and lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.recover_staff_push_delivery_sent(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_provider_message_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_outbox_id uuid;
begin
  update public.staff_push_deliveries
  set status = 'sent',
      locked_at = null,
      lease_token = null,
      provider_message_id = left(nullif(p_provider_message_id, ''), 500),
      last_error = null,
      sent_at = coalesce(sent_at, now()),
      updated_at = now()
  where id = p_delivery_id
    and status = 'dispatching'
    and lease_token = p_lease_token
  returning outbox_id into v_outbox_id;

  if not found then
    -- The original completion may have committed even when its network
    -- response was lost. An already-sent row is therefore a recovered success,
    -- never a reason to enqueue the notification again.
    return exists (
      select 1 from public.staff_push_deliveries
      where id = p_delivery_id and status = 'sent'
    );
  end if;

  update public.staff_push_outbox outbox
  set status = case
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id
            and d.status in ('queued','retry','processing','dispatching'))
          then 'processing'
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id and d.status = 'uncertain') then 'uncertain'
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id and d.status = 'sent') then 'sent'
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id and d.status = 'failed') then 'failed'
        else 'skipped' end,
      sent_at = case when exists (select 1 from public.staff_push_deliveries d
        where d.outbox_id = outbox.id and d.status = 'sent') then coalesce(outbox.sent_at, now())
        else outbox.sent_at end,
      last_error = case when exists (select 1 from public.staff_push_deliveries d
        where d.outbox_id = outbox.id and d.status = 'uncertain')
        then 'Staff push delivery outcome uncertain; automatic resend disabled'
        else null end,
      updated_at = now()
  where outbox.id = v_outbox_id;
  return true;
end;
$$;

create or replace function public.release_staff_push_delivery_claim(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_last_error text default null,
  p_retry_seconds integer default 15
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_outbox_id uuid;
begin
  update public.staff_push_deliveries
  set status = case when attempt_count >= max_attempts then 'failed' else 'retry' end,
      next_attempt_at = case when attempt_count >= max_attempts then next_attempt_at
        else now() + make_interval(
          secs => least(greatest(coalesce(p_retry_seconds, 15), 1), 1800)
        ) end,
      locked_at = null,
      lease_token = null,
      last_error = left(
        nullif(coalesce(p_last_error, 'Staff push delivery interrupted'), ''),
        500
      ),
      updated_at = now()
  where id = p_delivery_id
    and status in ('processing', 'dispatching')
    and lease_token = p_lease_token
  returning outbox_id into v_outbox_id;
  if not found then return false; end if;

  update public.staff_push_outbox outbox
  set status = case
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id
            and d.status in ('queued','retry','processing','dispatching'))
          then 'processing'
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id and d.status = 'uncertain') then 'uncertain'
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id and d.status = 'sent') then 'sent'
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id and d.status = 'failed') then 'failed'
        else 'skipped' end,
      sent_at = case when exists (select 1 from public.staff_push_deliveries d
        where d.outbox_id = outbox.id and d.status = 'sent') then coalesce(outbox.sent_at, now())
        else outbox.sent_at end,
      last_error = case when exists (select 1 from public.staff_push_deliveries d
        where d.outbox_id = outbox.id and d.status = 'uncertain')
        then 'Staff push delivery outcome uncertain; automatic resend disabled'
        else null end,
      updated_at = now()
  where outbox.id = v_outbox_id;
  return true;
end;
$$;

create or replace function public.complete_staff_push_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_status text,
  p_last_error text default null,
  p_provider_message_id text default null,
  p_retry_seconds integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_outbox_id uuid;
begin
  if p_status not in ('sent', 'retry', 'failed', 'skipped', 'uncertain') then
    raise exception 'invalid staff push delivery status';
  end if;
  update public.staff_push_deliveries
  set status = p_status,
      next_attempt_at = case when p_status = 'retry'
        then now() + make_interval(secs => least(greatest(coalesce(p_retry_seconds, 15), 1), 1800))
        else next_attempt_at end,
      locked_at = null, lease_token = null,
      provider_message_id = left(nullif(p_provider_message_id, ''), 500),
      last_error = left(nullif(p_last_error, ''), 500),
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      updated_at = now()
  where id = p_delivery_id and status = 'dispatching' and lease_token = p_lease_token
  returning outbox_id into v_outbox_id;
  if not found then return false; end if;

  update public.staff_push_outbox outbox
  set status = case
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id
            and d.status in ('queued','retry','processing','dispatching'))
          then 'processing'
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id and d.status = 'uncertain') then 'uncertain'
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id and d.status = 'sent') then 'sent'
        when exists (select 1 from public.staff_push_deliveries d
          where d.outbox_id = outbox.id and d.status = 'failed') then 'failed'
        else 'skipped' end,
      sent_at = case when exists (select 1 from public.staff_push_deliveries d
        where d.outbox_id = outbox.id and d.status = 'sent') then coalesce(outbox.sent_at, now())
        else outbox.sent_at end,
      last_error = case when exists (select 1 from public.staff_push_deliveries d
        where d.outbox_id = outbox.id and d.status = 'uncertain')
        then 'Staff push delivery outcome uncertain; automatic resend disabled'
        else null end,
      updated_at = now()
  where outbox.id = v_outbox_id;
  return true;
end;
$$;

revoke all on function public.register_staff_push_device(text,text,text,text),
  public.unregister_staff_push_device(text,text,text),
  public.deactivate_staff_push_devices_for_session(text),
  public.deactivate_invalid_staff_push_token(text),
  public.staff_push_device_status(text,text,text),
  public.claim_staff_push_test_device(text,text,text),
  public.claim_staff_push_deliveries(integer),
  public.begin_staff_push_delivery_dispatch(uuid,uuid),
  public.recover_staff_push_delivery_sent(uuid,uuid,text),
  public.release_staff_push_delivery_claim(uuid,uuid,text,integer),
  public.complete_staff_push_delivery(uuid,uuid,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.register_staff_push_device(text,text,text,text),
  public.unregister_staff_push_device(text,text,text),
  public.deactivate_staff_push_devices_for_session(text),
  public.deactivate_invalid_staff_push_token(text),
  public.staff_push_device_status(text,text,text),
  public.claim_staff_push_test_device(text,text,text),
  public.claim_staff_push_deliveries(integer),
  public.begin_staff_push_delivery_dispatch(uuid,uuid),
  public.recover_staff_push_delivery_sent(uuid,uuid,text),
  public.release_staff_push_delivery_claim(uuid,uuid,text,integer),
  public.complete_staff_push_delivery(uuid,uuid,text,text,text,integer)
  to service_role;

revoke all on function public.enqueue_staff_new_order_push(),
  public.revoke_staff_devices_with_admin_session()
  from public, anon, authenticated;

comment on table public.staff_push_devices is
  'Branch-scoped FCM registrations bound to one revocable cashier session.';
comment on table public.staff_push_outbox is
  'One idempotent, non-PII new-order push event per paid order.';

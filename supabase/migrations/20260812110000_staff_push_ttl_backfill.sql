-- Bound staff order notifications to their useful window and attach a newly
-- registered cashier iPad to fresh, still-unaccepted orders in its branch.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'staff_push_outbox_max_ttl_check'
      and conrelid = 'public.staff_push_outbox'::regclass
  ) then
    alter table public.staff_push_outbox
      add constraint staff_push_outbox_max_ttl_check
      check (
        expires_at > created_at
        and expires_at <= created_at + interval '15 minutes'
      );
  end if;
end
$$;

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

  -- Registration and late-order attachment commit in one transaction. The
  -- same locks used by the original function serialize installation/token
  -- swaps while keeping the session row stable for the entire operation.
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

  -- staff_push_outbox.created_at is the durable paid-transition timestamp.
  -- Only fresh, unexpired and still-unaccepted orders from this exact branch
  -- are attached. The unique delivery key makes refresh/re-registration safe.
  with attached as (
    insert into public.staff_push_deliveries(outbox_id, device_id)
    select outbox.id, v_device_id
    from public.staff_push_outbox outbox
    inner join public.kaspi_orders orders on orders.id = outbox.order_id
    where outbox.branch_id = v_branch_id
      and outbox.created_at >= now() - interval '15 minutes'
      and outbox.expires_at > now()
      and orders.branch_id = v_branch_id
      and orders.status = 'paid'
      and orders.fulfillment_status in ('pending', 'new')
      and orders.kitchen_status = 'queued'
    on conflict (outbox_id, device_id) do update set
      status = 'queued',
      attempt_count = 0,
      next_attempt_at = now(),
      locked_at = null,
      lease_token = null,
      provider_message_id = null,
      last_error = null,
      sent_at = null,
      updated_at = now()
    -- A refreshed token/session proves that a known-undelivered terminal row
    -- can be attempted again. Never replay sent, uncertain or in-flight rows.
    where staff_push_deliveries.status in ('failed', 'skipped')
    returning outbox_id
  )
  update public.staff_push_outbox outbox
  set status = case when outbox.status in ('failed', 'skipped') then 'queued'
        else outbox.status end,
      last_error = case when outbox.status in ('failed', 'skipped') then null
        else outbox.last_error end,
      updated_at = now()
  where outbox.id in (select attached.outbox_id from attached);

  return query select v_device_id, v_platform, v_installation;
end;
$$;

revoke all on function public.register_staff_push_device(text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.register_staff_push_device(text,text,text,text)
  to service_role;

comment on function public.register_staff_push_device(text,text,text,text) is
  'Registers one authorized cashier device and atomically attaches fresh unaccepted branch orders.';

-- The registration transaction can race a paid-order transaction under READ
-- COMMITTED: each could initially miss the other's row. Reconcile missing
-- pairs before every worker claim so that the race converges without replaying
-- any existing delivery, including sent/uncertain rows.
create or replace function public.claim_staff_push_deliveries_v2(
  p_limit integer default 100
)
returns table(
  delivery_id uuid, outbox_id uuid, device_id uuid, lease_token uuid,
  token text, platform text, order_id uuid, order_number bigint,
  attempt_count smallint, max_attempts smallint, expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.staff_push_deliveries(outbox_id, device_id)
  select outbox.id, device.id
  from public.staff_push_outbox outbox
  inner join public.kaspi_orders orders on orders.id = outbox.order_id
  inner join public.staff_push_devices device
    on device.branch_id = outbox.branch_id
  inner join public.admin_sessions session
    on session.jti_hash = device.session_jti_hash
  inner join public.admin_user_profiles profile
    on profile.username = session.admin_subject
  inner join public.admin_staff_credentials credential
    on credential.username = session.admin_subject
  where outbox.created_at >= now() - interval '15 minutes'
    and outbox.expires_at > now()
    and orders.branch_id = outbox.branch_id
    and orders.status = 'paid'
    and orders.fulfillment_status in ('pending', 'new')
    and orders.kitchen_status = 'queued'
    and device.active and device.revoked_at is null
    and session.revoked_at is null and session.expires_at > now()
    and session.role = 'cashier'
    and session.admin_subject = device.admin_subject
    and session.auth_version = device.auth_version
    and session.branch_ids = array[device.branch_id]
    and profile.active and profile.role = 'cashier'
    and profile.branch_ids = array[device.branch_id]
    and credential.auth_version = device.auth_version
  on conflict (outbox_id, device_id) do nothing;

  return query
  select claimed.delivery_id, claimed.outbox_id, claimed.device_id,
         claimed.lease_token, claimed.token, claimed.platform,
         claimed.order_id, claimed.order_number, claimed.attempt_count,
         claimed.max_attempts, outbox.expires_at
  from public.claim_staff_push_deliveries(p_limit) claimed
  inner join public.staff_push_outbox outbox on outbox.id = claimed.outbox_id;
end;
$$;

-- Revalidate after claim and immediately before the provider call. A kitchen
-- acceptance or expiry that wins this row lock becomes terminally skipped,
-- while a lost lease remains distinguishable to the worker.
create or replace function public.begin_staff_push_delivery_dispatch_v2(
  p_delivery_id uuid,
  p_lease_token uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox_id uuid;
  v_outbox_branch_id uuid;
  v_expires_at timestamptz;
  v_order_status text;
  v_fulfillment_status text;
  v_kitchen_status text;
  v_order_branch_id uuid;
  v_device_active boolean;
  v_device_revoked_at timestamptz;
  v_device_branch_id uuid;
  v_device_session_jti_hash text;
  v_device_admin_subject text;
  v_device_auth_version integer;
begin
  select outbox.id, outbox.branch_id, outbox.expires_at,
         orders.status, orders.fulfillment_status, orders.kitchen_status,
         orders.branch_id, device.active, device.revoked_at, device.branch_id,
         device.session_jti_hash, device.admin_subject, device.auth_version
  into v_outbox_id, v_outbox_branch_id, v_expires_at,
       v_order_status, v_fulfillment_status, v_kitchen_status,
       v_order_branch_id, v_device_active, v_device_revoked_at,
       v_device_branch_id, v_device_session_jti_hash,
       v_device_admin_subject, v_device_auth_version
  from public.staff_push_deliveries delivery
  inner join public.staff_push_outbox outbox on outbox.id = delivery.outbox_id
  inner join public.kaspi_orders orders on orders.id = outbox.order_id
  inner join public.staff_push_devices device on device.id = delivery.device_id
  where delivery.id = p_delivery_id
    and delivery.status = 'processing'
    and delivery.lease_token = p_lease_token
  for update of delivery, outbox, orders, device;

  if not found then return 'lost'; end if;

  if v_expires_at <= now()
    or v_order_status <> 'paid'
    or v_fulfillment_status not in ('pending', 'new')
    or v_kitchen_status <> 'queued'
    or v_order_branch_id is distinct from v_outbox_branch_id
    or not v_device_active
    or v_device_revoked_at is not null
    or v_device_branch_id is distinct from v_outbox_branch_id
    or not exists (
      select 1
      from public.admin_sessions session
      inner join public.admin_user_profiles profile
        on profile.username = session.admin_subject
      inner join public.admin_staff_credentials credential
        on credential.username = session.admin_subject
      where session.jti_hash = v_device_session_jti_hash
        and session.admin_subject = v_device_admin_subject
        and session.role = 'cashier'
        and session.revoked_at is null and session.expires_at > now()
        and session.auth_version = v_device_auth_version
        and session.branch_ids = array[v_device_branch_id]
        and profile.active and profile.role = 'cashier'
        and profile.branch_ids = array[v_device_branch_id]
        and credential.auth_version = v_device_auth_version
    ) then
    update public.staff_push_deliveries
    set status = 'skipped', locked_at = null, lease_token = null,
        last_error = 'Notification is no longer current', updated_at = now()
    where id = p_delivery_id
      and status = 'processing'
      and lease_token = p_lease_token;

    update public.staff_push_outbox outbox
    set status = case
          when exists (select 1 from public.staff_push_deliveries delivery
            where delivery.outbox_id = outbox.id
              and delivery.status in ('queued','retry','processing','dispatching'))
            then 'processing'
          when exists (select 1 from public.staff_push_deliveries delivery
            where delivery.outbox_id = outbox.id and delivery.status = 'uncertain')
            then 'uncertain'
          when exists (select 1 from public.staff_push_deliveries delivery
            where delivery.outbox_id = outbox.id and delivery.status = 'sent')
            then 'sent'
          when exists (select 1 from public.staff_push_deliveries delivery
            where delivery.outbox_id = outbox.id and delivery.status = 'failed')
            then 'failed'
          else 'skipped' end,
        last_error = case
          when exists (select 1 from public.staff_push_deliveries delivery
            where delivery.outbox_id = outbox.id and delivery.status = 'uncertain')
            then 'Staff push delivery outcome uncertain; automatic resend disabled'
          when exists (select 1 from public.staff_push_deliveries delivery
            where delivery.outbox_id = outbox.id and delivery.status = 'sent')
            then null
          when exists (select 1 from public.staff_push_deliveries delivery
            where delivery.outbox_id = outbox.id and delivery.status = 'failed')
            then 'Staff push delivery failed'
          else 'Notification is no longer current' end,
        updated_at = now()
    where outbox.id = v_outbox_id;
    return 'skipped';
  end if;

  update public.staff_push_deliveries
  set status = 'dispatching', locked_at = now(), updated_at = now()
  where id = p_delivery_id
    and status = 'processing'
    and lease_token = p_lease_token;
  if not found then return 'lost'; end if;
  return 'dispatching';
end;
$$;

revoke all on function public.claim_staff_push_deliveries_v2(integer),
  public.begin_staff_push_delivery_dispatch_v2(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.claim_staff_push_deliveries_v2(integer),
  public.begin_staff_push_delivery_dispatch_v2(uuid,uuid)
  to service_role;

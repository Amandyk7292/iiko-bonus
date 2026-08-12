-- Follow-up hardening after the immutable staff push TTL/alert migrations.
-- Pending is a valid unaccepted fulfillment state and must be claimable.

create index if not exists staff_push_outbox_branch_created_idx
  on public.staff_push_outbox(branch_id, created_at desc);

create index if not exists staff_order_alerts_retention_idx
  on public.staff_order_alerts(updated_at)
  where status in ('sent', 'resolved');

-- The immutable TTL migration used a bare conflict column list inside a
-- RETURNS TABLE function. `device_id` is also an output variable in PL/pgSQL,
-- making registration fail at runtime. Name the existing table constraint and
-- qualify RETURNING so late iPad enrollment works on PostgreSQL 16.
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
    on conflict on constraint staff_push_deliveries_outbox_id_device_id_key
    do update set
      status = 'queued',
      attempt_count = 0,
      next_attempt_at = now(),
      locked_at = null,
      lease_token = null,
      provider_message_id = null,
      last_error = null,
      sent_at = null,
      updated_at = now()
    where staff_push_deliveries.status in ('failed', 'skipped')
    returning staff_push_deliveries.outbox_id
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

-- `active` means the enrollment is authorized; a short heartbeat proves that
-- the kitchen app is currently present. Never expose or accept the FCM token
-- on this path.
create or replace function public.touch_staff_push_device_heartbeat(
  p_session_jti_hash text,
  p_platform text,
  p_installation_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.staff_push_devices device
  set last_seen_at = now(), updated_at = now()
  where device.session_jti_hash = p_session_jti_hash
    and device.platform = lower(btrim(coalesce(p_platform, '')))
    and device.installation_id = btrim(coalesce(p_installation_id, ''))
    and device.active and device.revoked_at is null
    and exists (
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
    );
  return found;
end;
$$;

create or replace function public.branch_has_active_staff_ipad(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.staff_push_devices device
    inner join public.admin_sessions session
      on session.jti_hash = device.session_jti_hash
    inner join public.admin_user_profiles profile
      on profile.username = session.admin_subject
    inner join public.admin_staff_credentials credential
      on credential.username = session.admin_subject
    where device.branch_id = p_branch_id
      and device.platform = 'ios'
      and device.active and device.revoked_at is null
      and device.last_seen_at >= now() - interval '90 seconds'
      and session.revoked_at is null and session.expires_at > now()
      and session.role = 'cashier'
      and session.admin_subject = device.admin_subject
      and session.auth_version = device.auth_version
      and session.branch_ids = array[device.branch_id]
      and profile.active and profile.role = 'cashier'
      and profile.branch_ids = array[device.branch_id]
      and credential.auth_version = device.auth_version
  );
$$;

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
      and orders.fulfillment_status in ('pending', 'new')
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

-- Apply the same named-conflict fix to reconciliation. Its output variables
-- include both `outbox_id` and `device_id`, so the immutable bare conflict
-- target is ambiguous before the base claim is reached.
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
  on conflict on constraint staff_push_deliveries_outbox_id_device_id_key
  do nothing;

  return query
  select claimed.delivery_id, claimed.outbox_id, claimed.device_id,
         claimed.lease_token, claimed.token, claimed.platform,
         claimed.order_id, claimed.order_number, claimed.attempt_count,
         claimed.max_attempts, outbox.expires_at
  from public.claim_staff_push_deliveries(p_limit) claimed
  inner join public.staff_push_outbox outbox on outbox.id = claimed.outbox_id;
end;
$$;

-- The outbox aggregation already prioritizes sent over failed. Keep the alert
-- trigger defensive as well: failure only means that no delivery succeeded;
-- uncertain remains an anomaly even if another device received the push.
create or replace function public.enqueue_staff_push_terminal_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_alert_type text;
begin
  if new.status in ('failed', 'uncertain')
    and old.status is distinct from new.status
    and (
      new.status = 'uncertain'
      or not exists (
        select 1
        from public.staff_push_deliveries delivery
        where delivery.outbox_id = new.id and delivery.status = 'sent'
      )
    ) then
    v_alert_type := case when new.status = 'failed'
      then 'delivery_failed' else 'delivery_uncertain' end;
    insert into public.staff_order_alerts(
      order_id, branch_id, order_number, alert_type, dedupe_key,
      event_at, next_attempt_at
    ) values (
      new.order_id, new.branch_id, new.order_number, v_alert_type,
      v_alert_type || ':' || new.order_id::text, now(), now()
    ) on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

-- Serialize coverage episodes per branch, not globally. Payment and device
-- enrollment may then commit independently; delivery reconciliation converges
-- the race, while pre-dispatch alert validation resolves a transient no-iPad
-- observation before it reaches operations.
create or replace function public.open_staff_no_ipad_alert_episode(
  p_order_id uuid,
  p_order_number bigint,
  p_branch_id uuid,
  p_event_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_episode_id uuid;
  v_alert_id uuid;
  v_existing_alert_id uuid;
begin
  if p_branch_id is null then return false; end if;
  perform pg_advisory_xact_lock(
    hashtextextended('staff-no-ipad:' || p_branch_id::text, 0)
  );
  if public.branch_has_active_staff_ipad(p_branch_id) then return false; end if;

  select episode.alert_id into v_existing_alert_id
  from public.staff_order_alert_branch_episodes episode
  where episode.branch_id = p_branch_id
    and episode.alert_type = 'no_active_ipad'
    and episode.resolved_at is null
  for update;
  if found then
    update public.staff_order_alerts
    set order_id = p_order_id, order_number = p_order_number, updated_at = now()
    where id = v_existing_alert_id
      and status in ('queued', 'config_pending', 'retry');
    return false;
  end if;

  v_episode_id := gen_random_uuid();
  v_alert_id := gen_random_uuid();
  insert into public.staff_order_alerts(
    id, order_id, branch_id, order_number, alert_type, dedupe_key,
    event_at, next_attempt_at
  ) values (
    v_alert_id, p_order_id, p_branch_id, p_order_number, 'no_active_ipad',
    'no_active_ipad:' || v_episode_id::text,
    coalesce(p_event_at, now()), now() + interval '15 seconds'
  );
  insert into public.staff_order_alert_branch_episodes(
    id, branch_id, alert_type, alert_id, opened_at
  ) values (
    v_episode_id, p_branch_id, 'no_active_ipad', v_alert_id,
    coalesce(p_event_at, now())
  );
  return true;
end;
$$;

create or replace function public.enqueue_due_staff_order_alerts(
  p_sla_seconds integer default 120
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_sla_inserted integer := 0;
  v_sla_seconds integer := least(greatest(coalesce(p_sla_seconds, 120), 60), 900);
  v_candidate record;
begin
  update public.staff_order_alert_branch_episodes episode
  set resolved_at = now(), updated_at = now()
  where episode.resolved_at is null
    and (
      public.branch_has_active_staff_ipad(episode.branch_id)
      or not exists (
        select 1
        from public.staff_push_outbox active_outbox
        inner join public.kaspi_orders active_order
          on active_order.id = active_outbox.order_id
        where active_outbox.branch_id = episode.branch_id
          and active_order.status = 'paid'
          and active_order.kitchen_status = 'queued'
          and active_order.fulfillment_status in ('pending', 'new')
      )
    );

  update public.staff_order_alerts alert
  set status = 'resolved', resolved_at = now(), locked_at = null,
      lease_token = null, last_error = null, updated_at = now()
  from public.staff_order_alert_branch_episodes episode
  where episode.alert_id = alert.id
    and episode.resolved_at is not null
    and alert.status in ('queued', 'config_pending', 'retry');

  for v_candidate in
    select distinct on (outbox.branch_id)
      outbox.order_id, outbox.order_number, outbox.branch_id, outbox.created_at
    from public.staff_push_outbox outbox
    inner join public.kaspi_orders orders on orders.id = outbox.order_id
    where orders.status = 'paid'
      and orders.kitchen_status = 'queued'
      and orders.fulfillment_status in ('pending', 'new')
      and not public.branch_has_active_staff_ipad(outbox.branch_id)
    order by outbox.branch_id, outbox.created_at
  loop
    if public.open_staff_no_ipad_alert_episode(
      v_candidate.order_id, v_candidate.order_number,
      v_candidate.branch_id, v_candidate.created_at
    ) then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  insert into public.staff_order_alerts(
    order_id, branch_id, order_number, alert_type, dedupe_key,
    event_at, next_attempt_at
  )
  select outbox.order_id, outbox.branch_id, outbox.order_number,
         'order_unaccepted', 'order_unaccepted:' || outbox.order_id::text,
         outbox.created_at + make_interval(secs => v_sla_seconds), now()
  from public.staff_push_outbox outbox
  inner join public.kaspi_orders orders on orders.id = outbox.order_id
  where outbox.created_at <= now() - make_interval(secs => v_sla_seconds)
    and orders.status = 'paid'
    and orders.kitchen_status = 'queued'
    and orders.fulfillment_status in ('pending', 'new')
  on conflict (dedupe_key) do nothing;
  get diagnostics v_sla_inserted = row_count;
  v_inserted := v_inserted + v_sla_inserted;

  update public.staff_order_alerts alert
  set status = 'resolved', resolved_at = now(), locked_at = null,
      lease_token = null, last_error = null, updated_at = now()
  from public.kaspi_orders orders
  where alert.order_id = orders.id
    and alert.status in ('queued', 'config_pending', 'retry')
    and (
      (alert.alert_type = 'order_unaccepted' and not (
        orders.status = 'paid'
        and orders.kitchen_status = 'queued'
        and orders.fulfillment_status in ('pending', 'new')
      ))
      or (alert.alert_type = 'delivery_failed' and not exists (
        select 1 from public.staff_push_outbox terminal_outbox
        where terminal_outbox.order_id = alert.order_id
          and terminal_outbox.status = 'failed'
      ))
      or (alert.alert_type = 'delivery_uncertain' and not exists (
        select 1 from public.staff_push_outbox terminal_outbox
        where terminal_outbox.order_id = alert.order_id
          and terminal_outbox.status = 'uncertain'
      ))
    );

  -- Keep the durable audit window while bounding steady-state table growth.
  -- Cleanup is deliberately capped per worker pass; branch episodes cascade
  -- through their alert foreign key and concurrent claims are skipped.
  with expired as (
    select alert.id
    from public.staff_order_alerts alert
    where alert.status in ('sent', 'resolved')
      and alert.updated_at < now() - interval '30 days'
      and not exists (
        select 1
        from public.staff_order_alert_branch_episodes active_episode
        where active_episode.alert_id = alert.id
          and active_episode.resolved_at is null
      )
    order by alert.updated_at
    for update of alert skip locked
    limit 1000
  )
  delete from public.staff_order_alerts alert
  using expired
  where alert.id = expired.id;
  return v_inserted;
end;
$$;

-- Discovery runs once at the beginning of each worker flush. Claiming and
-- per-row validation remain bounded operations and never repeat the full scan.
create or replace function public.claim_staff_order_alerts(
  p_limit integer default 50,
  p_sla_seconds integer default 120
)
returns table(
  alert_id uuid, lease_token uuid, order_id uuid, branch_id uuid, order_number bigint,
  alert_type text, event_at timestamptz, attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.staff_order_alerts alert
  set status = 'retry', locked_at = null, lease_token = null,
      next_attempt_at = now(), last_error = 'ALERT_LEASE_EXPIRED', updated_at = now()
  where alert.status = 'processing'
    and alert.locked_at < now() - interval '5 minutes';

  return query
  with candidates as (
    select alert.id
    from public.staff_order_alerts alert
    where alert.status in ('queued', 'retry', 'config_pending')
      and (alert.status = 'config_pending' or alert.next_attempt_at <= now())
    order by alert.event_at, alert.created_at
    for update of alert skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ), claimed as (
    update public.staff_order_alerts alert
    set status = 'processing', attempt_count = alert.attempt_count + 1,
        locked_at = now(), lease_token = gen_random_uuid(),
        last_error = null, updated_at = now()
    from candidates
    where alert.id = candidates.id
    returning alert.*
  )
  select claimed.id, claimed.lease_token, claimed.order_id, claimed.branch_id,
         claimed.order_number, claimed.alert_type::text,
         claimed.event_at, claimed.attempt_count
  from claimed;
end;
$$;

create or replace function public.validate_staff_order_alert_claim(
  p_alert_id uuid,
  p_lease_token uuid,
  p_sla_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alert public.staff_order_alerts%rowtype;
  v_valid boolean := false;
begin
  select * into v_alert
  from public.staff_order_alerts
  where id = p_alert_id and status = 'processing' and lease_token = p_lease_token
  for update;
  if not found then return false; end if;

  if v_alert.alert_type = 'no_active_ipad' then
    v_valid := not public.branch_has_active_staff_ipad(v_alert.branch_id)
      and exists (
        select 1 from public.staff_order_alert_branch_episodes episode
        where episode.alert_id = v_alert.id and episode.resolved_at is null
      )
      and exists (
        select 1
        from public.staff_push_outbox active_outbox
        inner join public.kaspi_orders active_order
          on active_order.id = active_outbox.order_id
        where active_outbox.branch_id = v_alert.branch_id
          and active_order.status = 'paid'
          and active_order.kitchen_status = 'queued'
          and active_order.fulfillment_status in ('pending', 'new')
      );
  elsif v_alert.alert_type = 'order_unaccepted' then
    v_valid := exists (
      select 1 from public.kaspi_orders orders
      where orders.id = v_alert.order_id
        and orders.status = 'paid'
        and orders.kitchen_status = 'queued'
        and orders.fulfillment_status in ('pending', 'new')
    );
  elsif v_alert.alert_type = 'delivery_failed' then
    v_valid := exists (
      select 1 from public.staff_push_outbox outbox
      where outbox.order_id = v_alert.order_id and outbox.status = 'failed'
    ) and not exists (
      select 1
      from public.staff_push_deliveries delivery
      inner join public.staff_push_outbox outbox on outbox.id = delivery.outbox_id
      where outbox.order_id = v_alert.order_id and delivery.status = 'sent'
    );
  elsif v_alert.alert_type = 'delivery_uncertain' then
    v_valid := exists (
      select 1 from public.staff_push_outbox outbox
      where outbox.order_id = v_alert.order_id and outbox.status = 'uncertain'
    );
  end if;

  if not v_valid then
    update public.staff_order_alerts
    set status = 'resolved', resolved_at = now(), locked_at = null,
        lease_token = null, last_error = null, updated_at = now()
    where id = v_alert.id and status = 'processing' and lease_token = p_lease_token;
  end if;
  return v_valid;
end;
$$;

-- Reconcile any rows produced while the migration was present but the alert
-- worker had not deployed. Pending false alarms become resolved before the
-- first external dispatch; active branch episodes remain deduplicated.
select public.enqueue_due_staff_order_alerts(120);

revoke all on function public.register_staff_push_device(text,text,text,text),
  public.touch_staff_push_device_heartbeat(text,text,text),
  public.branch_has_active_staff_ipad(uuid),
  public.claim_staff_push_deliveries(integer),
  public.claim_staff_push_deliveries_v2(integer),
  public.enqueue_staff_push_terminal_alert(),
  public.open_staff_no_ipad_alert_episode(uuid,bigint,uuid,timestamptz),
  public.enqueue_due_staff_order_alerts(integer),
  public.claim_staff_order_alerts(integer,integer),
  public.validate_staff_order_alert_claim(uuid,uuid,integer)
from public, anon, authenticated;
grant execute on function public.register_staff_push_device(text,text,text,text),
  public.touch_staff_push_device_heartbeat(text,text,text),
  public.branch_has_active_staff_ipad(uuid),
  public.claim_staff_push_deliveries(integer),
  public.claim_staff_push_deliveries_v2(integer),
  public.enqueue_due_staff_order_alerts(integer),
  public.claim_staff_order_alerts(integer,integer),
  public.validate_staff_order_alert_claim(uuid,uuid,integer)
to service_role;

comment on function public.claim_staff_push_deliveries(integer) is
  'Claims authorized unaccepted staff orders in pending or new fulfillment state.';

comment on function public.touch_staff_push_device_heartbeat(text,text,text) is
  'Records current authorized kitchen presence without accepting or exposing a push token.';

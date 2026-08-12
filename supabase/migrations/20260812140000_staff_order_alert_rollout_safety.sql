-- Rollout safety for recent-heartbeat coverage and repeat terminal incidents.

alter table public.staff_push_outbox
  add column if not exists terminal_alert_episode bigint not null default 0
    check (terminal_alert_episode >= 0);

-- The sequence is stored on the outbox row and advances in the same
-- transaction as a real non-terminal -> terminal transition. A retry of that
-- transaction therefore reuses its committed state instead of inventing a
-- time-based dedupe key, while a later requeue/failure opens a new episode.
create or replace function public.enqueue_staff_push_terminal_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alert_type text;
  v_episode bigint;
begin
  if new.status in ('failed', 'uncertain')
    and old.status not in ('failed', 'uncertain')
    and (
      new.status = 'uncertain'
      or not exists (
        select 1
        from public.staff_push_deliveries delivery
        where delivery.outbox_id = new.id and delivery.status = 'sent'
      )
    ) then
    v_episode := old.terminal_alert_episode + 1;
    new.terminal_alert_episode := v_episode;
    v_alert_type := case when new.status = 'failed'
      then 'delivery_failed' else 'delivery_uncertain' end;
    insert into public.staff_order_alerts(
      order_id, branch_id, order_number, alert_type, dedupe_key,
      event_at, next_attempt_at
    ) values (
      new.order_id, new.branch_id, new.order_number, v_alert_type,
      'terminal:' || new.id::text || ':' || v_episode::text,
      now(), now()
    ) on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_push_outbox_enqueue_terminal_alert
  on public.staff_push_outbox;
create trigger staff_push_outbox_enqueue_terminal_alert
before update of status on public.staff_push_outbox
for each row execute function public.enqueue_staff_push_terminal_alert();

-- Snapshot only devices whose cashier authorization is fully current for the
-- exact order branch. A stale `active=true` flag alone must never create a
-- delivery row or make an invalid session look like staff coverage.
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
      inner join public.admin_sessions session
        on session.jti_hash = device.session_jti_hash
      inner join public.admin_user_profiles profile
        on profile.username = session.admin_subject
      inner join public.admin_staff_credentials credential
        on credential.username = session.admin_subject
      where device.branch_id = new.branch_id
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
    end if;
  end if;
  return new;
end;
$$;

-- Preserve delivery history while removing obsolete provider credentials.
-- A per-row tombstone satisfies token length/uniqueness constraints and is
-- replaced normally if the same installation later registers again. Work is
-- bounded so one periodic alert scan cannot turn into unbounded maintenance.
create or replace function public.sanitize_stale_staff_push_devices(
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_sanitized integer := 0;
begin
  with candidates as (
    select device.id
    from public.staff_push_devices device
    where (
        device.active and (
          device.revoked_at is not null
          or not exists (
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
          )
        )
      )
      or (
        not device.active
        and (
          device.revoked_at is null
          or device.token <> 'staff-device-revoked:' || device.id::text
        )
      )
    order by device.updated_at, device.id
    for update of device skip locked
    limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
  ), sanitized as (
    update public.staff_push_devices device
    set active = false,
        revoked_at = coalesce(device.revoked_at, now()),
        token = 'staff-device-revoked:' || device.id::text,
        updated_at = now()
    from candidates
    where device.id = candidates.id
    returning device.id
  )
  select count(*)::integer into v_sanitized from sanitized;
  return v_sanitized;
end;
$$;

-- Existing fully authorized iOS registrations predate the visible heartbeat
-- route. Give them one 90-second rollout window so the application can send
-- its first 30-second heartbeat before coverage enforcement starts.
update public.staff_push_devices device
set last_seen_at = now(), updated_at = now()
where device.platform = 'ios'
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

-- Rows discovered by the immediately preceding hardening migration used the
-- oldest order time. Rebase only still-undelivered rollout observations; sent
-- incident history is immutable. The following reconciliation resolves the
-- rebased row when the grace enrollment above covers its branch.
update public.staff_order_alerts alert
set event_at = now(), next_attempt_at = now() + interval '15 seconds',
    updated_at = now()
from public.staff_order_alert_branch_episodes episode
where episode.alert_id = alert.id
  and episode.resolved_at is null
  and alert.alert_type = 'no_active_ipad'
  and alert.status in ('queued', 'config_pending', 'retry');

update public.staff_order_alert_branch_episodes episode
set opened_at = alert.event_at, updated_at = now()
from public.staff_order_alerts alert
where alert.id = episode.alert_id
  and episode.resolved_at is null
  and alert.alert_type = 'no_active_ipad'
  and alert.status in ('queued', 'config_pending', 'retry');

-- Coverage loss happens when the periodic worker detects a missing recent
-- heartbeat, not when the oldest still-open order was paid. Use detection time
-- for the no-iPad incident so a healthy old order does not create an instantly
-- stale operational backlog after its device disconnects.
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
  perform public.sanitize_stale_staff_push_devices(1000);

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
      outbox.order_id, outbox.order_number, outbox.branch_id
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
      v_candidate.branch_id, now()
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

  -- A new terminal transition supersedes an older unsent episode even when
  -- both transitions end in the same outbox status. Legacy order-based keys
  -- from the immutable rollout remain governed by the status checks above.
  update public.staff_order_alerts alert
  set status = 'resolved', resolved_at = now(), locked_at = null,
      lease_token = null, last_error = null, updated_at = now()
  from public.staff_push_outbox terminal_outbox
  where terminal_outbox.order_id = alert.order_id
    and alert.status in ('queued', 'config_pending', 'retry')
    and alert.dedupe_key like 'terminal:%'
    and alert.dedupe_key <> 'terminal:' || terminal_outbox.id::text || ':'
      || terminal_outbox.terminal_alert_episode::text;

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
      where outbox.order_id = v_alert.order_id
        and outbox.status = 'failed'
        and (
          v_alert.dedupe_key not like 'terminal:%'
          or v_alert.dedupe_key = 'terminal:' || outbox.id::text || ':'
            || outbox.terminal_alert_episode::text
        )
    ) and not exists (
      select 1
      from public.staff_push_deliveries delivery
      inner join public.staff_push_outbox outbox on outbox.id = delivery.outbox_id
      where outbox.order_id = v_alert.order_id and delivery.status = 'sent'
    );
  elsif v_alert.alert_type = 'delivery_uncertain' then
    v_valid := exists (
      select 1 from public.staff_push_outbox outbox
      where outbox.order_id = v_alert.order_id
        and outbox.status = 'uncertain'
        and (
          v_alert.dedupe_key not like 'terminal:%'
          or v_alert.dedupe_key = 'terminal:' || outbox.id::text || ':'
            || outbox.terminal_alert_episode::text
        )
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

-- Normalize pre-heartbeat no-device observations while the grace timestamp is
-- current. This never sends an external alert and leaves terminal/SLA rows
-- durable for the worker.
select public.enqueue_due_staff_order_alerts(120);

revoke all on function public.enqueue_staff_push_terminal_alert(),
  public.enqueue_staff_new_order_push(),
  public.sanitize_stale_staff_push_devices(integer),
  public.enqueue_due_staff_order_alerts(integer),
  public.validate_staff_order_alert_claim(uuid,uuid,integer)
from public, anon, authenticated;
grant execute on function public.sanitize_stale_staff_push_devices(integer),
  public.enqueue_due_staff_order_alerts(integer),
  public.validate_staff_order_alert_claim(uuid,uuid,integer)
to service_role;

comment on column public.staff_push_outbox.terminal_alert_episode is
  'Monotonic durable sequence for real terminal alert transitions on this outbox row.';

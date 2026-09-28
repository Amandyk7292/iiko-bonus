begin;
alter table public.kaspi_orders
 add column acceptance_watch_started_at timestamptz,
 add column acceptance_reminded_at timestamptz,
 add column acceptance_escalated_at timestamptz,
 add column courier_search_started_at timestamptz,
 add column courier_timeout_at timestamptz,
 add column courier_timeout_retry_at timestamptz;

create function public.order_acceptance_start(p_requested timestamptz,p_type text,p_scheduled timestamptz,p_preparation integer)
returns timestamptz language sql immutable set search_path=public,pg_temp as $$
 select case when p_requested is null then null when p_type='preorder' and p_scheduled is not null
 then greatest(p_requested,p_scheduled-make_interval(mins=>greatest(1,coalesce(p_preparation,30)))) else p_requested end;
$$;

create function public.track_order_waiting_clocks() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 new.acceptance_watch_started_at:=public.order_acceptance_start(new.staff_acceptance_requested_at,new.fulfillment_type,coalesce(new.scheduled_at,new.pickup_time),new.preparation_minutes);
 if new.courier_timeout_at is not null and old.courier_timeout_at is not null
   and new.courier_id is distinct from old.courier_id and new.courier_id is not null then
  raise exception 'COURIER_TIMEOUT_CANCELLATION_IN_PROGRESS';
 end if;
 if old.courier_timeout_at is not null and new.courier_timeout_at is not null
 and new.courier_dispatch_status='processing'
 and (new.courier_dispatch_status is distinct from old.courier_dispatch_status
 or new.courier_dispatch_attempted_at is distinct from old.courier_dispatch_attempted_at) then
  raise exception 'COURIER_TIMEOUT_CANCELLATION_IN_PROGRESS';
 end if;
 if new.courier_search_started_at is null and new.status='paid'
  and (new.fulfillment_type='delivery' or (new.fulfillment_type='preorder' and new.preorder_fulfillment_type='delivery'))
  and new.courier_dispatch_status in('processing','succeeded','failed') and new.courier_dispatch_attempted_at is not null
 then new.courier_search_started_at:=new.courier_dispatch_attempted_at; end if;
 if new.courier_timeout_at is null and new.courier_id is null and new.courier_assigned_at is null
  and new.courier_dispatch_status in('awaiting_confirmation','awaiting_receipt') then new.courier_search_started_at:=null; end if;
 return new;
end $$;
create trigger track_order_waiting_clocks before insert or update on public.kaspi_orders
 for each row execute function public.track_order_waiting_clocks();
-- Preserve historical orders. Only their original timestamps determine elapsed time.
update public.kaspi_orders set acceptance_watch_started_at=public.order_acceptance_start(staff_acceptance_requested_at,fulfillment_type,coalesce(scheduled_at,pickup_time),preparation_minutes)
 where status='paid' and fulfillment_status not in('completed','cancelled');

create index order_acceptance_watch_due on public.kaspi_orders(acceptance_watch_started_at)
 where status='paid' and fulfillment_status in('new','pending');
create index order_courier_watch_due on public.kaspi_orders(courier_search_started_at)
 where status='paid' and courier_assigned_at is null;

create or replace function public.enqueue_staff_push_reminder() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare started timestamptz;
begin
 update public.kaspi_orders set staff_acceptance_requested_at=new.created_at
 where id=new.order_id and staff_acceptance_requested_at is null;
 select acceptance_watch_started_at into started from public.kaspi_orders where id=new.order_id;
 if started is not null then
  insert into public.staff_push_reminder_outbox(source_outbox_id,order_id,branch_id,order_number,due_at,expires_at)
  values(new.id,new.order_id,new.branch_id,new.order_number,started+interval '3 minutes',started+interval '10 minutes')
  on conflict(source_outbox_id) do nothing;
 end if;
 return new;
end $$;
-- One reminder at three minutes. Provider retries still use the existing leased outbox.
create or replace function public.rearm_staff_push_reminders() returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin return; end $$;
update public.staff_push_reminder_outbox r set due_at=o.acceptance_watch_started_at+interval '3 minutes',
 expires_at=o.acceptance_watch_started_at+interval '10 minutes'
 from public.kaspi_orders o where o.id=r.order_id and r.status='queued' and r.snapshotted_at is null
 and o.acceptance_watch_started_at is not null;

create function public.claim_order_waiting_notices() returns table(order_id uuid,order_number bigint,branch_id uuid,stage integer)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return query with due as (
 select o.id from public.kaspi_orders o where o.status='paid' and o.refund_status is null
 and o.fulfillment_status in('new','pending') and o.acceptance_watch_started_at<=now()-interval '3 minutes'
 and o.acceptance_watch_started_at>now()-interval '10 minutes' and o.acceptance_reminded_at is null
 order by o.acceptance_watch_started_at for update skip locked limit 100
 ) update public.kaspi_orders o set acceptance_reminded_at=now() from due where o.id=due.id
 returning o.id,o.order_number,o.branch_id,3;
 return query with due as (
 select o.id from public.kaspi_orders o where o.status='paid' and o.refund_status is null
 and o.fulfillment_status in('new','pending') and o.acceptance_watch_started_at<=now()-interval '5 minutes'
 and o.acceptance_watch_started_at>now()-interval '10 minutes' and o.acceptance_escalated_at is null
 order by o.acceptance_watch_started_at for update skip locked limit 100
 ) update public.kaspi_orders o set acceptance_escalated_at=now() from due where o.id=due.id
 returning o.id,o.order_number,o.branch_id,5;
end $$;

create function public.claim_courier_timeout(p_order uuid,p_before timestamptz) returns setof public.kaspi_orders
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.kaspi_orders o set courier_timeout_at=null
 where o.id=p_order and o.courier_timeout_at is not null and o.refund_status is null
 and (o.courier_id is not null or o.courier_assigned_at is not null or o.fulfillment_status not in('accepted','preparing','ready'));
 return query update public.kaspi_orders o set courier_timeout_at=coalesce(o.courier_timeout_at,now()),courier_timeout_retry_at=now()+interval '1 minute'
 where o.id=p_order and o.status='paid' and o.refund_status is null
 and (o.fulfillment_type='delivery' or (o.fulfillment_type='preorder' and o.preorder_fulfillment_type='delivery'))
 and o.fulfillment_status in('accepted','preparing','ready') and o.courier_id is null and o.courier_assigned_at is null
 and coalesce(o.delivery_status,'unassigned') in('unassigned','cancelled')
 and o.courier_search_started_at<=p_before
 and not exists(select 1 from public.delivery_jobs j where j.order_id=o.id and
   (j.internal_status in('assigned','picked_up','en_route','delivered') or nullif(j.courier_name,'') is not null or nullif(j.courier_phone,'') is not null))
 and (o.courier_timeout_retry_at is null or o.courier_timeout_retry_at<=now())
 returning o.*;
end $$;

create function public.guard_courier_timeout_job() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare timed_out timestamptz;
begin
 select courier_timeout_at into timed_out from public.kaspi_orders where id=new.order_id for update;
 if timed_out is not null and (tg_op='INSERT' or new.provider_status in('creating','creating_uncertain')) then raise exception 'COURIER_TIMEOUT_CANCELLATION_IN_PROGRESS'; end if;
 return new;
end $$;
create trigger guard_courier_timeout_job before insert or update of provider_status on public.delivery_jobs
 for each row execute function public.guard_courier_timeout_job();

revoke all on function public.order_acceptance_start(timestamptz,text,timestamptz,integer),public.claim_order_waiting_notices(),public.claim_courier_timeout(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.order_acceptance_start(timestamptz,text,timestamptz,integer),public.claim_order_waiting_notices(),public.claim_courier_timeout(uuid,timestamptz) to service_role;
create or replace function public.claim_staff_push_reminder_deliveries(
  p_limit integer default 100
)
returns table(
  delivery_id uuid, reminder_id uuid, device_id uuid, lease_token uuid,
  token text, platform text, order_id uuid, order_number bigint,
  reminder_sequence integer, attempt_count smallint, max_attempts smallint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reminder record;
begin
  perform public.rearm_staff_push_reminders();
  update public.staff_push_reminder_deliveries delivery
  set status = case when delivery.attempt_count >= delivery.max_attempts
        then 'failed' else 'retry' end,
      locked_at = null, lease_token = null, next_attempt_at = now(),
      last_error = 'Reminder delivery lease expired', updated_at = now()
  where delivery.status = 'processing'
    and delivery.locked_at < now() - interval '5 minutes';

  update public.staff_push_reminder_deliveries
  set status = 'uncertain', locked_at = null, lease_token = null,
      last_error = 'Reminder outcome uncertain; automatic resend disabled',
      updated_at = now()
  where status = 'dispatching' and locked_at < now() - interval '5 minutes';

  update public.staff_push_reminder_outbox reminder
  set status = 'skipped', snapshotted_at = coalesce(snapshotted_at, now()),
      last_error = 'Reminder is no longer current', updated_at = now()
  from public.kaspi_orders orders
  where orders.id = reminder.order_id
    and reminder.status in ('queued', 'processing')
    and reminder.snapshotted_at is null
    and (
      reminder.expires_at <= now()
      or orders.status <> 'paid'
      or orders.kitchen_status <> 'queued'
      or orders.fulfillment_status not in ('pending', 'new')
    );

  -- Lease expiry, authorization loss, acceptance and expiry can terminate
  -- deliveries without passing through complete_staff_push_reminder_delivery.
  -- Recompute every snapshotted parent touched by those terminal rows so a
  -- reminder cannot remain processing forever.
  update public.staff_push_reminder_outbox reminder
  set status = case
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id
            and delivery.status in ('queued','retry','processing','dispatching')
        ) then 'processing'
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id and delivery.status = 'uncertain'
        ) then 'uncertain'
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id and delivery.status = 'sent'
        ) then 'sent'
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id and delivery.status = 'failed'
        ) then 'failed'
        else 'skipped' end,
      sent_at = case when exists (
        select 1 from public.staff_push_reminder_deliveries delivery
        where delivery.reminder_id = reminder.id and delivery.status = 'sent'
      ) then coalesce(reminder.sent_at, now()) else reminder.sent_at end,
      last_error = case
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id and delivery.status = 'uncertain'
        ) then 'Reminder delivery outcome uncertain; automatic resend disabled'
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id and delivery.status = 'failed'
        ) then 'Staff reminder delivery failed'
        else reminder.last_error end,
      updated_at = now()
  where reminder.snapshotted_at is not null
    and reminder.status in ('queued', 'processing')
    and not exists (
      select 1 from public.staff_push_reminder_deliveries delivery
      where delivery.reminder_id = reminder.id
        and delivery.status in ('queued','retry','processing','dispatching')
    );

  -- Snapshot recipients exactly once at the first due scan. Late enrollment
  -- still receives the original fresh-order push, but never an immediate
  -- duplicate reminder.
  for v_reminder in
    select reminder.id, reminder.branch_id
    from public.staff_push_reminder_outbox reminder
    inner join public.kaspi_orders orders on orders.id = reminder.order_id
    where reminder.status = 'queued'
      and reminder.snapshotted_at is null
      and reminder.due_at <= now() and reminder.expires_at > now()
      and orders.status = 'paid'
      and orders.kitchen_status = 'queued'
      and orders.fulfillment_status in ('pending', 'new')
    order by reminder.due_at, reminder.created_at
    for update of reminder skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  loop
    update public.staff_push_reminder_outbox
    set snapshotted_at = now(), status = 'processing', updated_at = now()
    where id = v_reminder.id and snapshotted_at is null;

    insert into public.staff_push_reminder_deliveries(reminder_id, device_id)
    select v_reminder.id, device.id
    from public.staff_push_devices device
    inner join public.admin_sessions session
      on session.jti_hash = device.session_jti_hash
    inner join public.admin_user_profiles profile
      on profile.username = session.admin_subject
    inner join public.admin_staff_credentials credential
      on credential.username = session.admin_subject
    where device.branch_id = v_reminder.branch_id
      and device.platform in ('ios', 'android')
      and device.active and device.revoked_at is null
      and session.revoked_at is null and session.expires_at > now()
      and session.role = 'cashier'
      and session.admin_subject = device.admin_subject
      and session.auth_version = device.auth_version
      and session.branch_ids = array[device.branch_id]
      and profile.active and profile.role = 'cashier'
      and profile.branch_ids = array[device.branch_id]
      and credential.auth_version = device.auth_version
    on conflict on constraint
      staff_push_reminder_deliveries_reminder_id_device_id_key
    do nothing;

    perform public.refresh_staff_push_reminder_outbox(v_reminder.id);
  end loop;

  update public.staff_push_reminder_deliveries delivery
  set status = 'skipped', locked_at = null, lease_token = null,
      last_error = 'Reminder is no longer current', updated_at = now()
  from public.staff_push_reminder_outbox reminder
  inner join public.kaspi_orders orders on orders.id = reminder.order_id
  where delivery.reminder_id = reminder.id
    and delivery.status in ('queued', 'retry')
    and (
      reminder.expires_at <= now()
      or orders.status <> 'paid'
      or orders.kitchen_status <> 'queued'
      or orders.fulfillment_status not in ('pending', 'new')
    );

  update public.staff_push_reminder_deliveries delivery
  set status = 'skipped', locked_at = null, lease_token = null,
      last_error = 'Staff device is no longer active', updated_at = now()
  from public.staff_push_reminder_outbox reminder,
       public.staff_push_devices device
  where delivery.reminder_id = reminder.id
    and delivery.device_id = device.id
    and delivery.status in ('queued', 'retry')
    and (
      device.platform not in ('ios', 'android')
      or not device.active
      or device.revoked_at is not null
      or device.branch_id <> reminder.branch_id
      or not exists (
        select 1 from public.admin_sessions session
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
    );

  update public.staff_push_reminder_outbox reminder
  set status = case
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id
            and delivery.status in ('queued','retry','processing','dispatching')
        ) then 'processing'
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id and delivery.status = 'uncertain'
        ) then 'uncertain'
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id and delivery.status = 'sent'
        ) then 'sent'
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id and delivery.status = 'failed'
        ) then 'failed'
        else 'skipped' end,
      sent_at = case when exists (
        select 1 from public.staff_push_reminder_deliveries delivery
        where delivery.reminder_id = reminder.id and delivery.status = 'sent'
      ) then coalesce(reminder.sent_at, now()) else reminder.sent_at end,
      last_error = case
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id and delivery.status = 'uncertain'
        ) then 'Reminder delivery outcome uncertain; automatic resend disabled'
        when exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id and delivery.status = 'failed'
        ) then 'Staff reminder delivery failed'
        else reminder.last_error end,
      updated_at = now()
  where reminder.snapshotted_at is not null
    and reminder.status in ('queued', 'processing')
    and not exists (
      select 1 from public.staff_push_reminder_deliveries delivery
      where delivery.reminder_id = reminder.id
        and delivery.status in ('queued','retry','processing','dispatching')
    );

  return query
  with candidates as (
    select delivery.id
    from public.staff_push_reminder_deliveries delivery
    inner join public.staff_push_reminder_outbox reminder
      on reminder.id = delivery.reminder_id
    inner join public.kaspi_orders orders on orders.id = reminder.order_id
    inner join public.staff_push_devices device on device.id = delivery.device_id
    inner join public.admin_sessions session
      on session.jti_hash = device.session_jti_hash
    inner join public.admin_user_profiles profile
      on profile.username = session.admin_subject
    inner join public.admin_staff_credentials credential
      on credential.username = session.admin_subject
    where delivery.status in ('queued', 'retry')
      and delivery.next_attempt_at <= now()
      and delivery.attempt_count < delivery.max_attempts
      and reminder.snapshotted_at is not null
      and reminder.expires_at > now()
      and orders.status = 'paid'
      and orders.kitchen_status = 'queued'
      and orders.fulfillment_status in ('pending', 'new')
      and device.platform in ('ios', 'android')
      and device.active and device.revoked_at is null
      and device.branch_id = reminder.branch_id
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
    update public.staff_push_reminder_deliveries delivery
    set status = 'processing', attempt_count = delivery.attempt_count + 1,
        locked_at = now(), lease_token = gen_random_uuid(), updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select claimed.id, claimed.reminder_id, claimed.device_id, claimed.lease_token,
         device.token, device.platform::text, reminder.order_id,
         reminder.order_number, reminder.reminder_sequence,
         claimed.attempt_count, claimed.max_attempts, reminder.expires_at
  from claimed
  inner join public.staff_push_devices device on device.id = claimed.device_id
  inner join public.staff_push_reminder_outbox reminder
    on reminder.id = claimed.reminder_id;
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
         orders.acceptance_watch_started_at + interval '5 minutes', now()
  from public.staff_push_outbox outbox
  inner join public.kaspi_orders orders on orders.id = outbox.order_id
  where orders.acceptance_watch_started_at <= now() - interval '5 minutes'
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
commit;

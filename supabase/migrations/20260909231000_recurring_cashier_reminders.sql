-- Repeat reminders only for paid, unaccepted orders. Each cycle is leased and
-- revalidates branch, session, device and order immediately before provider dispatch.
-- migration-safety: allow-destructive reason=replace single-reminder constraint and RPC return type for recurring reminders without deleting notification rows
alter table public.staff_push_reminder_outbox drop constraint if exists staff_push_reminder_outbox_reminder_sequence_check;
alter table public.staff_push_reminder_outbox alter column reminder_sequence type integer;
alter table public.staff_push_reminder_outbox add constraint staff_push_reminder_sequence_positive check(reminder_sequence > 0);

create or replace function public.rearm_staff_push_reminders()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare reminder record;
begin
  for reminder in
    select r.id from public.staff_push_reminder_outbox r
    join public.kaspi_orders o on o.id = r.order_id
    where r.status in ('sent', 'skipped', 'failed', 'uncertain')
      and r.updated_at <= now() - interval '3 seconds'
      and o.status = 'paid' and o.kitchen_status = 'queued'
      and o.fulfillment_status in ('pending', 'new')
      and not exists(select 1 from public.staff_push_reminder_deliveries d
        where d.reminder_id = r.id and d.status in ('processing', 'dispatching'))
    order by r.updated_at for update of r skip locked limit 200
  loop
    update public.staff_push_reminder_outbox set status = 'queued',
      reminder_sequence = reminder_sequence + 1, due_at = now(),
      expires_at = now() + interval '15 seconds', snapshotted_at = null,
      sent_at = null, last_error = null, updated_at = now()
      where id = reminder.id;
    update public.staff_push_reminder_deliveries set status = 'queued',
      attempt_count = 0, next_attempt_at = now(), locked_at = null, lease_token = null,
      provider_message_id = null, sent_at = null, last_error = null, updated_at = now()
      where reminder_id = reminder.id;
  end loop;
end;
$$;
revoke all on function public.rearm_staff_push_reminders() from public, anon, authenticated;
grant execute on function public.rearm_staff_push_reminders() to service_role;

create or replace function public.enqueue_staff_push_reminder()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.kaspi_orders
  set staff_acceptance_requested_at = new.created_at
  where id = new.order_id and staff_acceptance_requested_at is null;

  if new.expires_at > new.created_at + interval '3 seconds' then
    insert into public.staff_push_reminder_outbox(
      source_outbox_id, order_id, branch_id, order_number,
      due_at, expires_at
    ) values (
      new.id, new.order_id, new.branch_id, new.order_number,
      new.created_at + interval '3 seconds', new.created_at + interval '18 seconds'
    ) on conflict (source_outbox_id) do nothing;
  end if;
  return new;
end;
$$;

drop function public.claim_staff_push_reminder_deliveries(integer);
create function public.claim_staff_push_reminder_deliveries(
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
      and device.platform = 'ios'
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
      last_error = 'Staff iPad is no longer active', updated_at = now()
  from public.staff_push_reminder_outbox reminder,
       public.staff_push_devices device
  where delivery.reminder_id = reminder.id
    and delivery.device_id = device.id
    and delivery.status in ('queued', 'retry')
    and (
      device.platform <> 'ios'
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
      and device.platform = 'ios'
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
revoke all on function public.claim_staff_push_reminder_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_staff_push_reminder_deliveries(integer) to service_role;

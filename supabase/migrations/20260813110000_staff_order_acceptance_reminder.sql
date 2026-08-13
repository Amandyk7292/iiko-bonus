-- Explicit kitchen acceptance audit plus one durable sixty-second reminder.
-- The reminder is deliberately separate from the first-push outbox: both
-- messages need independent provider ids/dedupe keys and delivery histories.

alter table public.kaspi_orders
  add column if not exists staff_acceptance_requested_at timestamptz,
  add column if not exists staff_accepted_at timestamptz,
  add column if not exists staff_accepted_by varchar(160),
  add column if not exists staff_accepted_session_jti_hash varchar(64),
  add column if not exists staff_accepted_installation_id varchar(160);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_staff_accepted_session_hash_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_staff_accepted_session_hash_check
      check (
        staff_accepted_session_jti_hash is null
        or staff_accepted_session_jti_hash ~ '^[0-9a-f]{64}$'
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_staff_accepted_installation_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_staff_accepted_installation_check
      check (
        staff_accepted_installation_id is null
        or staff_accepted_installation_id ~ '^[A-Za-z0-9._:-]{8,160}$'
      );
  end if;
end
$$;

-- For orders covered by the durable staff-push rollout, this is the exact
-- paid-transition timestamp already persisted in the first-push outbox.
update public.kaspi_orders orders
set staff_acceptance_requested_at = outbox.created_at
from public.staff_push_outbox outbox
where outbox.order_id = orders.id
  and orders.staff_acceptance_requested_at is null;

create or replace function public.maintain_staff_order_acceptance_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.staff_acceptance_requested_at is not null
    and new.staff_acceptance_requested_at is distinct from old.staff_acceptance_requested_at then
    raise exception 'staff acceptance request timestamp is immutable';
  end if;
  if old.staff_accepted_at is not null and (
    new.staff_accepted_at is distinct from old.staff_accepted_at
    or new.staff_accepted_by is distinct from old.staff_accepted_by
    or new.staff_accepted_session_jti_hash
      is distinct from old.staff_accepted_session_jti_hash
    or new.staff_accepted_installation_id
      is distinct from old.staff_accepted_installation_id
  ) then
    raise exception 'staff acceptance audit is immutable';
  end if;

  if old.kitchen_status = 'queued' and new.kitchen_status = 'preparing' then
    new.staff_accepted_at := coalesce(new.staff_accepted_at, now());
  elsif new.staff_accepted_at is distinct from old.staff_accepted_at
    or new.staff_accepted_by is distinct from old.staff_accepted_by
    or new.staff_accepted_session_jti_hash
      is distinct from old.staff_accepted_session_jti_hash
    or new.staff_accepted_installation_id
      is distinct from old.staff_accepted_installation_id then
    raise exception 'staff acceptance audit requires queued to preparing transition';
  end if;
  return new;
end;
$$;

drop trigger if exists kaspi_orders_maintain_staff_acceptance_audit
  on public.kaspi_orders;
create trigger kaspi_orders_maintain_staff_acceptance_audit
before insert or update of status, kitchen_status,
  staff_acceptance_requested_at, staff_accepted_at, staff_accepted_by,
  staff_accepted_session_jti_hash, staff_accepted_installation_id
on public.kaspi_orders
for each row execute function public.maintain_staff_order_acceptance_audit();

create table if not exists public.staff_push_reminder_outbox (
  id uuid primary key default gen_random_uuid(),
  source_outbox_id uuid not null unique
    references public.staff_push_outbox(id) on delete cascade,
  order_id uuid not null unique
    references public.kaspi_orders(id) on delete cascade,
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  order_number bigint not null,
  reminder_sequence smallint not null default 1 check (reminder_sequence = 1),
  status varchar(16) not null default 'queued'
    check (status in ('queued', 'processing', 'sent', 'failed', 'skipped', 'uncertain')),
  due_at timestamptz not null,
  expires_at timestamptz not null,
  snapshotted_at timestamptz,
  sent_at timestamptz,
  last_error varchar(500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_push_reminder_outbox_window_check check (
    expires_at > due_at and expires_at <= due_at + interval '14 minutes'
  )
);

create index if not exists staff_push_reminder_outbox_due_idx
  on public.staff_push_reminder_outbox(status, due_at, expires_at)
  where status in ('queued', 'processing');

create table if not exists public.staff_push_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null
    references public.staff_push_reminder_outbox(id) on delete cascade,
  device_id uuid not null references public.staff_push_devices(id) on delete cascade,
  status varchar(16) not null default 'queued'
    check (status in (
      'queued', 'processing', 'dispatching', 'retry',
      'sent', 'failed', 'skipped', 'uncertain'
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
  unique(reminder_id, device_id)
);

create index if not exists staff_push_reminder_deliveries_pending_idx
  on public.staff_push_reminder_deliveries(status, next_attempt_at, created_at)
  where status in ('queued', 'processing', 'dispatching', 'retry');

alter table public.staff_push_reminder_outbox enable row level security;
alter table public.staff_push_reminder_deliveries enable row level security;

drop policy if exists service_role_all_staff_push_reminder_outbox
  on public.staff_push_reminder_outbox;
create policy service_role_all_staff_push_reminder_outbox
  on public.staff_push_reminder_outbox
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all_staff_push_reminder_deliveries
  on public.staff_push_reminder_deliveries;
create policy service_role_all_staff_push_reminder_deliveries
  on public.staff_push_reminder_deliveries
  for all to service_role using (true) with check (true);

revoke all on public.staff_push_reminder_outbox,
  public.staff_push_reminder_deliveries from public, anon, authenticated;
grant all on public.staff_push_reminder_outbox,
  public.staff_push_reminder_deliveries to service_role;

-- Feed terminal reminder outcomes into the existing durable operations queue.
-- migration-safety: allow-destructive reason=replace staff alert type check to add reminder terminal incidents without deleting rows
alter table public.staff_order_alerts
  drop constraint if exists staff_order_alerts_alert_type_check;
alter table public.staff_order_alerts
  add constraint staff_order_alerts_alert_type_check
  check (alert_type in (
    'no_active_ipad', 'delivery_failed', 'delivery_uncertain', 'order_unaccepted',
    'yandex_price_overrun', 'yandex_items_unresolved', 'yandex_create_uncertain',
    'reminder_delivery_failed', 'reminder_delivery_uncertain'
  ));

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

  if new.expires_at > new.created_at + interval '60 seconds' then
    insert into public.staff_push_reminder_outbox(
      source_outbox_id, order_id, branch_id, order_number,
      due_at, expires_at
    ) values (
      new.id, new.order_id, new.branch_id, new.order_number,
      new.created_at + interval '60 seconds', new.expires_at
    ) on conflict (source_outbox_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_push_outbox_enqueue_reminder
  on public.staff_push_outbox;
create trigger staff_push_outbox_enqueue_reminder
after insert on public.staff_push_outbox
for each row execute function public.enqueue_staff_push_reminder();

-- Safely cover still-current orders created between the first-push and this
-- migration. Expired/accepted work is intentionally not resurrected.
insert into public.staff_push_reminder_outbox(
  source_outbox_id, order_id, branch_id, order_number, due_at, expires_at
)
select outbox.id, outbox.order_id, outbox.branch_id, outbox.order_number,
       outbox.created_at + interval '60 seconds', outbox.expires_at
from public.staff_push_outbox outbox
inner join public.kaspi_orders orders on orders.id = outbox.order_id
where outbox.expires_at > greatest(now(), outbox.created_at + interval '60 seconds')
  and orders.status = 'paid'
  and orders.kitchen_status = 'queued'
  and orders.fulfillment_status in ('pending', 'new')
on conflict (source_outbox_id) do nothing;

create or replace function public.refresh_staff_push_reminder_outbox(
  p_reminder_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
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
        when not exists (
          select 1 from public.staff_push_reminder_deliveries delivery
          where delivery.reminder_id = reminder.id
        ) then 'No active staff iPad at reminder time'
        else null end,
      updated_at = now()
  where reminder.id = p_reminder_id and reminder.snapshotted_at is not null;
end;
$$;

create or replace function public.claim_staff_push_reminder_deliveries(
  p_limit integer default 100
)
returns table(
  delivery_id uuid, reminder_id uuid, device_id uuid, lease_token uuid,
  token text, platform text, order_id uuid, order_number bigint,
  reminder_sequence smallint, attempt_count smallint, max_attempts smallint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reminder record;
begin
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

create or replace function public.begin_staff_push_reminder_dispatch(
  p_delivery_id uuid,
  p_lease_token uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reminder_id uuid;
  v_valid boolean;
begin
  select delivery.reminder_id,
    reminder.expires_at > now()
      and orders.status = 'paid'
      and orders.kitchen_status = 'queued'
      and orders.fulfillment_status in ('pending', 'new')
      and device.platform = 'ios'
      and device.active and device.revoked_at is null
      and device.branch_id = reminder.branch_id
      and exists (
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
  into v_reminder_id, v_valid
  from public.staff_push_reminder_deliveries delivery
  inner join public.staff_push_reminder_outbox reminder
    on reminder.id = delivery.reminder_id
  inner join public.kaspi_orders orders on orders.id = reminder.order_id
  inner join public.staff_push_devices device on device.id = delivery.device_id
  where delivery.id = p_delivery_id
    and delivery.status = 'processing'
    and delivery.lease_token = p_lease_token
  for update of delivery, reminder, orders, device;

  if not found then return 'lost'; end if;
  if not v_valid then
    update public.staff_push_reminder_deliveries
    set status = 'skipped', locked_at = null, lease_token = null,
        last_error = 'Reminder is no longer current', updated_at = now()
    where id = p_delivery_id and status = 'processing'
      and lease_token = p_lease_token;
    perform public.refresh_staff_push_reminder_outbox(v_reminder_id);
    return 'skipped';
  end if;

  update public.staff_push_reminder_deliveries
  set status = 'dispatching', locked_at = now(), updated_at = now()
  where id = p_delivery_id and status = 'processing'
    and lease_token = p_lease_token;
  if not found then return 'lost'; end if;
  return 'dispatching';
end;
$$;

create or replace function public.complete_staff_push_reminder_delivery(
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
declare v_reminder_id uuid;
begin
  if p_status not in ('sent', 'retry', 'failed', 'skipped', 'uncertain') then
    raise exception 'invalid staff reminder delivery status';
  end if;
  update public.staff_push_reminder_deliveries
  set status = p_status,
      next_attempt_at = case when p_status = 'retry' then now() + make_interval(
        secs => least(greatest(coalesce(p_retry_seconds, 15), 1), 1800)
      ) else next_attempt_at end,
      locked_at = null, lease_token = null,
      provider_message_id = left(nullif(p_provider_message_id, ''), 500),
      last_error = left(nullif(p_last_error, ''), 500),
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      updated_at = now()
  where id = p_delivery_id and status = 'dispatching'
    and lease_token = p_lease_token
  returning reminder_id into v_reminder_id;
  if not found then return false; end if;
  perform public.refresh_staff_push_reminder_outbox(v_reminder_id);
  return true;
end;
$$;

create or replace function public.release_staff_push_reminder_claim(
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
declare v_reminder_id uuid;
begin
  update public.staff_push_reminder_deliveries
  set status = case when attempt_count >= max_attempts then 'failed' else 'retry' end,
      next_attempt_at = case when attempt_count >= max_attempts then next_attempt_at
        else now() + make_interval(
          secs => least(greatest(coalesce(p_retry_seconds, 15), 1), 1800)
        ) end,
      locked_at = null, lease_token = null,
      last_error = left(nullif(coalesce(
        p_last_error, 'Staff reminder delivery interrupted'
      ), ''), 500),
      updated_at = now()
  where id = p_delivery_id and status in ('processing', 'dispatching')
    and lease_token = p_lease_token
  returning reminder_id into v_reminder_id;
  if not found then return false; end if;
  perform public.refresh_staff_push_reminder_outbox(v_reminder_id);
  return true;
end;
$$;

create or replace function public.recover_staff_push_reminder_sent(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_provider_message_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_reminder_id uuid;
begin
  update public.staff_push_reminder_deliveries
  set status = 'sent', locked_at = null, lease_token = null,
      provider_message_id = left(nullif(p_provider_message_id, ''), 500),
      last_error = null, sent_at = coalesce(sent_at, now()), updated_at = now()
  where id = p_delivery_id and status = 'dispatching'
    and lease_token = p_lease_token
  returning reminder_id into v_reminder_id;
  if not found then
    return exists (
      select 1 from public.staff_push_reminder_deliveries
      where id = p_delivery_id and status = 'sent'
    );
  end if;
  perform public.refresh_staff_push_reminder_outbox(v_reminder_id);
  return true;
end;
$$;

create or replace function public.enqueue_staff_push_reminder_terminal_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_alert_type text;
begin
  if new.status in ('failed', 'uncertain')
     and old.status is distinct from new.status then
    v_alert_type := case when new.status = 'failed'
      then 'reminder_delivery_failed' else 'reminder_delivery_uncertain' end;
    insert into public.staff_order_alerts(
      order_id, branch_id, order_number, alert_type, dedupe_key,
      event_at, next_attempt_at
    ) values (
      new.order_id, new.branch_id, new.order_number, v_alert_type,
      'reminder-terminal:' || new.id::text || ':' || new.status,
      now(), now()
    ) on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_push_reminder_outbox_enqueue_terminal_alert
  on public.staff_push_reminder_outbox;
create trigger staff_push_reminder_outbox_enqueue_terminal_alert
after update of status on public.staff_push_reminder_outbox
for each row execute function public.enqueue_staff_push_reminder_terminal_alert();

-- Keep the current alert worker compatible with the two reminder terminal
-- incidents added above. Details remain the bounded empty object enforced by
-- staff_order_alerts_details_check.
create or replace function public.claim_staff_order_alerts_v3(
  p_limit integer default 50,
  p_sla_seconds integer default 120
)
returns table(
  alert_id uuid, lease_token uuid, order_id uuid, branch_id uuid, order_number bigint,
  alert_type text, event_at timestamptz, attempt_count integer, alert_details jsonb
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
    where alert.alert_type in (
        'no_active_ipad', 'delivery_failed', 'delivery_uncertain', 'order_unaccepted',
        'yandex_price_overrun', 'yandex_items_unresolved', 'yandex_create_uncertain',
        'reminder_delivery_failed', 'reminder_delivery_uncertain'
      )
      and alert.status in ('queued', 'retry', 'config_pending')
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
         claimed.order_number, claimed.alert_type::text, claimed.event_at,
         claimed.attempt_count, claimed.details
  from claimed;
end;
$$;

create or replace function public.validate_staff_order_alert_claim_v3(
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

  if v_alert.alert_type in (
    'reminder_delivery_failed', 'reminder_delivery_uncertain'
  ) then
    v_valid := exists (
      select 1
      from public.staff_push_reminder_outbox reminder
      where reminder.order_id = v_alert.order_id
        and reminder.status = case
          when v_alert.alert_type = 'reminder_delivery_failed' then 'failed'
          else 'uncertain' end
        and v_alert.dedupe_key = 'reminder-terminal:' || reminder.id::text || ':'
          || reminder.status
    );
    if not v_valid then
      update public.staff_order_alerts
      set status = 'resolved', resolved_at = now(), locked_at = null,
          lease_token = null, last_error = null, updated_at = now()
      where id = v_alert.id and status = 'processing' and lease_token = p_lease_token;
    end if;
    return v_valid;
  end if;

  -- Preserve the exact v2 semantics for the seven pre-existing alert types.
  -- The old RPC itself remains untouched so an old worker cannot claim either
  -- reminder type while a deployment is rolling.
  return public.validate_staff_order_alert_claim_v2(
    p_alert_id, p_lease_token, p_sla_seconds
  );
end;
$$;

-- Acceptance deliberately never locks reminder rows. The dispatch boundary
-- revalidates the order while holding its own lease and changes a no-longer
-- current delivery to skipped. Keeping the order -> reminder lock direction
-- out of this trigger path prevents a cycle with reminder -> order dispatch.
drop trigger if exists kaspi_orders_resolve_staff_push_reminder
  on public.kaspi_orders;
drop function if exists public.resolve_staff_push_reminder_on_acceptance();

revoke all on function public.maintain_staff_order_acceptance_audit(),
  public.enqueue_staff_push_reminder(),
  public.enqueue_staff_push_reminder_terminal_alert(),
  public.refresh_staff_push_reminder_outbox(uuid),
  public.claim_staff_push_reminder_deliveries(integer),
  public.begin_staff_push_reminder_dispatch(uuid,uuid),
  public.complete_staff_push_reminder_delivery(uuid,uuid,text,text,text,integer),
  public.release_staff_push_reminder_claim(uuid,uuid,text,integer),
  public.recover_staff_push_reminder_sent(uuid,uuid,text),
  public.claim_staff_order_alerts_v3(integer,integer),
  public.validate_staff_order_alert_claim_v3(uuid,uuid,integer)
from public, anon, authenticated;

grant execute on function public.claim_staff_push_reminder_deliveries(integer),
  public.begin_staff_push_reminder_dispatch(uuid,uuid),
  public.complete_staff_push_reminder_delivery(uuid,uuid,text,text,text,integer),
  public.release_staff_push_reminder_claim(uuid,uuid,text,integer),
  public.recover_staff_push_reminder_sent(uuid,uuid,text),
  public.claim_staff_order_alerts_v3(integer,integer),
  public.validate_staff_order_alert_claim_v3(uuid,uuid,integer)
to service_role;

comment on column public.kaspi_orders.staff_acceptance_requested_at is
  'Durable paid-transition time from which kitchen acceptance age is measured.';
comment on column public.kaspi_orders.staff_accepted_at is
  'Immutable timestamp of the first queued-to-preparing kitchen acceptance.';
comment on table public.staff_push_reminder_outbox is
  'One durable 60-second reminder per still-unaccepted paid order.';

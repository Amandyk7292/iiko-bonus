-- Durable operational alerts for staff-order push coverage and acceptance SLA.
-- Alert payloads contain operational UUIDs only; customer/order contents never
-- enter this queue.

create table if not exists public.staff_order_alerts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.kaspi_orders(id) on delete cascade,
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  order_number bigint not null,
  alert_type varchar(40) not null check (alert_type in (
    'no_active_ipad', 'delivery_failed', 'delivery_uncertain', 'order_unaccepted'
  )),
  status varchar(24) not null default 'queued' check (status in (
    'queued', 'config_pending', 'processing', 'retry', 'sent', 'resolved'
  )),
  dedupe_key varchar(200) not null unique,
  event_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  locked_at timestamptz,
  lease_token uuid,
  last_error varchar(120),
  sent_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_order_alerts_pending_idx
  on public.staff_order_alerts(status, next_attempt_at, event_at)
  where status in ('queued', 'config_pending', 'processing', 'retry');

create table if not exists public.staff_order_alert_branch_episodes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  alert_type varchar(40) not null check (alert_type = 'no_active_ipad'),
  alert_id uuid not null unique references public.staff_order_alerts(id) on delete cascade,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists staff_order_alert_branch_episode_active_idx
  on public.staff_order_alert_branch_episodes(branch_id, alert_type)
  where resolved_at is null;

alter table public.staff_order_alerts enable row level security;
alter table public.staff_order_alert_branch_episodes enable row level security;
drop policy if exists service_role_all_staff_order_alerts on public.staff_order_alerts;
create policy service_role_all_staff_order_alerts on public.staff_order_alerts
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all_staff_order_alert_branch_episodes
  on public.staff_order_alert_branch_episodes;
create policy service_role_all_staff_order_alert_branch_episodes
  on public.staff_order_alert_branch_episodes
  for all to service_role using (true) with check (true);
revoke all on public.staff_order_alerts, public.staff_order_alert_branch_episodes
  from public, anon, authenticated;
grant all on public.staff_order_alerts, public.staff_order_alert_branch_episodes
  to service_role;

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
  perform pg_advisory_xact_lock(hashtextextended('staff-push-registration', 0));
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

create or replace function public.enqueue_staff_order_no_ipad_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'paid'
    and new.branch_id is not null
    and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    perform public.open_staff_no_ipad_alert_episode(
      new.id, new.order_number, new.branch_id, now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists kaspi_orders_enqueue_staff_order_no_ipad_alert
  on public.kaspi_orders;
create trigger kaspi_orders_enqueue_staff_order_no_ipad_alert
after insert or update of status on public.kaspi_orders
for each row execute function public.enqueue_staff_order_no_ipad_alert();

create or replace function public.enqueue_staff_push_terminal_alert()
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

drop trigger if exists staff_push_outbox_enqueue_terminal_alert
  on public.staff_push_outbox;
create trigger staff_push_outbox_enqueue_terminal_alert
after update of status on public.staff_push_outbox
for each row execute function public.enqueue_staff_push_terminal_alert();

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
  perform pg_advisory_xact_lock(hashtextextended('staff-push-registration', 0));

  -- Close a branch coverage episode when enrollment is restored or there are
  -- no longer paid, unaccepted orders that require an iPad at that branch.
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

  -- This periodic reconciliation also catches the last iPad becoming invalid
  -- after payment (for example, FCM rejects its token). One open episode per
  -- branch bounds alert volume regardless of order count.
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

  -- Resolve alerts that became obsolete before delivery. This prevents a
  -- short registration race or a recently accepted order from creating a
  -- false alarm after the receiver recovers.
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

  return v_inserted;
end;
$$;

create or replace function public.defer_staff_order_alerts_configuration(
  p_retry_seconds integer default 900
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_deferred integer := 0;
begin
  update public.staff_order_alerts
  set status = 'config_pending',
      next_attempt_at = now() + make_interval(
        secs => least(greatest(coalesce(p_retry_seconds, 900), 60), 3600)
      ),
      locked_at = null, lease_token = null,
      last_error = 'ALERT_RECEIVER_NOT_CONFIGURED', updated_at = now()
  where status in ('queued', 'retry', 'config_pending');
  get diagnostics v_deferred = row_count;
  return v_deferred;
end;
$$;

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
  perform public.enqueue_due_staff_order_alerts(p_sla_seconds);

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
  perform public.enqueue_due_staff_order_alerts(p_sla_seconds);
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

create or replace function public.complete_staff_order_alert(
  p_alert_id uuid,
  p_lease_token uuid,
  p_sent boolean,
  p_error_code text default null,
  p_retry_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.staff_order_alerts
  set status = case when p_sent then 'sent' else 'retry' end,
      next_attempt_at = case when p_sent then next_attempt_at else
        now() + make_interval(
          secs => least(greatest(coalesce(p_retry_seconds, 300), 30), 3600)
        ) end,
      locked_at = null, lease_token = null,
      last_error = case when p_sent then null
        else left(coalesce(nullif(p_error_code, ''), 'ALERT_DELIVERY_FAILED'), 120) end,
      sent_at = case when p_sent then coalesce(sent_at, now()) else sent_at end,
      updated_at = now()
  where id = p_alert_id and status = 'processing' and lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.staff_order_alert_snapshot()
returns table(
  queued bigint, config_pending bigint, processing bigint, retry bigint,
  sent bigint, resolved bigint, oldest_pending_seconds bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where status = 'queued'),
    count(*) filter (where status = 'config_pending'),
    count(*) filter (where status = 'processing'),
    count(*) filter (where status = 'retry'),
    count(*) filter (where status = 'sent'),
    count(*) filter (where status = 'resolved'),
    coalesce(extract(epoch from now() - min(event_at) filter (
      where status in ('queued', 'config_pending', 'processing', 'retry')
    ))::bigint, 0)
  from public.staff_order_alerts;
$$;

revoke all on function public.branch_has_active_staff_ipad(uuid),
  public.open_staff_no_ipad_alert_episode(uuid,bigint,uuid,timestamptz),
  public.enqueue_staff_order_no_ipad_alert(),
  public.enqueue_staff_push_terminal_alert(),
  public.enqueue_due_staff_order_alerts(integer),
  public.defer_staff_order_alerts_configuration(integer),
  public.claim_staff_order_alerts(integer,integer),
  public.validate_staff_order_alert_claim(uuid,uuid,integer),
  public.complete_staff_order_alert(uuid,uuid,boolean,text,integer),
  public.staff_order_alert_snapshot()
from public, anon, authenticated;

grant execute on function public.branch_has_active_staff_ipad(uuid),
  public.enqueue_due_staff_order_alerts(integer),
  public.defer_staff_order_alerts_configuration(integer),
  public.claim_staff_order_alerts(integer,integer),
  public.validate_staff_order_alert_claim(uuid,uuid,integer),
  public.complete_staff_order_alert(uuid,uuid,boolean,text,integer),
  public.staff_order_alert_snapshot()
to service_role;

comment on table public.staff_order_alerts is
  'Durable, deduplicated operational staff-order alerts without customer PII.';

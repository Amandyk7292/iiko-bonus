begin;

-- Calendar-day allowance is independent of rules, text, purchases and worker restarts.
create table if not exists public.inactive_reminder_claims (
  customer_id uuid not null references public.customers(id) on delete cascade,
  reminder_date date not null,
  delivery_id uuid references public.marketing_deliveries(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (customer_id, reminder_date)
);
alter table public.inactive_reminder_claims enable row level security;
revoke all on public.inactive_reminder_claims from public, anon, authenticated;
grant all on public.inactive_reminder_claims to service_role;
drop policy if exists "service role manages inactive reminders" on public.inactive_reminder_claims;
create policy "service role manages inactive reminders"
  on public.inactive_reminder_claims for all to service_role using (true) with check (true);

-- The old worker marks an outbox enqueue as sent, so conservatively retain that allowance.
insert into public.inactive_reminder_claims (customer_id, reminder_date, delivery_id, created_at)
select distinct on (d.customer_id, (coalesce(d.sent_at, d.created_at) at time zone 'Asia/Almaty')::date)
  d.customer_id, (coalesce(d.sent_at, d.created_at) at time zone 'Asia/Almaty')::date,
  d.id, d.created_at
from public.marketing_deliveries d
join public.marketing_automations a on a.id = d.automation_id
where a.trigger_type = 'inactive' and d.channel = 'push' and d.status = 'sent'
order by d.customer_id, (coalesce(d.sent_at, d.created_at) at time zone 'Asia/Almaty')::date,
  d.created_at, d.id
on conflict (customer_id, reminder_date) do nothing;

-- Retire the old unscheduled queue, never drain it at the next morning opening.
update public.marketing_deliveries d
set status = 'skipped', error = 'Replaced by daytime calendar-day reminder scheduling'
from public.marketing_automations a
where a.id = d.automation_id and a.trigger_type = 'inactive' and d.status = 'pending'
  and d.payload ->> 'reminderWindowVersion' is distinct from 'daytime-v1';
update public.push_notification_outbox
set status = 'skipped', pending_tokens = '[]'::jsonb, locked_at = null, lease_token = null,
  last_error = 'Replaced by daytime calendar-day reminder scheduling', updated_at = now()
where payload ->> 'type' = 'marketing_inactive'
  and payload ->> 'reminderWindowVersion' is distinct from 'daytime-v1'
  and status in ('queued', 'retry', 'processing');

-- Thirty evenly distributed polling slots: 11:00 through 15:50 local time.
-- Named timezone rules also handle historical/future offset changes.
create or replace function public.inactive_reminder_scheduled_at(p_customer_id uuid, p_day date)
returns timestamptz language sql immutable strict set search_path = public, pg_temp
as $$
  select (p_day + time '11:00' +
    ((('x' || substr(md5(p_customer_id::text || ':' || to_char(p_day, 'YYYY-MM-DD')), 1, 8))::bit(32)::bigint % 30)
      * interval '10 minutes')) at time zone 'Asia/Almaty';
$$;

create or replace function public.enqueue_inactive_order_reminders_at(
  p_automation_id uuid, p_inactive_hours integer, p_now timestamptz
)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_today date := (p_now at time zone 'Asia/Almaty')::date;
  v_day_key text := to_char(v_today, 'YYYY-MM-DD');
  v_candidate record;
  v_delivery_id uuid;
  v_inserted integer := 0;
begin
  if p_automation_id is null or p_now is null then raise exception 'automation and time are required'; end if;
  if p_inactive_hours is null or p_inactive_hours < 1 or p_inactive_hours > 8760 then
    raise exception 'inactive hours must be between 1 and 8760';
  end if;
  if (p_now at time zone 'Asia/Almaty')::time < time '11:00'
    or (p_now at time zone 'Asia/Almaty')::time >= time '16:00' then return 0; end if;

  -- Expired pending reminders must not suppress birthdays or other marketing tomorrow.
  update public.marketing_deliveries d set status = 'skipped', error = 'Reminder day expired'
  from public.marketing_automations a
  where a.id = d.automation_id and a.trigger_type = 'inactive' and d.status = 'pending'
    and d.payload ->> 'reminderDate' < v_day_key;

  for v_candidate in
    select customer.id as customer_id, latest_order.id as order_id,
      latest_order.created_at as last_order_at, product.item,
      public.inactive_reminder_scheduled_at(customer.id, v_today) as scheduled_at
    from public.marketing_automations automation
    cross join public.customers customer
    join lateral (
      select orders.id, orders.cart_items, orders.created_at
      from public.kaspi_orders orders
      where orders.customer_id = customer.id and orders.status = 'paid'
      order by orders.created_at desc, orders.id desc limit 1
    ) latest_order on true
    join lateral (
      select entry.value as item
      from jsonb_array_elements(coalesce(latest_order.cart_items, '[]'::jsonb))
        with ordinality as entry(value, position)
      where nullif(btrim(coalesce(entry.value ->> 'name', '')), '') is not null
      order by case when coalesce(entry.value ->> 'quantity', '') ~ '^[0-9]+([.][0-9]+)?$'
        then (entry.value ->> 'quantity')::numeric else 1 end desc, entry.position limit 1
    ) product on true
    left join public.customer_notification_preferences preference on preference.customer_id = customer.id
    where automation.id = p_automation_id and automation.trigger_type = 'inactive' and automation.active
      and customer.deleted_at is null and coalesce(preference.promos_enabled, true)
      and latest_order.created_at <= p_now - make_interval(hours => p_inactive_hours)
      and (nullif(btrim(coalesce(customer.fcm_token, '')), '') is not null or exists (
        select 1 from public.customer_push_tokens token where token.customer_id = customer.id))
      and public.inactive_reminder_scheduled_at(customer.id, v_today) <= p_now
      -- A missed slot waits for a new random slot tomorrow instead of a restart backlog burst.
      and public.inactive_reminder_scheduled_at(customer.id, v_today) > p_now - interval '10 minutes'
      and not exists (
        select 1 from public.marketing_deliveries recent
        join public.marketing_automations other on other.id = recent.automation_id
        where recent.customer_id = customer.id and recent.channel = 'push'
          and recent.status in ('pending', 'sent') and other.trigger_type <> 'inactive'
          and coalesce(recent.sent_at, recent.created_at) > p_now - interval '24 hours'
      )
    order by customer.id
  loop
    insert into public.inactive_reminder_claims (customer_id, reminder_date, created_at)
    values (v_candidate.customer_id, v_today, p_now)
    on conflict (customer_id, reminder_date) do nothing;
    if not found then continue; end if;

    insert into public.marketing_deliveries
      (automation_id, customer_id, deduplication_key, channel, payload, scheduled_at, created_at)
    values (p_automation_id, v_candidate.customer_id, 'inactive-day:' || v_day_key, 'push',
      jsonb_build_object(
        'productId', nullif(coalesce(v_candidate.item ->> 'id', v_candidate.item ->> 'productId'), ''),
        'productName', left(v_candidate.item ->> 'name', 80),
        'productNames', jsonb_build_object(
          'ru', left(coalesce(nullif(v_candidate.item -> 'name_translations' ->> 'ru', ''), v_candidate.item ->> 'name'), 80),
          'kk', left(coalesce(nullif(v_candidate.item -> 'name_translations' ->> 'kk', ''), nullif(v_candidate.item -> 'name_translations' ->> 'kz', ''), v_candidate.item ->> 'name'), 80),
          'en', left(coalesce(nullif(v_candidate.item -> 'name_translations' ->> 'en', ''), v_candidate.item ->> 'name'), 80)
        ),
        'quantity', greatest(1, case when coalesce(v_candidate.item ->> 'quantity', '') ~ '^[0-9]+([.][0-9]+)?$'
          then (v_candidate.item ->> 'quantity')::numeric else 1 end),
        'lastOrderId', v_candidate.order_id, 'lastOrderAt', v_candidate.last_order_at,
        'inactiveHours', p_inactive_hours, 'reminderWindowVersion', 'daytime-v1',
        'reminderDate', v_today, 'reminderScheduledAt', v_candidate.scheduled_at,
        'reminderExpiresAt', (v_today + time '16:00') at time zone 'Asia/Almaty'
      ), v_candidate.scheduled_at, p_now)
    returning id into v_delivery_id;
    update public.inactive_reminder_claims set delivery_id = v_delivery_id
    where customer_id = v_candidate.customer_id and reminder_date = v_today;
    v_inserted := v_inserted + 1;
  end loop;
  return v_inserted;
end;
$$;

-- Preserve the production RPC signature; the explicit clock helper enables real SQL tests.
create or replace function public.enqueue_inactive_order_reminders(
  p_automation_id uuid, p_inactive_hours integer default 48
)
returns integer language sql security definer set search_path = public, pg_temp
as $$ select public.enqueue_inactive_order_reminders_at(p_automation_id, p_inactive_hours, now()); $$;

-- Recheck after queueing and before every provider attempt: a new purchase, opt-out,
-- deleted customer or disabled rule cancels the reminder rather than reviving a stale audience.
create or replace function public.inactive_order_reminder_allowed(
  p_customer_id uuid, p_delivery_id uuid, p_reminder_date date, p_now timestamptz default now()
)
returns boolean language sql security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.inactive_reminder_claims claim
    join public.marketing_deliveries d on d.id = claim.delivery_id
    join public.marketing_automations a on a.id = d.automation_id
    join public.customers c on c.id = claim.customer_id
    left join public.customer_notification_preferences pref on pref.customer_id = c.id
    join lateral (
      select o.id, o.created_at from public.kaspi_orders o
      where o.customer_id = c.id and o.status = 'paid'
      order by o.created_at desc, o.id desc limit 1
    ) latest on true
    where claim.customer_id = p_customer_id and claim.delivery_id = p_delivery_id
      and claim.reminder_date = p_reminder_date
      and p_reminder_date = (p_now at time zone 'Asia/Almaty')::date
      and (p_now at time zone 'Asia/Almaty')::time >= time '11:00'
      and (p_now at time zone 'Asia/Almaty')::time < time '16:00'
      and public.inactive_reminder_scheduled_at(c.id, p_reminder_date) <= p_now
      and d.status in ('pending', 'sent') and a.trigger_type = 'inactive' and a.active
      and c.deleted_at is null and coalesce(pref.promos_enabled, true)
      and latest.id::text = d.payload ->> 'lastOrderId'
      and latest.created_at <= p_now - make_interval(hours => (d.payload ->> 'inactiveHours')::integer)
      and not exists (
        select 1 from public.marketing_deliveries recent
        join public.marketing_automations other on other.id = recent.automation_id
        where recent.customer_id = c.id and recent.channel = 'push'
          and recent.status in ('pending', 'sent') and other.trigger_type <> 'inactive'
          and coalesce(recent.sent_at, recent.created_at) > p_now - interval '24 hours'
      )
  );
$$;

revoke all on function public.inactive_reminder_scheduled_at(uuid, date) from public, anon, authenticated;
revoke all on function public.enqueue_inactive_order_reminders_at(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.enqueue_inactive_order_reminders(uuid, integer) from public, anon, authenticated;
revoke all on function public.inactive_order_reminder_allowed(uuid, uuid, date, timestamptz) from public, anon, authenticated;
grant execute on function public.inactive_reminder_scheduled_at(uuid, date) to service_role;
grant execute on function public.enqueue_inactive_order_reminders_at(uuid, integer, timestamptz) to service_role;
grant execute on function public.enqueue_inactive_order_reminders(uuid, integer) to service_role;
grant execute on function public.inactive_order_reminder_allowed(uuid, uuid, date, timestamptz) to service_role;

update public.marketing_automations
set config = coalesce(config, '{}'::jsonb) ||
  '{"maximumPerDay":1,"reminderTimezone":"Asia/Almaty","reminderWindowStart":"11:00","reminderWindowEnd":"16:00"}'::jsonb,
  updated_at = now()
where trigger_type = 'inactive';

commit;

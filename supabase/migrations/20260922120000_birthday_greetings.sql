begin;

-- This is a greeting ledger, not a bonus ledger. A rule or date-of-birth edit
-- must never reset a customer's annual notification allowance.
create table if not exists public.birthday_greeting_claims (
  customer_id uuid not null references public.customers(id) on delete cascade,
  greeting_year integer not null check (greeting_year between 2000 and 9999),
  delivery_id uuid references public.marketing_deliveries(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (customer_id, greeting_year)
);

alter table public.birthday_greeting_claims enable row level security;
revoke all on public.birthday_greeting_claims from public, anon, authenticated;
grant all on public.birthday_greeting_claims to service_role;
drop policy if exists "service role manages birthday greetings" on public.birthday_greeting_claims;
create policy "service role manages birthday greetings"
  on public.birthday_greeting_claims for all to service_role using (true) with check (true);

-- Preserve greetings queued/sent before deployment; changing the copy must
-- not send another greeting to customers already congratulated this year.
insert into public.birthday_greeting_claims (customer_id, greeting_year, delivery_id, created_at)
select distinct on (delivery.customer_id, extract(year from
    coalesce(delivery.sent_at, delivery.scheduled_at, delivery.created_at) at time zone 'Asia/Aqtau'))
  delivery.customer_id,
  extract(year from coalesce(delivery.sent_at, delivery.scheduled_at, delivery.created_at)
    at time zone 'Asia/Aqtau')::integer,
  delivery.id, delivery.created_at
from public.marketing_deliveries delivery
join public.marketing_automations automation on automation.id = delivery.automation_id
where automation.trigger_type = 'birthday'
order by delivery.customer_id,
  extract(year from coalesce(delivery.sent_at, delivery.scheduled_at, delivery.created_at)
    at time zone 'Asia/Aqtau'),
  (delivery.status = 'sent') desc, delivery.created_at, delivery.id
on conflict (customer_id, greeting_year) do nothing;

update public.marketing_deliveries delivery
set status = 'skipped', error = 'Birthday greeting already recorded for this year'
from public.marketing_automations automation, public.birthday_greeting_claims claim
where automation.id = delivery.automation_id and automation.trigger_type = 'birthday'
  and delivery.status = 'pending' and claim.customer_id = delivery.customer_id
  and claim.greeting_year = extract(year from delivery.scheduled_at at time zone 'Asia/Aqtau')
  and delivery.id is distinct from claim.delivery_id;

create or replace function public.enqueue_birthday_greetings(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (p_now at time zone 'Asia/Aqtau')::date;
  v_year integer := extract(year from v_today)::integer;
  v_automation_id uuid;
  v_customer_id uuid;
  v_delivery_id uuid;
  v_inserted integer := 0;
begin
  if p_now is null then raise exception 'Birthday greeting time is required'; end if;
  select id into v_automation_id from public.marketing_automations
  where trigger_type = 'birthday' and active = true
  order by (code = 'birthday_default') desc, created_at, id limit 1;
  if v_automation_id is null then return 0; end if;

  for v_customer_id in
    select customer.id from public.customers customer
    left join public.customer_notification_preferences preference
      on preference.customer_id = customer.id
    where customer.deleted_at is null
      and extract(month from customer.birth_date) = extract(month from v_today)
      and extract(day from customer.birth_date) = extract(day from v_today)
      and coalesce(preference.promos_enabled, true)
      and (
        nullif(btrim(customer.fcm_token), '') is not null or exists (
          select 1 from public.customer_push_tokens token where token.customer_id = customer.id
        )
      )
      and not (coalesce(preference.quiet_hours_enabled, false) and (
        preference.quiet_start = preference.quiet_end or
        case when preference.quiet_start < preference.quiet_end then
          (p_now at time zone preference.timezone)::time >= preference.quiet_start and
          (p_now at time zone preference.timezone)::time < preference.quiet_end
        else
          (p_now at time zone preference.timezone)::time >= preference.quiet_start or
          (p_now at time zone preference.timezone)::time < preference.quiet_end
        end
      ))
    order by customer.id
  loop
    insert into public.birthday_greeting_claims (customer_id, greeting_year, created_at)
    values (v_customer_id, v_year, p_now)
    on conflict (customer_id, greeting_year) do nothing;
    if not found then continue; end if;

    insert into public.marketing_deliveries
      (automation_id, customer_id, deduplication_key, channel, payload, scheduled_at, created_at)
    values (v_automation_id, v_customer_id, 'birthday:' || v_year, 'push',
      jsonb_build_object('greetingYear', v_year), p_now, p_now)
    on conflict (automation_id, customer_id, deduplication_key, channel)
      do update set deduplication_key = excluded.deduplication_key
    returning id into v_delivery_id;

    update public.birthday_greeting_claims set delivery_id = v_delivery_id
    where customer_id = v_customer_id and greeting_year = v_year;
    v_inserted := v_inserted + 1;
  end loop;
  return v_inserted;
end;
$$;

revoke all on function public.enqueue_birthday_greetings(timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_birthday_greetings(timestamptz) to service_role;

update public.marketing_automations
set title_translations = '{"ru":"С днём рождения!","kk":"Туған күніңізбен!","en":"Happy birthday!"}'::jsonb,
  body_translations = '{"ru":"Команда Bulka желает вам счастья, тепла и сладких моментов. Пусть этот день будет особенным!","kk":"Bulka ұжымы сізге бақыт, жылулық және тәтті сәттер тілейді. Бүгінгі күніңіз ерекше болсын!","en":"The Bulka team wishes you happiness, warmth and sweet moments. Have a wonderful birthday!"}'::jsonb,
  config = coalesce(config, '{}'::jsonb) || '{"daysBefore":0,"maximumPerYear":1}'::jsonb,
  updated_at = now()
where code = 'birthday_default';

commit;

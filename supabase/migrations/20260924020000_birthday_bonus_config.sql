-- Existing annual claims are never reset or awarded retroactively.
alter table public.birthday_greeting_claims add column bonus_amount numeric not null default 0 check(bonus_amount between 0 and 100000);
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
  v_bonus numeric := 0;
begin
  if p_now is null then raise exception 'Birthday greeting time is required'; end if;
  select id, case when coalesce(config->>'birthdayBonusAmount','0') ~ '^\d{1,6}$'
      then least(100000,coalesce((config->>'birthdayBonusAmount')::numeric,0)) else 0 end
    into v_automation_id,v_bonus from public.marketing_automations
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
    if coalesce(v_bonus,0)>0 then
      perform public.apply_manual_bonus_scoped(v_customer_id,v_bonus,'Подарок ко дню рождения '||v_year,null);
      update public.birthday_greeting_claims set bonus_amount=v_bonus
        where customer_id=v_customer_id and greeting_year=v_year;
    end if;

    insert into public.marketing_deliveries
      (automation_id, customer_id, deduplication_key, channel, payload, scheduled_at, created_at)
    values (v_automation_id, v_customer_id, 'birthday:' || v_year, 'push',
      jsonb_build_object('greetingYear', v_year,'bonusAmount',coalesce(v_bonus,0)), p_now, p_now)
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

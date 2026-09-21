begin;

create or replace function public.enqueue_inactive_order_reminders(
  p_automation_id uuid,
  p_inactive_hours integer default 48
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
begin
  if p_automation_id is null then raise exception 'automation id is required'; end if;
  if p_inactive_hours is null or p_inactive_hours < 1 or p_inactive_hours > 8760 then
    raise exception 'inactive hours must be between 1 and 8760';
  end if;

  with automation as (
    select id from public.marketing_automations
    where id = p_automation_id and trigger_type = 'inactive' and active = true
  ), candidates as (
    select customer.id as customer_id, latest_order.id as order_id,
      latest_order.created_at as last_order_at, product.item
    from automation
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
      order by case
        when coalesce(entry.value ->> 'quantity', '') ~ '^[0-9]+([.][0-9]+)?$'
          then (entry.value ->> 'quantity')::numeric
        else 1
      end desc, entry.position
      limit 1
    ) product on true
    where customer.deleted_at is null
      and latest_order.created_at <= now() - make_interval(hours => p_inactive_hours)
      and (
        nullif(btrim(coalesce(customer.fcm_token, '')), '') is not null
        or exists (select 1 from public.customer_push_tokens token where token.customer_id = customer.id)
      )
      and not exists (
        select 1 from public.marketing_deliveries recent
        where recent.customer_id = customer.id and recent.channel = 'push'
          and recent.status in ('pending', 'sent')
          and coalesce(recent.sent_at, recent.created_at) > now() - interval '24 hours'
      )
  ), inserted as (
    insert into public.marketing_deliveries
      (automation_id, customer_id, deduplication_key, channel, payload)
    select p_automation_id, candidate.customer_id,
      'inactive:' || candidate.order_id::text || ':' ||
        to_char((now() at time zone 'Asia/Aqtau')::date, 'YYYY-MM-DD'),
      'push',
      jsonb_build_object(
        'productId', nullif(coalesce(candidate.item ->> 'id', candidate.item ->> 'productId'), ''),
        'productName', left(candidate.item ->> 'name', 80),
        'productNames', jsonb_build_object(
          'ru', left(coalesce(nullif(candidate.item -> 'name_translations' ->> 'ru', ''), candidate.item ->> 'name'), 80),
          'kk', left(coalesce(nullif(candidate.item -> 'name_translations' ->> 'kk', ''), nullif(candidate.item -> 'name_translations' ->> 'kz', ''), candidate.item ->> 'name'), 80),
          'en', left(coalesce(nullif(candidate.item -> 'name_translations' ->> 'en', ''), candidate.item ->> 'name'), 80)
        ),
        'quantity', greatest(1, case
          when coalesce(candidate.item ->> 'quantity', '') ~ '^[0-9]+([.][0-9]+)?$'
            then (candidate.item ->> 'quantity')::numeric
          else 1
        end),
        'lastOrderId', candidate.order_id, 'lastOrderAt', candidate.last_order_at,
        'inactiveHours', p_inactive_hours
      )
    from candidates candidate
    on conflict (automation_id, customer_id, deduplication_key, channel) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;
  return v_inserted;
end;
$$;

revoke all on function public.enqueue_inactive_order_reminders(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_inactive_order_reminders(uuid, integer) to service_role;

update public.marketing_automations
set title_translations = '{"ru":"Давно не заглядывали?","kk":"Көптен бері көрінбедіңіз","en":"It has been a while"}'::jsonb,
  body_translations = '{"ru":"{{quantity}} × {{productName}} снова ждут вас. Загляните в Bulka за свежей выпечкой.","kk":"{{quantity}} × {{productName}} сізді қайта күтіп тұр. Жаңа піскен өнімдер үшін Bulka-ға кіріңіз.","en":"{{quantity}} × {{productName}} are waiting for you again. Visit Bulka for something freshly baked."}'::jsonb,
  config = (coalesce(config, '{}'::jsonb) - 'inactiveDays' - 'cooldownDays') ||
    '{"inactiveHours":48,"maximumPerDay":1}'::jsonb,
  updated_at = now()
where code = 'inactive_default';

commit;

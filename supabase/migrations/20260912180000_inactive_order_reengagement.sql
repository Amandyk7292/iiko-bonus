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
  if p_automation_id is null then
    raise exception 'automation id is required';
  end if;
  if p_inactive_hours is null or p_inactive_hours < 1 or p_inactive_hours > 8760 then
    raise exception 'inactive hours must be between 1 and 8760';
  end if;
  if not exists (
    select 1
    from public.marketing_automations automation
    where automation.id = p_automation_id
      and automation.trigger_type = 'inactive'
      and automation.active = true
  ) then
    return 0;
  end if;

  with candidates as (
    select
      customer.id as customer_id,
      latest_order.id as order_id,
      greatest(
        coalesce(customer.created_at, latest_order.created_at),
        latest_order.created_at,
        coalesce(last_open.opened_at, '-infinity'::timestamptz),
        coalesce(last_push.seen_at, '-infinity'::timestamptz)
      ) as activity_at,
      product.item
    from public.customers customer
    join lateral (
      select orders.id, orders.cart_items, orders.created_at
      from public.kaspi_orders orders
      where orders.customer_id = customer.id
        and orders.status = 'paid'
      order by orders.created_at desc, orders.id desc
      limit 1
    ) latest_order on true
    join lateral (
      select entry.value as item
      from jsonb_array_elements(coalesce(latest_order.cart_items, '[]'::jsonb))
        with ordinality as entry(value, position)
      where nullif(btrim(coalesce(entry.value ->> 'name', '')), '') is not null
      order by entry.position
      limit 1
    ) product on true
    left join lateral (
      select max(event.occurred_at) as opened_at
      from public.customer_app_events event
      where event.customer_id = customer.id
        and event.event_type = 'app_open'
    ) last_open on true
    left join lateral (
      select max(token.last_seen_at) as seen_at
      from public.customer_push_tokens token
      where token.customer_id = customer.id
    ) last_push on true
    where customer.deleted_at is null
      and (
        nullif(btrim(coalesce(customer.fcm_token, '')), '') is not null
        or exists (
          select 1
          from public.customer_push_tokens token
          where token.customer_id = customer.id
        )
      )
  ), eligible as (
    select *
    from candidates
    where activity_at <= now() - make_interval(hours => p_inactive_hours)
  ), inserted as (
    insert into public.marketing_deliveries (
      automation_id,
      customer_id,
      deduplication_key,
      channel,
      payload
    )
    select
      p_automation_id,
      eligible.customer_id,
      'inactive:' || eligible.order_id::text || ':' ||
        floor(extract(epoch from eligible.activity_at))::bigint::text,
      'push',
      jsonb_build_object(
        'productId', nullif(coalesce(eligible.item ->> 'id', eligible.item ->> 'productId'), ''),
        'productName', left(eligible.item ->> 'name', 80),
        'productNames', jsonb_build_object(
          'ru', left(coalesce(
            nullif(eligible.item -> 'name_translations' ->> 'ru', ''),
            eligible.item ->> 'name'
          ), 80),
          'kk', left(coalesce(
            nullif(eligible.item -> 'name_translations' ->> 'kk', ''),
            nullif(eligible.item -> 'name_translations' ->> 'kz', ''),
            eligible.item ->> 'name'
          ), 80),
          'en', left(coalesce(
            nullif(eligible.item -> 'name_translations' ->> 'en', ''),
            eligible.item ->> 'name'
          ), 80)
        ),
        'lastOrderId', eligible.order_id,
        'activityAt', eligible.activity_at,
        'inactiveHours', p_inactive_hours
      )
    from eligible
    on conflict (automation_id, customer_id, deduplication_key, channel) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function public.enqueue_inactive_order_reminders(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_inactive_order_reminders(uuid, integer)
  to service_role;

update public.marketing_automations
set
  title_translations = jsonb_build_object(
    'ru', 'Ваш {{productName}} ждёт вас',
    'kk', '{{productName}} сізді күтіп тұр',
    'en', 'Your {{productName}} is waiting'
  ),
  body_translations = jsonb_build_object(
    'ru', 'Пора повторить любимый заказ. Загляните в Bulka — приготовим всё свежее.',
    'kk', 'Сүйікті тапсырысыңызды қайталайтын уақыт келді. Bulka-ға кіріңіз — бәрін жаңа дайындаймыз.',
    'en', 'Time for a favorite again. Open Bulka and we will make it fresh for you.'
  ),
  config = (coalesce(config, '{}'::jsonb) - 'inactiveDays' - 'cooldownDays') ||
    '{"inactiveHours":48}'::jsonb,
  updated_at = now()
where code = 'inactive_default';

commit;

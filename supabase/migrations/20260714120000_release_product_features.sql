-- Release product foundations: branch inventory, capacity-aware slots,
-- courier dispatch, rotating customer sessions and product analytics.

alter table public.bulka_locations
  add column if not exists slot_minutes integer not null default 60,
  add column if not exists pickup_slot_capacity integer not null default 20,
  add column if not exists preorder_slot_capacity integer not null default 10,
  add column if not exists delivery_slot_capacity integer not null default 15;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bulka_locations_slot_configuration_check'
      and conrelid = 'public.bulka_locations'::regclass
  ) then
    alter table public.bulka_locations
      add constraint bulka_locations_slot_configuration_check check (
        slot_minutes between 15 and 240
        and pickup_slot_capacity between 1 and 500
        and preorder_slot_capacity between 1 and 500
        and delivery_slot_capacity between 1 and 500
      );
  end if;
end $$;

create table if not exists public.branch_product_inventory (
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  product_id varchar(100) not null,
  product_name varchar(160),
  source_quantity integer,
  manual_stop boolean not null default false,
  source varchar(24) not null default 'iiko',
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (branch_id, product_id),
  constraint branch_product_inventory_quantity_check
    check (source_quantity is null or source_quantity between 0 and 100000),
  constraint branch_product_inventory_source_check
    check (source in ('iiko', 'admin', 'custom'))
);

create index if not exists branch_product_inventory_product_idx
  on public.branch_product_inventory(product_id, branch_id);

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  client_request_id uuid not null,
  order_id uuid references public.kaspi_orders(id) on delete cascade,
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  product_id varchar(100) not null,
  quantity integer not null,
  status varchar(16) not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_reservations_quantity_check check (quantity between 1 and 99),
  constraint inventory_reservations_status_check
    check (status in ('active', 'committed', 'released', 'expired')),
  unique (client_request_id, product_id)
);

create index if not exists inventory_reservations_capacity_idx
  on public.inventory_reservations(branch_id, product_id, status, expires_at);
create index if not exists inventory_reservations_order_idx
  on public.inventory_reservations(order_id) where order_id is not null;

create table if not exists public.fulfillment_slot_reservations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  client_request_id uuid not null unique,
  order_id uuid references public.kaspi_orders(id) on delete cascade,
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  fulfillment_type varchar(20) not null,
  scheduled_at timestamptz not null,
  status varchar(16) not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fulfillment_slot_reservations_type_check
    check (fulfillment_type in ('pickup', 'delivery', 'preorder')),
  constraint fulfillment_slot_reservations_status_check
    check (status in ('active', 'committed', 'released', 'expired'))
);

create index if not exists fulfillment_slot_capacity_idx
  on public.fulfillment_slot_reservations(branch_id, fulfillment_type, scheduled_at, status);

create table if not exists public.couriers (
  id uuid primary key default gen_random_uuid(),
  name varchar(160) not null,
  phone varchar(32) not null,
  vehicle varchar(80),
  active boolean not null default true,
  current_latitude numeric(10, 7),
  current_longitude numeric(10, 7),
  location_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couriers_coordinates_check check (
    (current_latitude is null and current_longitude is null)
    or (
      current_latitude between -90 and 90
      and current_longitude between -180 and 180
    )
  )
);

create unique index if not exists couriers_phone_unique_idx on public.couriers(phone);

alter table public.kaspi_orders
  add column if not exists courier_id uuid references public.couriers(id) on delete set null,
  add column if not exists delivery_status varchar(24) not null default 'unassigned',
  add column if not exists estimated_delivery_at timestamptz,
  add column if not exists courier_assigned_at timestamptz,
  add column if not exists out_for_delivery_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists tracking_code uuid not null default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_delivery_status_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_delivery_status_check check (
        delivery_status in (
          'unassigned', 'assigned', 'picked_up', 'en_route', 'delivered', 'cancelled'
        )
      );
  end if;
end $$;

create unique index if not exists kaspi_orders_tracking_code_unique_idx
  on public.kaspi_orders(tracking_code);
create index if not exists kaspi_orders_courier_queue_idx
  on public.kaspi_orders(courier_id, delivery_status, scheduled_at)
  where fulfillment_type = 'delivery' and status = 'paid';

create table if not exists public.customer_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_hash varchar(64) not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references public.customer_refresh_tokens(id) on delete set null,
  user_agent_hash varchar(64),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists customer_refresh_tokens_customer_idx
  on public.customer_refresh_tokens(customer_id, expires_at desc);

create table if not exists public.customer_app_events (
  id bigint generated by default as identity primary key,
  customer_id uuid references public.customers(id) on delete set null,
  anonymous_session_id varchar(64),
  event_type varchar(48) not null,
  product_id varchar(100),
  category_id varchar(100),
  branch_id uuid references public.bulka_locations(id) on delete set null,
  order_id uuid references public.kaspi_orders(id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint customer_app_events_type_check check (
    event_type in (
      'app_open', 'catalog_view', 'product_view', 'add_to_cart', 'remove_from_cart',
      'checkout_start', 'checkout_quote', 'payment_created', 'payment_paid',
      'search', 'promotion_view'
    )
  ),
  constraint customer_app_events_properties_check check (
    jsonb_typeof(properties) = 'object'
    and pg_column_size(properties) <= 8192
  )
);

create index if not exists customer_app_events_time_idx
  on public.customer_app_events(occurred_at desc);
create index if not exists customer_app_events_funnel_idx
  on public.customer_app_events(event_type, occurred_at desc);
create unique index if not exists customer_app_events_order_milestone_idx
  on public.customer_app_events(event_type, order_id)
  where order_id is not null and event_type in ('payment_created', 'payment_paid');

alter table public.branch_product_inventory enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.fulfillment_slot_reservations enable row level security;
alter table public.couriers enable row level security;
alter table public.customer_refresh_tokens enable row level security;
alter table public.customer_app_events enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'branch_product_inventory', 'inventory_reservations',
    'fulfillment_slot_reservations', 'couriers',
    'customer_refresh_tokens', 'customer_app_events'
  ] loop
    execute format('drop policy if exists "service role manages %s" on public.%I', table_name, table_name);
    execute format(
      'create policy "service role manages %s" on public.%I for all to service_role using (true) with check (true)',
      table_name,
      table_name
    );
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end $$;

create or replace function public.reserve_order_inventory(
  p_customer_id uuid,
  p_request_id uuid,
  p_branch_id uuid,
  p_items jsonb,
  p_ttl_minutes integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  item_id varchar(100);
  item_quantity integer;
  inventory_row public.branch_product_inventory%rowtype;
  existing_row public.inventory_reservations%rowtype;
  held integer;
  reserved_count integer := 0;
  expires_at_value timestamptz := now() + make_interval(mins => greatest(5, least(p_ttl_minutes, 60)));
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Корзина пуста' using errcode = '22023';
  end if;

  update public.inventory_reservations
  set status = 'expired', updated_at = now()
  where status = 'active' and expires_at <= now();

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := left(coalesce(item->>'id', ''), 100);
    item_quantity := coalesce((item->>'quantity')::integer, 0);
    if item_id = '' or item_quantity < 1 or item_quantity > 99 then
      raise exception 'Некорректная позиция корзины' using errcode = '22023';
    end if;

    select * into inventory_row
    from public.branch_product_inventory
    where branch_id = p_branch_id and product_id = item_id
    for update;

    if found then
      if inventory_row.manual_stop then
        raise exception 'Товар «%» временно недоступен', coalesce(inventory_row.product_name, item_id)
          using errcode = 'P0001';
      end if;

      select * into existing_row
      from public.inventory_reservations
      where client_request_id = p_request_id and product_id = item_id;
      if found and existing_row.customer_id <> p_customer_id then
        raise exception 'Конфликт идентификатора оформления' using errcode = 'P0001';
      end if;

      select coalesce(sum(quantity), 0)::integer into held
      from public.inventory_reservations
      where branch_id = p_branch_id
        and product_id = item_id
        and status in ('active', 'committed')
        and (status = 'committed' or expires_at > now())
        and client_request_id <> p_request_id;

      if inventory_row.source_quantity is not null
        and inventory_row.source_quantity - held < item_quantity then
        raise exception 'Недостаточно товара «%». Доступно: %',
          coalesce(inventory_row.product_name, item_id),
          greatest(inventory_row.source_quantity - held, 0)
          using errcode = 'P0001';
      end if;

      insert into public.inventory_reservations (
        customer_id, client_request_id, branch_id, product_id,
        quantity, status, expires_at, updated_at
      ) values (
        p_customer_id, p_request_id, p_branch_id, item_id,
        item_quantity, 'active', expires_at_value, now()
      )
      on conflict (client_request_id, product_id) do update set
        quantity = excluded.quantity,
        status = case
          when public.inventory_reservations.status = 'committed' then 'committed'
          else 'active'
        end,
        expires_at = greatest(public.inventory_reservations.expires_at, excluded.expires_at),
        updated_at = now();
      reserved_count := reserved_count + 1;
    end if;
  end loop;

  return jsonb_build_object('reserved', reserved_count, 'expiresAt', expires_at_value);
end;
$$;

create or replace function public.reserve_fulfillment_slot(
  p_customer_id uuid,
  p_request_id uuid,
  p_branch_id uuid,
  p_fulfillment_type varchar,
  p_scheduled_at timestamptz,
  p_ttl_minutes integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  location_row public.bulka_locations%rowtype;
  existing_row public.fulfillment_slot_reservations%rowtype;
  capacity_value integer;
  held integer;
  expires_at_value timestamptz := now() + make_interval(mins => greatest(5, least(p_ttl_minutes, 60)));
begin
  if p_fulfillment_type not in ('pickup', 'delivery', 'preorder') then
    raise exception 'Некорректный способ получения заказа' using errcode = '22023';
  end if;
  if p_scheduled_at is null then
    raise exception 'Выберите время заказа' using errcode = '22023';
  end if;

  select * into location_row from public.bulka_locations
  where id = p_branch_id and active = true
  for update;
  if not found then
    raise exception 'Филиал больше недоступен' using errcode = 'P0001';
  end if;

  capacity_value := case p_fulfillment_type
    when 'preorder' then location_row.preorder_slot_capacity
    when 'delivery' then location_row.delivery_slot_capacity
    else location_row.pickup_slot_capacity
  end;

  update public.fulfillment_slot_reservations
  set status = 'expired', updated_at = now()
  where status = 'active' and expires_at <= now();

  select * into existing_row
  from public.fulfillment_slot_reservations
  where client_request_id = p_request_id;
  if found and existing_row.customer_id <> p_customer_id then
    raise exception 'Конфликт идентификатора оформления' using errcode = 'P0001';
  end if;

  select count(*)::integer into held
  from public.fulfillment_slot_reservations
  where branch_id = p_branch_id
    and fulfillment_type = p_fulfillment_type
    and scheduled_at = p_scheduled_at
    and status in ('active', 'committed')
    and (status = 'committed' or expires_at > now())
    and client_request_id <> p_request_id;

  if held >= capacity_value then
    raise exception 'Это время уже занято. Выберите другой слот' using errcode = 'P0001';
  end if;

  insert into public.fulfillment_slot_reservations (
    customer_id, client_request_id, branch_id, fulfillment_type,
    scheduled_at, status, expires_at, updated_at
  ) values (
    p_customer_id, p_request_id, p_branch_id, p_fulfillment_type,
    p_scheduled_at, 'active', expires_at_value, now()
  )
  on conflict (client_request_id) do update set
    branch_id = excluded.branch_id,
    fulfillment_type = excluded.fulfillment_type,
    scheduled_at = excluded.scheduled_at,
    status = case
      when public.fulfillment_slot_reservations.status = 'committed' then 'committed'
      else 'active'
    end,
    expires_at = greatest(public.fulfillment_slot_reservations.expires_at, excluded.expires_at),
    updated_at = now();

  return jsonb_build_object(
    'capacity', capacity_value,
    'remaining', greatest(capacity_value - held - 1, 0),
    'expiresAt', expires_at_value
  );
end;
$$;

create or replace function public.attach_order_reservations(
  p_customer_id uuid,
  p_request_id uuid,
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory_reservations
  set order_id = p_order_id, updated_at = now()
  where customer_id = p_customer_id and client_request_id = p_request_id;
  update public.fulfillment_slot_reservations
  set order_id = p_order_id, updated_at = now()
  where customer_id = p_customer_id and client_request_id = p_request_id;
end;
$$;

create or replace function public.commit_order_reservations(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory_reservations
  set status = 'committed', updated_at = now()
  where order_id = p_order_id and status = 'active';
  update public.fulfillment_slot_reservations
  set status = 'committed', updated_at = now()
  where order_id = p_order_id and status = 'active';
end;
$$;

create or replace function public.release_order_reservations(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory_reservations
  set status = 'released', updated_at = now()
  where order_id = p_order_id and status in ('active', 'committed');
  update public.fulfillment_slot_reservations
  set status = 'released', updated_at = now()
  where order_id = p_order_id and status in ('active', 'committed');
end;
$$;

revoke all on function public.reserve_order_inventory(uuid, uuid, uuid, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.reserve_fulfillment_slot(uuid, uuid, uuid, varchar, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.attach_order_reservations(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.commit_order_reservations(uuid)
  from public, anon, authenticated;
revoke all on function public.release_order_reservations(uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_order_inventory(uuid, uuid, uuid, jsonb, integer) to service_role;
grant execute on function public.reserve_fulfillment_slot(uuid, uuid, uuid, varchar, timestamptz, integer) to service_role;
grant execute on function public.attach_order_reservations(uuid, uuid, uuid) to service_role;
grant execute on function public.commit_order_reservations(uuid) to service_role;
grant execute on function public.release_order_reservations(uuid) to service_role;

create or replace function public.get_admin_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with customer_totals as (
    select
      count(*)::integer as total_customers,
      count(*) filter (where created_at >= now() - interval '30 days')::integer as new_customers,
      coalesce(sum(total_spent), 0)::numeric as total_sales,
      coalesce(sum(balance), 0)::numeric as liabilities
    from public.customers
  ), transaction_totals as (
    select
      coalesce(sum(amount) filter (where type in ('deposit', 'manual_deposit', 'manual')), 0)::numeric as earned,
      coalesce(sum(amount) filter (where type in ('withdrawal', 'manual_withdrawal', 'expiration')), 0)::numeric as burned,
      coalesce(sum(amount) filter (where type in ('deposit', 'manual_deposit', 'manual') and timestamp >= now() - interval '30 days'), 0)::numeric as earned_30,
      coalesce(sum(amount) filter (where type in ('withdrawal', 'manual_withdrawal', 'expiration') and timestamp >= now() - interval '30 days'), 0)::numeric as burned_30
    from public.transactions
  ), order_totals as (
    select
      count(*) filter (where status in ('paid', 'refunded'))::integer as paid_orders,
      count(*) filter (where status in ('paid', 'refunded') and created_at >= now() - interval '30 days')::integer as paid_orders_30,
      coalesce(sum(amount) filter (where status = 'paid' and created_at >= now() - interval '30 days'), 0)::numeric as sales_30,
      coalesce(avg(amount) filter (where status in ('paid', 'refunded') and created_at >= now() - interval '30 days'), 0)::numeric as average_order_30,
      count(*) filter (where fulfillment_status = 'cancelled' and created_at >= now() - interval '30 days')::integer as cancelled_30,
      count(*) filter (where status = 'refunded' and created_at >= now() - interval '30 days')::integer as refunds_30,
      coalesce(sum(refund_amount) filter (where status = 'refunded' and created_at >= now() - interval '30 days'), 0)::numeric as refund_amount_30,
      count(*) filter (where status = 'paid' and fulfillment_status not in ('completed', 'cancelled'))::integer as active_orders,
      coalesce(avg(extract(epoch from (fulfilled_at - created_at)) / 60)
        filter (where fulfillment_status = 'completed' and fulfilled_at is not null and created_at >= now() - interval '30 days'), 0)::numeric as completion_minutes_30
    from public.kaspi_orders
  ), branch_stats as (
    select coalesce(jsonb_agg(row_to_json(value) order by value.revenue desc), '[]'::jsonb) as value
    from (
      select coalesce(branch_name, 'Без филиала') as branch,
        count(*)::integer as orders,
        coalesce(sum(amount) filter (where status = 'paid'), 0)::numeric as revenue
      from public.kaspi_orders
      where status in ('paid', 'refunded') and created_at >= now() - interval '30 days'
      group by coalesce(branch_name, 'Без филиала')
      limit 20
    ) value
  ), top_products as (
    select coalesce(jsonb_agg(row_to_json(value) order by value.quantity desc), '[]'::jsonb) as value
    from (
      select item->>'id' as id,
        max(item->>'name') as name,
        sum(greatest(coalesce((item->>'quantity')::integer, 0), 0))::integer as quantity,
        sum(greatest(coalesce((item->>'quantity')::numeric, 0), 0) * greatest(coalesce((item->>'price')::numeric, 0), 0))::numeric as revenue
      from public.kaspi_orders cross join lateral jsonb_array_elements(cart_items) item
      where status = 'paid' and created_at >= now() - interval '30 days'
      group by item->>'id'
      order by quantity desc
      limit 10
    ) value
  ), funnel as (
    select coalesce(jsonb_object_agg(event_type, count_value), '{}'::jsonb) as value
    from (
      select event_type, count(*)::integer as count_value
      from public.customer_app_events
      where occurred_at >= now() - interval '30 days'
      group by event_type
    ) source
  )
  select jsonb_build_object(
    'totalCustomers', c.total_customers,
    'newCustomersLast30Days', c.new_customers,
    'totalSales', c.total_sales,
    'totalEarned', t.earned,
    'totalBurned', t.burned,
    'earnedLast30Days', t.earned_30,
    'burnedLast30Days', t.burned_30,
    'bonusPaymentPercent', case when c.total_sales + t.burned > 0 then round(t.burned * 100 / (c.total_sales + t.burned), 1)::text else '0.0' end,
    'currentLiabilities', c.liabilities,
    'paidOrders', o.paid_orders,
    'paidOrdersLast30Days', o.paid_orders_30,
    'salesLast30Days', o.sales_30,
    'averageOrderValueLast30Days', round(o.average_order_30, 2),
    'cancelledOrdersLast30Days', o.cancelled_30,
    'refundsLast30Days', o.refunds_30,
    'refundAmountLast30Days', o.refund_amount_30,
    'activeOrders', o.active_orders,
    'averageCompletionMinutesLast30Days', round(o.completion_minutes_30, 1),
    'branchPerformance', b.value,
    'topProducts', p.value,
    'funnel', f.value
  )
  from customer_totals c
  cross join transaction_totals t
  cross join order_totals o
  cross join branch_stats b
  cross join top_products p
  cross join funnel f;
$$;

revoke all on function public.get_admin_stats() from public, anon, authenticated;
grant execute on function public.get_admin_stats() to service_role;

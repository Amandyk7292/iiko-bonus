-- A counted branch keeps its final physical unit for walk-in sales.
-- Subtract the buffer after all other active/committed online reservations,
-- under the existing branch/product row lock, including late payment recovery.
-- Do not change physical counts or previously committed orders.

create or replace function public.reserve_order_inventory(
  p_customer_id uuid,
  p_request_id uuid,
  p_branch_id uuid,
  p_items jsonb,
  p_ttl_minutes integer default 20,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  item_id text;
  item_quantity integer;
  item_quantity_text text;
  aggregate_quantity integer;
  aggregated_items jsonb := '{}'::jsonb;
  requested_count integer := 0;
  inventory_row public.branch_product_inventory%rowtype;
  existing_row public.inventory_reservations%rowtype;
  held integer;
  reserved_count integer := 0;
  expires_at_value timestamptz;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Корзина пуста' using errcode = '22023';
  end if;

  if p_expires_at is not null then
    if p_expires_at <= now() then
      raise exception 'Срок оплаты уже истёк' using errcode = '22023';
    end if;
    if p_expires_at > now() + interval '24 hours 5 minutes' then
      raise exception 'Срок оплаты превышает допустимый срок резерва' using errcode = '22023';
    end if;
    expires_at_value := p_expires_at;
  else
    expires_at_value := now() + make_interval(
      mins => greatest(5, least(coalesce(p_ttl_minutes, 20), 1445))
    );
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := btrim(coalesce(item->>'id', ''));
    item_quantity_text := item->>'quantity';
    if item_id = ''
      or length(item_id) > 100
      or item_quantity_text is null
      or item_quantity_text !~ '^[1-9][0-9]?$' then
      raise exception 'Некорректная позиция корзины' using errcode = '22023';
    end if;

    item_quantity := item_quantity_text::integer;
    aggregate_quantity := coalesce((aggregated_items->>item_id)::integer, 0) + item_quantity;
    if aggregate_quantity > 99 then
      raise exception 'Количество одного товара не может превышать 99'
        using errcode = '22023';
    end if;
    aggregated_items := jsonb_set(
      aggregated_items,
      array[item_id],
      to_jsonb(aggregate_quantity),
      true
    );
  end loop;

  select count(*)::integer
  into requested_count
  from jsonb_object_keys(aggregated_items);

  update public.inventory_reservations
  set status = 'expired', updated_at = now()
  where status = 'active' and expires_at <= now();

  if exists (
    select 1
    from public.inventory_reservations
    where client_request_id = p_request_id
      and (customer_id <> p_customer_id or branch_id <> p_branch_id)
  ) then
    raise exception 'Конфликт идентификатора оформления' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.inventory_reservations
    where client_request_id = p_request_id
      and not (aggregated_items ? product_id)
  ) then
    raise exception 'Корзина этого оформления уже была зарезервирована'
      using errcode = 'P0001';
  end if;

  for item_id, item_quantity in
    select key, value::integer
    from jsonb_each_text(aggregated_items)
    order by key
  loop
    select *
    into inventory_row
    from public.branch_product_inventory
    where branch_id = p_branch_id and product_id = item_id
    for update;

    if found then
      if inventory_row.manual_stop then
        raise exception 'Товар «%» временно недоступен',
          coalesce(inventory_row.product_name, item_id)
          using errcode = 'P0001';
      end if;

      select *
      into existing_row
      from public.inventory_reservations
      where client_request_id = p_request_id and product_id = item_id
      for update;

      if found then
        if existing_row.customer_id <> p_customer_id
          or existing_row.branch_id <> p_branch_id then
          raise exception 'Конфликт идентификатора оформления' using errcode = 'P0001';
        end if;
        if existing_row.quantity <> item_quantity then
          raise exception 'Корзина этого оформления уже была зарезервирована'
            using errcode = 'P0001';
        end if;
        if existing_row.status = 'committed' then
          reserved_count := reserved_count + 1;
          continue;
        end if;
      end if;

      select coalesce(sum(quantity), 0)::integer
      into held
      from public.inventory_reservations
      where branch_id = p_branch_id
        and product_id = item_id
        and (
          status = 'committed'
          or (status = 'active' and expires_at > now())
        )
        and client_request_id <> p_request_id;

      if inventory_row.source_quantity is not null
        and inventory_row.source_quantity - held - 1 < item_quantity then
        raise exception 'Недостаточно товара «%». Доступно: %',
          coalesce(inventory_row.product_name, item_id),
          greatest(inventory_row.source_quantity - held - 1, 0)
          using errcode = 'P0001';
      end if;

      if existing_row.id is not null then
        update public.inventory_reservations
        set
          status = 'active',
          expires_at = greatest(expires_at, expires_at_value),
          updated_at = now()
        where id = existing_row.id;
      else
        insert into public.inventory_reservations (
          customer_id,
          client_request_id,
          branch_id,
          product_id,
          quantity,
          status,
          expires_at,
          updated_at
        ) values (
          p_customer_id,
          p_request_id,
          p_branch_id,
          item_id,
          item_quantity,
          'active',
          expires_at_value,
          now()
        );
      end if;
      reserved_count := reserved_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'reserved',
    'requested', requested_count,
    'reserved', reserved_count,
    'expiresAt', expires_at_value
  );
end;
$$;

create or replace function public.commit_order_reservations(
  p_order_id uuid,
  p_allow_reacquire boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_product record;
  requested_slot record;
  inventory_row public.branch_product_inventory%rowtype;
  location_row public.bulka_locations%rowtype;
  inventory_requested integer := 0;
  inventory_committed integer := 0;
  inventory_units_requested integer := 0;
  inventory_units_committed integer := 0;
  slot_requested integer := 0;
  slot_committed integer := 0;
  expired_count integer := 0;
  released_count integer := 0;
  slot_expired_count integer := 0;
  slot_released_count integer := 0;
  held integer := 0;
  capacity_value integer := 0;
  was_reacquired boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text, 0));

  perform id
  from public.inventory_reservations
  where order_id = p_order_id
  order by branch_id, product_id
  for update;

  perform id
  from public.fulfillment_slot_reservations
  where order_id = p_order_id
  order by branch_id, scheduled_at
  for update;

  select
    count(*)::integer,
    (count(*) filter (where status = 'committed'))::integer,
    coalesce(sum(quantity), 0)::integer,
    coalesce(sum(quantity) filter (where status = 'committed'), 0)::integer,
    (
      count(*) filter (
        where status = 'expired' or (status = 'active' and expires_at <= now())
      )
    )::integer,
    (count(*) filter (where status = 'released'))::integer
  into
    inventory_requested,
    inventory_committed,
    inventory_units_requested,
    inventory_units_committed,
    expired_count,
    released_count
  from public.inventory_reservations
  where order_id = p_order_id;

  select
    count(*)::integer,
    (count(*) filter (where status = 'committed'))::integer,
    (
      count(*) filter (
        where status = 'expired' or (status = 'active' and expires_at <= now())
      )
    )::integer,
    (count(*) filter (where status = 'released'))::integer
  into slot_requested, slot_committed, slot_expired_count, slot_released_count
  from public.fulfillment_slot_reservations
  where order_id = p_order_id;

  expired_count := expired_count + slot_expired_count;
  released_count := released_count + slot_released_count;

  if inventory_requested + slot_requested = 0 then
    return jsonb_build_object(
      'status', 'not_found',
      'inventoryRequested', 0,
      'inventoryCommitted', 0,
      'inventoryUnitsRequested', 0,
      'inventoryUnitsCommitted', 0,
      'slotRequested', 0,
      'slotCommitted', 0,
      'reacquired', false
    );
  end if;

  if inventory_requested = inventory_committed
    and slot_requested = slot_committed then
    return jsonb_build_object(
      'status', 'already_committed',
      'inventoryRequested', inventory_requested,
      'inventoryCommitted', inventory_committed,
      'inventoryUnitsRequested', inventory_units_requested,
      'inventoryUnitsCommitted', inventory_units_committed,
      'slotRequested', slot_requested,
      'slotCommitted', slot_committed,
      'reacquired', false
    );
  end if;

  if (expired_count > 0 or released_count > 0) and not p_allow_reacquire then
    if released_count > 0 then
      update public.inventory_reservations
      set status = 'released', updated_at = now()
      where order_id = p_order_id and status = 'active';
      update public.fulfillment_slot_reservations
      set status = 'released', updated_at = now()
      where order_id = p_order_id and status = 'active';
    else
      update public.inventory_reservations
      set status = 'expired', updated_at = now()
      where order_id = p_order_id and status = 'active';
      update public.fulfillment_slot_reservations
      set status = 'expired', updated_at = now()
      where order_id = p_order_id and status = 'active';
    end if;

    return jsonb_build_object(
      'status', case when released_count > 0 then 'released' else 'expired' end,
      'inventoryRequested', inventory_requested,
      'inventoryCommitted', inventory_committed,
      'inventoryUnitsRequested', inventory_units_requested,
      'inventoryUnitsCommitted', inventory_units_committed,
      'slotRequested', slot_requested,
      'slotCommitted', slot_committed,
      'reacquired', false
    );
  end if;

  was_reacquired := p_allow_reacquire and (expired_count > 0 or released_count > 0);

  for requested_product in
    select
      branch_id,
      product_id,
      sum(quantity)::integer as quantity
    from public.inventory_reservations
    where order_id = p_order_id and status <> 'committed'
    group by branch_id, product_id
    order by branch_id, product_id
  loop
    select *
    into inventory_row
    from public.branch_product_inventory
    where branch_id = requested_product.branch_id
      and product_id = requested_product.product_id
    for update;

    if not found then
      return jsonb_build_object(
        'status', 'unavailable',
        'reason', 'inventory_missing',
        'productId', requested_product.product_id,
        'inventoryRequested', inventory_requested,
        'inventoryCommitted', inventory_committed,
        'inventoryUnitsRequested', inventory_units_requested,
        'inventoryUnitsCommitted', inventory_units_committed,
        'slotRequested', slot_requested,
        'slotCommitted', slot_committed,
        'reacquired', false
      );
    end if;

    if inventory_row.manual_stop then
      return jsonb_build_object(
        'status', 'unavailable',
        'reason', 'manual_stop',
        'productId', requested_product.product_id,
        'inventoryRequested', inventory_requested,
        'inventoryCommitted', inventory_committed,
        'inventoryUnitsRequested', inventory_units_requested,
        'inventoryUnitsCommitted', inventory_units_committed,
        'slotRequested', slot_requested,
        'slotCommitted', slot_committed,
        'reacquired', false
      );
    end if;

    select coalesce(sum(quantity), 0)::integer
    into held
    from public.inventory_reservations
    where branch_id = requested_product.branch_id
      and product_id = requested_product.product_id
      and order_id is distinct from p_order_id
      and (
        status = 'committed'
        or (status = 'active' and expires_at > now())
      );

    if inventory_row.source_quantity is not null
      and inventory_row.source_quantity - held - 1 < requested_product.quantity then
      return jsonb_build_object(
        'status', 'unavailable',
        'reason', 'inventory',
        'productId', requested_product.product_id,
        'inventoryRequested', inventory_requested,
        'inventoryCommitted', inventory_committed,
        'inventoryUnitsRequested', inventory_units_requested,
        'inventoryUnitsCommitted', inventory_units_committed,
        'slotRequested', slot_requested,
        'slotCommitted', slot_committed,
        'reacquired', false
      );
    end if;
  end loop;

  for requested_slot in
    select
      branch_id,
      fulfillment_type,
      scheduled_at,
      count(*)::integer as quantity
    from public.fulfillment_slot_reservations
    where order_id = p_order_id and status <> 'committed'
    group by branch_id, fulfillment_type, scheduled_at
    order by branch_id, scheduled_at
  loop
    select *
    into location_row
    from public.bulka_locations
    where id = requested_slot.branch_id and active = true
    for update;

    if not found then
      return jsonb_build_object(
        'status', 'unavailable',
        'reason', 'branch',
        'inventoryRequested', inventory_requested,
        'inventoryCommitted', inventory_committed,
        'inventoryUnitsRequested', inventory_units_requested,
        'inventoryUnitsCommitted', inventory_units_committed,
        'slotRequested', slot_requested,
        'slotCommitted', slot_committed,
        'reacquired', false
      );
    end if;

    capacity_value := greatest(
      coalesce(
        case requested_slot.fulfillment_type
          when 'preorder' then location_row.preorder_slot_capacity
          when 'delivery' then location_row.delivery_slot_capacity
          else location_row.pickup_slot_capacity
        end,
        1
      ),
      1
    );

    select count(*)::integer
    into held
    from public.fulfillment_slot_reservations
    where branch_id = requested_slot.branch_id
      and fulfillment_type = requested_slot.fulfillment_type
      and scheduled_at = requested_slot.scheduled_at
      and order_id is distinct from p_order_id
      and (
        status = 'committed'
        or (status = 'active' and expires_at > now())
      );

    if held + requested_slot.quantity > capacity_value then
      return jsonb_build_object(
        'status', 'unavailable',
        'reason', 'slot',
        'inventoryRequested', inventory_requested,
        'inventoryCommitted', inventory_committed,
        'inventoryUnitsRequested', inventory_units_requested,
        'inventoryUnitsCommitted', inventory_units_committed,
        'slotRequested', slot_requested,
        'slotCommitted', slot_committed,
        'reacquired', false
      );
    end if;
  end loop;

  if p_allow_reacquire then
    update public.inventory_reservations
    set status = 'committed', updated_at = now()
    where order_id = p_order_id and status <> 'committed';

    update public.fulfillment_slot_reservations
    set status = 'committed', updated_at = now()
    where order_id = p_order_id and status <> 'committed';
  else
    update public.inventory_reservations
    set status = 'committed', updated_at = now()
    where order_id = p_order_id
      and status = 'active'
      and expires_at > now();

    update public.fulfillment_slot_reservations
    set status = 'committed', updated_at = now()
    where order_id = p_order_id
      and status = 'active'
      and expires_at > now();
  end if;

  select
    (count(*) filter (where status = 'committed'))::integer,
    coalesce(sum(quantity) filter (where status = 'committed'), 0)::integer
  into inventory_committed, inventory_units_committed
  from public.inventory_reservations
  where order_id = p_order_id;

  select (count(*) filter (where status = 'committed'))::integer
  into slot_committed
  from public.fulfillment_slot_reservations
  where order_id = p_order_id;

  if inventory_requested <> inventory_committed
    or slot_requested <> slot_committed then
    return jsonb_build_object(
      'status', 'unavailable',
      'reason', 'commit_incomplete',
      'inventoryRequested', inventory_requested,
      'inventoryCommitted', inventory_committed,
      'inventoryUnitsRequested', inventory_units_requested,
      'inventoryUnitsCommitted', inventory_units_committed,
      'slotRequested', slot_requested,
      'slotCommitted', slot_committed,
      'reacquired', false
    );
  end if;

  return jsonb_build_object(
    'status', 'committed',
    'inventoryRequested', inventory_requested,
    'inventoryCommitted', inventory_committed,
    'inventoryUnitsRequested', inventory_units_requested,
    'inventoryUnitsCommitted', inventory_units_committed,
    'slotRequested', slot_requested,
    'slotCommitted', slot_committed,
    'reacquired', was_reacquired
  );
end;
$$;

revoke all on function public.reserve_order_inventory(uuid,uuid,uuid,jsonb,integer,timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_order_inventory(uuid,uuid,uuid,jsonb,integer,timestamptz)
  to service_role;
revoke all on function public.commit_order_reservations(uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.commit_order_reservations(uuid,boolean) to service_role;

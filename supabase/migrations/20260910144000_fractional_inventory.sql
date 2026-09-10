-- Preserve stock to thousandths (e.g. 0.125 kg); whole-unit rows retain step 1.
-- migration-safety: allow-destructive reason=widen integer quantities to exact decimal without truncation or row removal
alter table public.branch_product_inventory
  alter column source_quantity type numeric(12,3), alter column front_quantity type numeric(12,3),
  add column quantity_step numeric(4,3) not null default 1 check(quantity_step in (1,0.001)),
  add column unit text not null default 'шт';
alter table public.inventory_reservations alter column quantity type numeric(12,3);

create or replace function public.reserve_order_inventory_before_front_guard(
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
  item_quantity numeric;
  item_quantity_text text;
  aggregate_quantity numeric;
  aggregated_items jsonb := '{}'::jsonb;
  requested_count integer := 0;
  inventory_row public.branch_product_inventory%rowtype;
  existing_row public.inventory_reservations%rowtype;
  held numeric;
  buffer_units numeric;
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
      or item_quantity_text !~ '^[0-9]{1,2}(\.[0-9]{1,3})?$' or item_quantity_text::numeric<=0 or item_quantity_text::numeric>99 then
      raise exception 'Некорректная позиция корзины' using errcode = '22023';
    end if;

    item_quantity := item_quantity_text::numeric;
    aggregate_quantity := coalesce((aggregated_items->>item_id)::numeric, 0) + item_quantity;
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

  select count(*)::numeric
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
    select key, value::numeric
    from jsonb_each_text(aggregated_items)
    order by key
  loop
    select *
    into inventory_row
    from public.branch_product_inventory
    where branch_id = p_branch_id and product_id = item_id
    for update;

    if found then
      if mod(item_quantity,inventory_row.quantity_step)<>0 then raise exception 'Количество не соответствует единице товара' using errcode='22023'; end if;
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

      select coalesce(sum(quantity), 0)::numeric
      into held
      from public.inventory_reservations
      where branch_id = p_branch_id
        and product_id = item_id
        and (
          status = 'committed'
          or (status = 'active' and expires_at > now())
        )
        and client_request_id <> p_request_id;

      -- The walk-in unit is required for NEW allocations. Once the online
      -- allocation is held, selling that last walk-in unit cannot revoke it.
      buffer_units := case when existing_row.status='active' and existing_row.expires_at>now()
        and exists(select 1 from public.front_stock_policies where branch_id=p_branch_id and enabled)
        then 0 else inventory_row.quantity_step end;
      if inventory_row.source_quantity is not null
        and inventory_row.source_quantity - held - buffer_units < item_quantity then
        raise exception 'Недостаточно товара «%». Доступно: %',
          coalesce(inventory_row.product_name, item_id),
          greatest(inventory_row.source_quantity - held - buffer_units, 0)
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
  inventory_units_requested numeric := 0;
  inventory_units_committed numeric := 0;
  slot_requested integer := 0;
  slot_committed integer := 0;
  expired_count integer := 0;
  released_count integer := 0;
  slot_expired_count integer := 0;
  slot_released_count integer := 0;
  held numeric := 0;
  buffer_units numeric;
  capacity_value integer := 0;
  was_reacquired boolean := false;
begin
  -- Match POS/recount lock order before locking reservation rows.
  perform b.id from public.bulka_locations b where b.id in (
    select branch_id from public.inventory_reservations where order_id=p_order_id
    union select branch_id from public.fulfillment_slot_reservations where order_id=p_order_id
  ) order by b.id for update;
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
    count(*)::numeric,
    (count(*) filter (where status = 'committed'))::numeric,
    coalesce(sum(quantity), 0)::numeric,
    coalesce(sum(quantity) filter (where status = 'committed'), 0)::numeric,
    (
      count(*) filter (
        where status = 'expired' or (status = 'active' and expires_at <= now())
      )
    )::numeric,
    (count(*) filter (where status = 'released'))::numeric
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
    count(*)::numeric,
    (count(*) filter (where status = 'committed'))::numeric,
    (
      count(*) filter (
        where status = 'expired' or (status = 'active' and expires_at <= now())
      )
    )::numeric,
    (count(*) filter (where status = 'released'))::numeric
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
      sum(quantity)::numeric as quantity
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

    select coalesce(sum(quantity), 0)::numeric
    into held
    from public.inventory_reservations
    where branch_id = requested_product.branch_id
      and product_id = requested_product.product_id
      and order_id is distinct from p_order_id
      and (
        status = 'committed'
        or (status = 'active' and expires_at > now())
      );

    buffer_units := case when exists(select 1 from public.front_stock_policies
        where branch_id=requested_product.branch_id and enabled)
      and not exists(select 1 from public.inventory_reservations where order_id=p_order_id
        and branch_id=requested_product.branch_id and product_id=requested_product.product_id
        and status<>'committed' and (status<>'active' or expires_at<=now()))
      then 0 else inventory_row.quantity_step end;
    if inventory_row.source_quantity is not null
      and inventory_row.source_quantity - held - buffer_units < requested_product.quantity then
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
      count(*)::numeric as quantity
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

    select count(*)::numeric
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
    (count(*) filter (where status = 'committed'))::numeric,
    coalesce(sum(quantity) filter (where status = 'committed'), 0)::numeric
  into inventory_committed, inventory_units_committed
  from public.inventory_reservations
  where order_id = p_order_id;

  select (count(*) filter (where status = 'committed'))::numeric
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

create or replace function public.authorize_front_stock_sale(p_branch uuid,p_terminal uuid,p_receipt uuid,p_items jsonb,
  p_total numeric,p_loyalty_key text,p_online_number bigint default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sale front_stock_sales%rowtype; online kaspi_orders%rowtype; policy front_stock_policies%rowtype;
  product text; qty numeric; available numeric; held numeric; expected jsonb;
begin
  perform assert_front_stock_ready(p_branch);
  select * into policy from front_stock_policies where branch_id=p_branch;
  if not found or not policy.enabled then raise exception 'Общий учёт ещё не включён на филиале' using errcode='P0001'; end if;
  if p_terminal is null or not p_terminal=any(policy.terminal_ids) or p_receipt is null
    or p_total is null or p_total<0 or p_total<>round(p_total,2) or p_total>10000000
    or p_loyalty_key is null or p_loyalty_key !~ '^bp1:[0-9a-f-]{36}:[0-9a-f]{64}$'
    or p_items is null or jsonb_typeof(p_items)<>'object' or p_items='{}'::jsonb then
    raise exception 'Некорректный чек кассы' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each_text(p_items) x where length(x.key) not between 1 and 100
    or x.value !~ '^[0-9]{1,4}(\.[0-9]{1,3})?$' or x.value::numeric<=0 or x.value::numeric>9999) then
    raise exception 'Количество должно быть положительным, до трёх знаков после запятой' using errcode='22023';
  end if;
  if p_online_number is not null then
    select * into online from kaspi_orders where branch_id=p_branch and order_number=p_online_number for update;
    if not found or online.status<>'paid' or online.fulfillment_status not in ('preparing','ready')
      or online.refund_status is not null then
      raise exception 'Онлайн-заказ недоступен для пробития' using errcode='P0001';
    end if;
  end if;
  select * into sale from front_stock_sales where branch_id=p_branch and receipt_id=p_receipt for update;
  if found then
    if sale.terminal_id<>p_terminal or sale.items<>p_items or (sale.online_order_id is not null and sale.receipt_total<>p_total)
      or sale.online_order_id is distinct from online.id or sale.loyalty_order_key<>p_loyalty_key then
      raise exception 'Чек уже закреплён с другим составом или кассой. Требуется сверка.' using errcode='P0001';
    end if;
    if sale.status<>'reserved' then raise exception 'Чек уже завершён. Повторная продажа запрещена.' using errcode='P0001'; end if;
    update front_stock_sales set receipt_total=p_total,updated_at=now() where branch_id=p_branch and receipt_id=p_receipt;
    return jsonb_build_object('status','reserved','duplicate',true,'onlineOrderId',sale.online_order_id);
  end if;
  if online.id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_loyalty_key,0));
    perform pg_advisory_xact_lock(hashtextextended(p_receipt::text,0));
    select jsonb_object_agg(product_id,q) into expected from (
      select product_id,sum(quantity)::numeric q from inventory_reservations where order_id=online.id and status='committed' group by product_id
    ) x;
    if expected is distinct from p_items then raise exception 'Состав чека не совпадает с онлайн-заказом' using errcode='P0001'; end if;
    if p_total<>greatest(0,online.subtotal-coalesce(online.discount_amount,0)-coalesce(online.bonus_spent,0)) then
      raise exception 'Сумма товаров в чеке не совпадает с онлайн-заказом. Ожидается: %',
        greatest(0,online.subtotal-coalesce(online.discount_amount,0)-coalesce(online.bonus_spent,0)) using errcode='P0001';
    end if;
    if exists(select 1 from jsonb_each_text(p_items) x where not exists(select 1 from branch_product_inventory
      where branch_id=p_branch and product_id=x.key and source_quantity>=x.value::numeric)) then
      raise exception 'Остаток онлайн-заказа требует сверки' using errcode='P0001';
    end if;
    if exists(select 1 from loyalty_reservations where order_id in (p_loyalty_key,p_receipt::text)
      and status in ('active','committed')) then
      raise exception 'Уберите отдельную бонусную операцию: онлайн-заказ уже учтён' using errcode='P0001';
    end if;
    if exists(select 1 from gift_card_pos_reservations where branch_id=p_branch and iiko_order_id=p_receipt::text and status in ('active','committed')) then
      raise exception 'Уберите отдельную оплату сертификатом: онлайн-заказ уже оплачен' using errcode='P0001';
    end if;
  else
    for product,qty in select key,value::numeric from jsonb_each_text(p_items) order by key loop
      select source_quantity into available from branch_product_inventory
        where branch_id=p_branch and product_id=product and not manual_stop for update;
      if not found or available is null then raise exception 'Нет подтверждённого остатка товара %',product using errcode='P0001'; end if;
      select coalesce(sum(quantity),0)::numeric into held from inventory_reservations
        where branch_id=p_branch and product_id=product and (status='committed' or (status='active' and expires_at>now()));
      if available-held<qty then raise exception 'Товар уже зарезервирован. Доступно: %',greatest(0,available-held) using errcode='P0001'; end if;
      perform set_config('bulka.front_guard_write','true',true);
      perform set_config('bulka.stock_follow_iiko','true',true);
      update branch_product_inventory set source_quantity=source_quantity-qty,updated_at=now()
        where branch_id=p_branch and product_id=product;
    end loop;
  end if;
  insert into front_stock_sales(branch_id,receipt_id,terminal_id,online_order_id,loyalty_order_key,items,receipt_total,status)
    values(p_branch,p_receipt,p_terminal,online.id,p_loyalty_key,p_items,p_total,'reserved');
  return jsonb_build_object('status','reserved','duplicate',false,'onlineOrderId',online.id);
end;
$$;

create or replace function public.finish_front_stock_sale(p_branch uuid,p_terminal uuid,p_receipt uuid,p_state text,p_items jsonb,p_total numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sale front_stock_sales%rowtype; product text; qty numeric;
begin
  -- Completion is accepted even after a heartbeat outage; it is reconciliation,
  -- never permission for a new sale. No timeout automatically releases a POS debit.
  perform id from bulka_locations where id=p_branch for update;
  select * into sale from front_stock_sales where branch_id=p_branch and receipt_id=p_receipt;
  if sale.online_order_id is not null then perform id from kaspi_orders where id=sale.online_order_id for update; end if;
  if sale.receipt_id is null or sale.terminal_id<>p_terminal or p_state not in ('closed','voided')
    or p_state is null or p_items is distinct from sale.items or p_total is distinct from sale.receipt_total then
    raise exception 'Состояние или состав чека не совпадает с резервом' using errcode='P0001';
  end if;
  if sale.status=p_state then return jsonb_build_object('status',p_state,'duplicate',true); end if;
  if sale.status<>'reserved' then raise exception 'Итог чека уже зафиксирован. Требуется сверка.' using errcode='P0001'; end if;
  if sale.online_order_id is not null then
    perform set_config('bulka.front_guard_write','true',true);
    perform set_config('bulka.stock_follow_iiko','true',true);
    for product,qty in select key,value::numeric from jsonb_each_text(sale.items) order by key loop
      update branch_product_inventory set source_quantity=source_quantity-qty,updated_at=now()
        where branch_id=p_branch and product_id=product and source_quantity>=qty;
      if not found then raise exception 'Остаток связанного заказа требует сверки' using errcode='P0001'; end if;
    end loop;
    if p_state='closed' then
      update inventory_reservations set status='released',updated_at=now() where order_id=sale.online_order_id and status='committed';
    end if;
  end if;
  -- Voiding proves no cheque will be paid again. It does NOT prove that products
  -- were returned to the display (printed items may have been wasted).
  update front_stock_sales set status=p_state,updated_at=now() where branch_id=p_branch and receipt_id=p_receipt;
  return jsonb_build_object('status',p_state,'duplicate',false);
end;
$$;

create or replace function public.check_front_shared_reservation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare available numeric; held numeric; already_held boolean := false; buffer_units numeric := 1;
begin
  if new.status not in ('active','committed') or not exists(select 1 from front_stock_policies where branch_id=new.branch_id and enabled) then return new; end if;
  perform id from bulka_locations where id=new.branch_id for update;
  if tg_op='UPDATE' then
    already_held := new.branch_id=old.branch_id and new.product_id=old.product_id
      and new.customer_id=old.customer_id and new.client_request_id=old.client_request_id
      and new.quantity<=old.quantity
      and (old.status='committed' or (old.status='active' and old.expires_at>now()));
  end if;
  if already_held then buffer_units:=0; else perform assert_front_stock_ready(new.branch_id); end if;
  select source_quantity,case when already_held then 0 else quantity_step end into available,buffer_units from branch_product_inventory where branch_id=new.branch_id and product_id=new.product_id for update;
  select coalesce(sum(quantity),0)::numeric into held from inventory_reservations where branch_id=new.branch_id
    and product_id=new.product_id and id<>new.id and (status='committed' or (status='active' and expires_at>now()));
  if available is null or available-held-buffer_units<new.quantity then
    raise exception 'Количество товара не подтверждено или уже занято' using errcode='P0001';
  end if;
  return new;
end;
$$;

create or replace function public.consume_completed_manual_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare refunded_quantity numeric;
begin
  if old.status = 'committed' and new.status = 'released' and old.order_id is not null
    and exists(select 1 from public.kaspi_orders where id = old.order_id
      and (fulfillment_status = 'completed' or kitchen_status = 'handed_over')) then
    select coalesce(sum(items.quantity), 0)::numeric into refunded_quantity
      from public.order_partial_refund_items items
      join public.order_partial_refunds refunds on refunds.id = items.refund_id
      where refunds.order_id = old.order_id and refunds.status = 'succeeded'
        and items.product_id = old.product_id;
    update public.branch_product_inventory
      set source_quantity = greatest(0, source_quantity - greatest(0, old.quantity - refunded_quantity)), updated_at = now()
      where branch_id = old.branch_id and product_id = old.product_id
        and source = 'admin' and source_quantity is not null;
  end if;
  return new;
end;
$$;

create or replace function public.apply_front_inventory_snapshot(
  p_branch_id uuid, p_terminal_id uuid, p_terminal_group_id uuid,
  p_session_id uuid, p_sequence bigint, p_captured_at timestamptz, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  previous public.branch_front_inventory_sync%rowtype;
  item jsonb;
  updated_count integer := 0;
  affected integer;
  reconnected boolean;
  changed_ids text[] := '{}';
begin
  if p_sequence is null or p_sequence <= 0 or p_session_id is null or p_terminal_id is null
    or p_terminal_group_id is null or p_captured_at is null
    or p_captured_at < now() - interval '2 minutes' or p_captured_at > now() + interval '1 minute'
    or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 450 then
    raise exception 'Invalid iikoFront snapshot' using errcode = '22023';
  end if;
  -- Serialize whole snapshots of this branch, including the first connection.
  perform id from public.bulka_locations where id = p_branch_id and active = true for update;
  if not found then raise exception 'Inactive branch' using errcode = '22023'; end if;
  select * into previous from public.branch_front_inventory_sync where branch_id = p_branch_id for update;
  if found then
    if previous.terminal_group_id <> p_terminal_group_id then
      raise exception 'Another iikoFront group is bound to this branch' using errcode = '22023';
    end if;
    if (previous.session_id = p_session_id and previous.sequence >= p_sequence)
      or previous.captured_at >= p_captured_at then
      return jsonb_build_object('applied', false, 'changed', false);
    end if;
  end if;
  reconnected := previous.last_seen_at is null or previous.last_seen_at < now() - interval '45 seconds';
  perform set_config('bulka.front_snapshot', 'true', true);
  if exists(select 1 from jsonb_array_elements(p_items) x where
      jsonb_typeof(x->'productId') is distinct from 'string' or length(x->>'productId') not between 1 and 100
      or jsonb_typeof(x->'quantity') is distinct from 'number' or (x->>'quantity') !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$'
      or (x->>'quantity')::numeric > 100000)
    or (select count(*) from jsonb_array_elements(p_items)) <>
       (select count(distinct x->>'productId') from jsonb_array_elements(p_items) x) then
    raise exception 'Invalid iikoFront products' using errcode = '22023';
  end if;
  insert into public.branch_front_inventory_sync values
    (p_branch_id, p_terminal_id, p_terminal_group_id, p_session_id, p_sequence, p_captured_at, now())
    on conflict(branch_id) do update set terminal_id = excluded.terminal_id,
      session_id = excluded.session_id, sequence = excluded.sequence,
      captured_at = excluded.captured_at, last_seen_at = now();

  -- A full snapshot also communicates removal from the finite stop list.
  with changed as (update public.branch_product_inventory inv set
    front_quantity = null, front_managed = true,
    source_quantity = case when source = 'admin' then source_quantity else null end,
    last_synced_at = now(), updated_at = now()
    where branch_id = p_branch_id and source in ('admin', 'iiko')
      and (front_quantity is not null or not front_managed)
      and not exists(select 1 from jsonb_array_elements(p_items) x where x->>'productId' = inv.product_id)
    returning product_id)
  select count(*), coalesce(array_agg(product_id), '{}') into affected, changed_ids from changed;
  updated_count := updated_count + affected;

  for item in select value from jsonb_array_elements(p_items) order by value->>'productId' loop
    insert into public.branch_product_inventory as inv
      (branch_id, product_id, product_name, source_quantity, source, front_quantity, front_managed, last_synced_at,quantity_step,unit)
    values (p_branch_id, item->>'productId', left(item->>'productName',160),
      (item->>'quantity')::numeric, 'iiko', (item->>'quantity')::numeric, true, now(),coalesce((item->>'quantityStep')::numeric,1),coalesce(nullif(left(item->>'unit',16),''),'шт'))
    on conflict(branch_id,product_id) do update set
      front_quantity = excluded.front_quantity, front_managed = true,quantity_step=excluded.quantity_step,unit=excluded.unit,
      source_quantity = case when inv.source in ('admin', 'custom') then inv.source_quantity else excluded.source_quantity end,
      source = case when inv.source in ('admin', 'custom') then inv.source else 'iiko' end,
      last_synced_at = now(), updated_at = now()
    where inv.front_quantity is distinct from excluded.front_quantity or not inv.front_managed or inv.quantity_step is distinct from excluded.quantity_step or inv.unit is distinct from excluded.unit;
    get diagnostics affected = row_count;
    updated_count := updated_count + affected;
    if affected > 0 then changed_ids := array_append(changed_ids, item->>'productId'); end if;
  end loop;
  return jsonb_build_object('applied', true, 'changed', updated_count > 0 or reconnected,
    'updated', updated_count, 'productIds', to_jsonb(changed_ids));
end;
$$;

create or replace function public.update_admin_inventory(p_stock jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  saved public.branch_product_inventory%rowtype;
  selected_quantity numeric := (p_stock->>'source_quantity')::numeric;
  selected_source text := case when selected_quantity is null then 'iiko' else 'admin' end;
  selected_branch uuid := (p_stock->>'branch_id')::uuid;
begin
  if selected_quantity < 0 or selected_quantity > 100000
    or coalesce(length(p_stock->>'product_id'), 0) not between 1 and 100 then
    raise exception 'Некорректный остаток' using errcode = '22023';
  end if;
  perform id from public.bulka_locations where id = selected_branch and active = true for update;
  if not found then raise exception 'Филиал больше недоступен' using errcode = '22023'; end if;
  select * into saved from public.branch_product_inventory
    where branch_id = selected_branch and product_id = p_stock->>'product_id' for update;
  if selected_quantity is not null and mod(selected_quantity,coalesce(saved.quantity_step,1))<>0 then
    raise exception 'Количество не соответствует единице товара' using errcode='22023';
  end if;
  if selected_source = 'iiko' and exists (
    select 1 from public.branch_front_inventory_sync where branch_id = selected_branch
  ) then
    if not exists(select 1 from public.branch_front_inventory_sync
      where branch_id = selected_branch and last_seen_at > now() - interval '45 seconds') then
      raise exception 'Нет свежих остатков iikoFront. Укажите количество вручную.' using errcode = '40001';
    end if;
    selected_quantity := saved.front_quantity;
  end if;
  perform set_config('bulka.stock_follow_iiko', 'true', true);
  insert into public.branch_product_inventory
    (branch_id, product_id, product_name, source_quantity, source, manual_stop, preparation_minutes)
    values (selected_branch, p_stock->>'product_id', left(p_stock->>'product_name',160),
      selected_quantity, selected_source, coalesce((p_stock->>'manual_stop')::boolean,false),
      (p_stock->>'preparation_minutes')::numeric)
    on conflict(branch_id,product_id) do update set
      product_name = excluded.product_name, source_quantity = excluded.source_quantity,
      source = excluded.source, manual_stop = excluded.manual_stop,
      preparation_minutes = excluded.preparation_minutes, updated_at = now()
    returning * into saved;
  return to_jsonb(saved);
end;
$$;

create or replace function public.update_cashier_inventory_before_tablet(
  p_branch_id uuid, p_product_id text, p_product_name text,
  p_expected_revision bigint, p_changes jsonb
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare stock public.branch_product_inventory%rowtype;
begin
  if p_expected_revision is null or p_expected_revision < 0
    or p_product_id is null or length(p_product_id) not between 1 and 100
    or p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Некорректные данные остатка' using errcode = '22023';
  end if;
  if not (p_changes ? 'sourceQuantity' or p_changes ? 'manualStop' or p_changes ? 'useIiko')
    or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('sourceQuantity', 'manualStop', 'useIiko'))
    or (p_changes ? 'useIiko' and (p_changes->'useIiko' <> 'true'::jsonb or p_changes ? 'sourceQuantity' or p_changes ? 'manualStop'))
    or (p_changes ? 'manualStop' and jsonb_typeof(p_changes->'manualStop') <> 'boolean')
    or (p_changes ? 'sourceQuantity' and (jsonb_typeof(p_changes->'sourceQuantity') <> 'number'
      or (p_changes->>'sourceQuantity') !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$'
      or (p_changes->>'sourceQuantity')::numeric > 100000)) then
    raise exception 'Укажите целый остаток от 0 до 100000' using errcode = '22023';
  end if;
  if not exists(select 1 from public.bulka_locations where id = p_branch_id and active = true) then
    raise exception 'Филиал больше недоступен' using errcode = 'P0001';
  end if;
  insert into public.branch_product_inventory(branch_id, product_id, product_name, source)
    values(p_branch_id, p_product_id, left(p_product_name, 160),
      case when exists(select 1 from public.custom_products where id::text = p_product_id) then 'admin' else 'iiko' end)
    on conflict(branch_id, product_id) do nothing;
  select * into stock from public.branch_product_inventory
    where branch_id = p_branch_id and product_id = p_product_id for update;
  if stock.stock_revision <> p_expected_revision then
    raise exception 'Остаток уже изменился. Проверьте новые данные и повторите сохранение.'
      using errcode = '40001';
  end if;
  if p_changes ? 'useIiko' then
    if not exists(select 1 from public.branch_front_inventory_sync
      where branch_id = p_branch_id and last_seen_at > now() - interval '45 seconds') then
      raise exception 'Нет свежих остатков iikoFront' using errcode = '40001';
    end if;
    perform set_config('bulka.stock_follow_iiko', 'true', true);
    update public.branch_product_inventory set source_quantity = front_quantity,
      source = 'iiko', manual_stop = false, updated_at = now()
      where branch_id = p_branch_id and product_id = p_product_id returning * into stock;
    return to_jsonb(stock);
  end if;
  update public.branch_product_inventory set
    source_quantity = case when p_changes ? 'sourceQuantity' then (p_changes->>'sourceQuantity')::numeric else source_quantity end,
    source = case when p_changes ? 'sourceQuantity' then 'admin' else source end,
    manual_stop = case when p_changes ? 'manualStop' then (p_changes->>'manualStop')::boolean else manual_stop end,
    product_name = left(p_product_name, 160), updated_at = now()
    where branch_id = p_branch_id and product_id = p_product_id returning * into stock;
  return to_jsonb(stock);
end;
$$;

create or replace function public.finish_front_stock_recount(p_branch uuid,p_terminal uuid,p_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare policy front_stock_policies%rowtype; item jsonb; held numeric;
begin
  perform id from bulka_locations where id=p_branch for update;
  if exists(select 1 from front_stock_recounts where id=p_id and branch_id=p_branch and terminal_id=p_terminal and items=p_items) then
    return jsonb_build_object('status','completed','recountId',p_id);
  end if;
  select * into policy from front_stock_policies where branch_id=p_branch for update;
  if not found or not policy.enabled or not policy.paused or policy.recount_id is distinct from p_id
    or p_terminal is null or not p_terminal=any(policy.terminal_ids)
    or not exists(select 1 from branch_front_inventory_sync where branch_id=p_branch and terminal_id=p_terminal)
    or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 450 then
    raise exception 'Сверка остатков не подтверждена' using errcode='P0001';
  end if;
  if exists(select 1 from front_stock_sales where branch_id=p_branch and status='reserved') then
    raise exception 'Есть незавершённый чек' using errcode='P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where x->>'productId' is null
    or length(x->>'productId') not between 1 and 100 or x->>'quantity' is null
    or x->>'quantity' !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$' or (x->>'quantity')::numeric>100000)
    or (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct x->>'productId') from jsonb_array_elements(p_items) x) then
    raise exception 'Некорректный состав сверки' using errcode='22023';
  end if;
  if exists(select 1 from inventory_reservations r where r.branch_id=p_branch and r.status='committed'
    and not exists(select 1 from jsonb_array_elements(p_items) x where x->>'productId'=r.product_id)) then
    raise exception 'В сверке отсутствует товар оплаченного онлайн-заказа' using errcode='P0001';
  end if;
  perform set_config('bulka.front_guard_write','true',true);
  perform set_config('bulka.stock_follow_iiko','true',true);
  -- Omitted items are UNKNOWN, never unlimited, in the strict allocation mode.
  update branch_product_inventory set source_quantity=null,updated_at=now() where branch_id=p_branch;
  for item in select value from jsonb_array_elements(p_items) order by value->>'productId' loop
    select coalesce(sum(quantity),0)::numeric into held from inventory_reservations where branch_id=p_branch
      and product_id=item->>'productId' and status='committed';
    if (item->>'quantity')::numeric<held then
      raise exception 'Фактического товара не хватает для оплаченных заказов. Нужна сверка заказа.' using errcode='P0001';
    end if;
    insert into branch_product_inventory(branch_id,product_id,product_name,source_quantity,source)
      values(p_branch,item->>'productId',left(item->>'productName',160),(item->>'quantity')::numeric,'iiko')
      on conflict(branch_id,product_id) do update set source_quantity=excluded.source_quantity,source='iiko',updated_at=now();
  end loop;
  insert into front_stock_recounts(id,branch_id,terminal_id,items) values(p_id,p_branch,p_terminal,p_items);
  update front_stock_policies set paused=false,recount_id=null,updated_at=now() where branch_id=p_branch;
  return jsonb_build_object('status','completed','recountId',p_id);
end;
$$;

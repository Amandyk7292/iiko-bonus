-- New preorders are produced for the selected time. They do not reserve the
-- current display. Existing reservations retain their original stock allocation.
alter table public.inventory_reservations add column allocation_kind text not null default 'display'
  check(allocation_kind in ('display','preorder')),add column preorder_for timestamptz;
alter table public.branch_product_inventory add column preorder_stop boolean not null default false;

create function public.reserve_preorder_inventory(p_customer_id uuid,p_request_id uuid,p_branch_id uuid,p_items jsonb,
  p_scheduled_at timestamptz,p_ttl_minutes integer default 20,p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item record; saved inventory_reservations%rowtype; stock branch_product_inventory%rowtype;
  expires timestamptz; requested jsonb;
begin
  perform id from bulka_locations where id=p_branch_id and active for update;
  if not found or p_customer_id is null or p_request_id is null or p_scheduled_at is null
    or p_scheduled_at<now()+interval '24 hours' or p_scheduled_at>now()+interval '60 days'
    or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Предзаказ принимается минимум за 24 часа до получения' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where length(coalesce(x->>'id','')) not between 1 and 100
    or coalesce(x->>'quantity','') !~ '^[0-9]{1,2}(\.[0-9]{1,3})?$' or (x->>'quantity')::numeric<=0) then
    raise exception 'Некорректное количество' using errcode='22023';
  end if;
  select jsonb_object_agg(id,qty) into requested from (
    select x->>'id' id,sum((x->>'quantity')::numeric) qty from jsonb_array_elements(p_items) x group by x->>'id'
  ) items;
  expires:=coalesce(p_expires_at,now()+make_interval(mins=>greatest(5,least(p_ttl_minutes,1445))));
  if expires<=now() or expires>now()+interval '24 hours 5 minutes' then raise exception 'Некорректный срок оплаты' using errcode='22023'; end if;
  if exists(select 1 from inventory_reservations where client_request_id=p_request_id
    and (customer_id<>p_customer_id or branch_id<>p_branch_id or allocation_kind<>'preorder'
      or preorder_for is distinct from p_scheduled_at or not requested ? product_id)) then
    raise exception 'Конфликт идентификатора оформления' using errcode='P0001';
  end if;
  for item in select key id,value::numeric qty from jsonb_each_text(requested) order by key loop
    insert into branch_product_inventory(branch_id,product_id,source)
      values(p_branch_id,item.id,'admin') on conflict(branch_id,product_id) do nothing;
    select * into stock from branch_product_inventory where branch_id=p_branch_id and product_id=item.id for update;
    if stock.preorder_stop or item.qty>99 or mod(item.qty,stock.quantity_step)<>0 then
      raise exception 'Предзаказ товара временно недоступен' using errcode='P0001';
    end if;
    select * into saved from inventory_reservations where client_request_id=p_request_id and product_id=item.id for update;
    if found and saved.quantity<>item.qty then raise exception 'Состав оформления уже закреплён' using errcode='P0001'; end if;
    if saved.status='committed' then continue; end if;
    if saved.id is null then
      insert into inventory_reservations(customer_id,client_request_id,branch_id,product_id,allocation_kind,preorder_for,quantity,status,expires_at)
        values(p_customer_id,p_request_id,p_branch_id,item.id,'preorder',p_scheduled_at,item.qty,'active',expires);
    else
      update inventory_reservations set status='active',expires_at=expires,updated_at=now() where id=saved.id;
    end if;
  end loop;
  return jsonb_build_object('status','reserved','count',(select count(*) from jsonb_object_keys(requested)),'expiresAt',expires);
end;
$$;

create function public.update_preorder_stop(p_branch uuid,p_product text,p_stopped boolean,p_revision bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare saved branch_product_inventory%rowtype;
begin
  perform id from bulka_locations where id=p_branch and active for update;
  if not found or p_stopped is null then raise exception 'Филиал недоступен' using errcode='P0001'; end if;
  select * into saved from branch_product_inventory where branch_id=p_branch and product_id=p_product for update;
  if coalesce(saved.stock_revision,0) is distinct from p_revision then raise exception 'Товар уже изменился. Обновите список.' using errcode='40001'; end if;
  insert into branch_product_inventory(branch_id,product_id,source)
    values(p_branch,p_product,'admin') on conflict(branch_id,product_id) do nothing;
  select * into saved from branch_product_inventory where branch_id=p_branch and product_id=p_product for update;
  update branch_product_inventory set preorder_stop=p_stopped,stock_revision=stock_revision+1,updated_at=now()
    where branch_id=p_branch and product_id=p_product returning * into saved;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.reserve_preorder_inventory(uuid,uuid,uuid,jsonb,timestamptz,integer,timestamptz),
  public.update_preorder_stop(uuid,text,boolean,bigint) from public,anon,authenticated;
grant execute on function public.reserve_preorder_inventory(uuid,uuid,uuid,jsonb,timestamptz,integer,timestamptz),
  public.update_preorder_stop(uuid,text,boolean,bigint) to service_role;

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

  if exists(select 1 from inventory_reservations where client_request_id=p_request_id and allocation_kind<>'display') then
    raise exception 'Оформление уже закреплено как предзаказ' using errcode='P0001';
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
        and allocation_kind='display'
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
      product_id,allocation_kind,
      sum(quantity)::numeric as quantity
    from public.inventory_reservations
    where order_id = p_order_id and status <> 'committed'
    group by branch_id, product_id,allocation_kind
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

    if requested_product.allocation_kind='preorder' then
      if inventory_row.preorder_stop then return jsonb_build_object('status','unavailable','reason','preorder_stop'); end if;
      continue;
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
      and allocation_kind='display'
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

create or replace function public.check_front_shared_reservation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare available numeric; held numeric; already_held boolean := false; buffer_units numeric := 1;
begin
  if new.allocation_kind='preorder' then return new; end if;
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
    and product_id=new.product_id and id<>new.id and allocation_kind='display' and (status='committed' or (status='active' and expires_at>now()));
  if available is null or available-held-buffer_units<new.quantity then
    raise exception 'Количество товара не подтверждено или уже занято' using errcode='P0001';
  end if;
  return new;
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
  if exists(select 1 from jsonb_each_text(p_items) x join branch_product_inventory i on i.branch_id=p_branch and i.product_id=x.key
    where mod(x.value::numeric,i.quantity_step)<>0) then
    raise exception 'Количество не соответствует единице измерения товара' using errcode='22023';
  end if;
  if p_online_number is not null then
    select * into online from kaspi_orders where branch_id=p_branch and order_number=p_online_number for update;
    if not found or online.status<>'paid' or (online.fulfillment_status not in ('preparing','ready') and not (online.fulfillment_status='completed' and online.pos_receipt_due))
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
    select coalesce((select items from front_online_stock_settlements where order_id=online.id),expected) into expected;
    if expected is distinct from p_items then raise exception 'Состав чека не совпадает с онлайн-заказом' using errcode='P0001'; end if;
    if p_total<>greatest(0,online.subtotal-coalesce(online.discount_amount,0)-coalesce(online.bonus_spent,0)) then
      raise exception 'Сумма товаров в чеке не совпадает с онлайн-заказом. Ожидается: %',
        greatest(0,online.subtotal-coalesce(online.discount_amount,0)-coalesce(online.bonus_spent,0)) using errcode='P0001';
    end if;
    if not exists(select 1 from front_online_stock_settlements where order_id=online.id) and exists(select 1 from inventory_reservations where order_id=online.id and allocation_kind='display') and exists(select 1 from jsonb_each_text(p_items) x where not exists(select 1 from branch_product_inventory
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
        where branch_id=p_branch and product_id=product and allocation_kind='display' and (status='committed' or (status='active' and expires_at>now()));
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

create or replace function public.settle_front_online_stock(p_order uuid,p_origin text,p_actor text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare target kaspi_orders%rowtype; expected jsonb; product text; qty numeric;
begin
  select * into target from kaspi_orders where id=p_order;
  perform id from bulka_locations where id=target.branch_id for update;
  perform id from kaspi_orders where id=p_order for update;
  if exists(select 1 from front_online_stock_settlements where order_id=p_order) then return; end if;
  if exists(select 1 from front_stock_sales where online_order_id=p_order and status='closed') then return; end if;
  select jsonb_object_agg(product_id,q) into expected from (
    select product_id,sum(quantity) q from inventory_reservations
    where order_id=p_order and status='committed' group by product_id
  ) x;
  if expected is null or exists(select 1 from inventory_reservations where order_id=p_order and status<>'committed') then
    raise exception 'Дождитесь подтверждения полного резерва заказа' using errcode='P0001';
  end if;
  perform set_config('bulka.front_guard_write','true',true);
  perform set_config('bulka.stock_follow_iiko','true',true);
  for product,qty in select product_id,sum(quantity) from inventory_reservations where order_id=p_order and status='committed' and allocation_kind='display' group by product_id order by product_id loop
    update branch_product_inventory set source_quantity=source_quantity-qty,updated_at=now()
      where branch_id=target.branch_id and product_id=product and source_quantity>=qty;
    if not found then raise exception 'Количество собранного товара требует сверки' using errcode='P0001'; end if;
  end loop;
  insert into front_online_stock_settlements(order_id,branch_id,items,origin,actor)
    values(p_order,target.branch_id,expected,p_origin,coalesce(p_actor,'staff'));
  update inventory_reservations set status='released',updated_at=now()
    where order_id=p_order and status='committed';
end;
$$;

create or replace function public.consume_completed_manual_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare refunded_quantity numeric;
begin
  if old.allocation_kind='preorder' then return new; end if;
  if exists(select 1 from front_online_stock_settlements where order_id=old.order_id) then return new; end if;
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

create or replace function public.update_cashier_inventory(p_branch_id uuid,p_product_id text,p_product_name text,
  p_expected_revision bigint,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare policy front_stock_policies%rowtype; held numeric;
begin
  perform id from bulka_locations where id=p_branch_id for update;
  select * into policy from front_stock_policies where branch_id=p_branch_id for update;
  if policy.enabled and p_changes ? 'sourceQuantity' then
    if policy.control_mode<>'tablet' or policy.paused then
      raise exception 'Включите резервное управление с планшета или измените остаток на кассе' using errcode='P0001';
    end if;
    if exists(select 1 from front_stock_sales where branch_id=p_branch_id and status='reserved' and items ? p_product_id) then
      raise exception 'По этому товару есть незавершённый кассовый чек. Сначала сверяйте его итог.' using errcode='P0001';
    end if;
    select coalesce(sum(quantity),0) into held from inventory_reservations where branch_id=p_branch_id and product_id=p_product_id
      and allocation_kind='display' and (status='committed' or (status='active' and expires_at>now()));
    if (p_changes->>'sourceQuantity')::numeric<held then
      raise exception 'Количество меньше резерва оплачиваемых и оплаченных заказов' using errcode='P0001';
    end if;
    perform set_config('bulka.front_guard_write','true',true);
  end if;
  if policy.enabled and p_changes ? 'useIiko' then
    raise exception 'Возврат управления кассе выполняется полной сверкой на главной кассе' using errcode='P0001';
  end if;
  return update_cashier_inventory_before_tablet(p_branch_id,p_product_id,p_product_name,p_expected_revision,p_changes);
end;
$$;

create or replace function public.pause_unexplained_front_stock_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare held numeric;
begin
  if current_setting('bulka.front_snapshot',true)='true' and exists(select 1 from front_stock_policies
      where branch_id=new.branch_id and enabled and control_mode='front') and new.source_quantity is not null then
    select coalesce(sum(quantity),0) into held from inventory_reservations where branch_id=new.branch_id and product_id=new.product_id
      and allocation_kind='display' and (status='committed' or (status='active' and expires_at>now()));
    if new.front_quantity is null or new.front_quantity<greatest(0,new.source_quantity-held) then
      update front_stock_policies set paused=true,updated_at=now() where branch_id=new.branch_id and not paused;
    end if;
  end if;
  return new;
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
  if exists(select 1 from inventory_reservations r where r.branch_id=p_branch and r.allocation_kind='display' and r.status='committed'
    and not exists(select 1 from jsonb_array_elements(p_items) x where x->>'productId'=r.product_id)) then
    raise exception 'В сверке отсутствует товар оплаченного онлайн-заказа' using errcode='P0001';
  end if;
  perform set_config('bulka.front_guard_write','true',true);
  perform set_config('bulka.stock_follow_iiko','true',true);
  -- Omitted items are UNKNOWN, never unlimited, in the strict allocation mode.
  update branch_product_inventory set source_quantity=null,updated_at=now() where branch_id=p_branch;
  for item in select value from jsonb_array_elements(p_items) order by value->>'productId' loop
    select coalesce(sum(quantity),0)::numeric into held from inventory_reservations where branch_id=p_branch
      and product_id=item->>'productId' and allocation_kind='display' and status='committed';
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

create or replace function public.check_front_inventory_freshness()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.allocation_kind='preorder' then return new; end if;
  if new.status = 'active' and exists (
    select 1 from public.branch_front_inventory_sync sync
    where sync.branch_id = new.branch_id and sync.last_seen_at < now() - interval '45 seconds'
      and not exists(select 1 from public.branch_product_inventory inv
        where inv.branch_id = new.branch_id and inv.product_id = new.product_id and inv.source in ('admin', 'custom'))
  ) then
    raise exception 'Остаток товара требует подтверждения кассиром' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.preserve_manual_branch_stock()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.front_managed and new.source = 'iiko'
    and current_setting('bulka.front_snapshot', true) is distinct from 'true'
    and current_setting('bulka.stock_follow_iiko', true) is distinct from 'true' then
    new.source_quantity := old.source_quantity;
    new.source := old.source;
  end if;
  if old.source = 'admin' and new.source = 'iiko'
    and current_setting('bulka.stock_follow_iiko', true) is distinct from 'true' then
    new.source_quantity := old.source_quantity;
    new.source := old.source;
    new.manual_stop := old.manual_stop;
  end if;
  if (new.source_quantity, new.manual_stop, new.source, new.front_quantity, new.front_managed, new.preorder_stop, new.quantity_step, new.unit)
    is distinct from (old.source_quantity, old.manual_stop, old.source, old.front_quantity, old.front_managed, old.preorder_stop, old.quantity_step, old.unit) then
    new.stock_revision := old.stock_revision + 1;
  else
    new.stock_revision := old.stock_revision;
  end if;
  return new;
end;
$$;

create or replace function public.prepare_order_substitution_execution(
  p_order_id uuid,
  p_request_id uuid,
  p_replacement jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.kaspi_orders%rowtype;
  v_request public.order_substitution_requests%rowtype;
  v_item jsonb;
  v_item_line_key text;
  v_item_product_id text;
  v_original_item jsonb;
  v_original_position integer := -1;
  v_original_quantity numeric := 0;
  v_original_unit numeric(12,2) := 0;
  v_replacement_id text;
  v_replacement_name text;
  v_replacement_line_key text;
  v_replacement_unit numeric(12,2);
  v_charged_unit numeric(12,2);
  v_refund_amount numeric(12,2) := 0;
  v_waived_amount numeric(12,2) := 0;
  v_replacement_item jsonb;
  v_original_reservation public.inventory_reservations%rowtype;
  v_replacement_reservation public.inventory_reservations%rowtype;
  v_inventory public.branch_product_inventory%rowtype;
  v_previous_replacement_quantity numeric := 0;
  v_held numeric := 0;
  v_payload jsonb;
begin
  if p_order_id is null or p_request_id is null then
    raise exception 'order and substitution request are required';
  end if;

  perform id from public.bulka_locations where id=(select branch_id from public.kaspi_orders where id=p_order_id) for update;
  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text, 0));

  select * into v_order
  from public.kaspi_orders
  where id = p_order_id
  for update;
  if v_order.id is null then raise exception 'order not found'; end if;

  select * into v_request
  from public.order_substitution_requests
  where id = p_request_id and order_id = p_order_id
  for update;
  if v_request.id is null then raise exception 'substitution request not found'; end if;

  if v_request.status = 'completed' then
    return v_request.execution_payload || jsonb_build_object(
      'status', 'completed',
      'duplicate', true,
      'refundId', v_request.refund_id
    );
  end if;

  if v_request.status = 'processing'
    and v_request.execution_payload <> '{}'::jsonb then
    return v_request.execution_payload || jsonb_build_object(
      'status', 'prepared',
      'duplicate', true,
      'refundId', v_request.refund_id
    );
  end if;

  if coalesce(v_order.partially_refunded_amount,0)>0 then
    raise exception 'После частичного возврата состав заказа менять нельзя. Доступен возврат оставшихся позиций.' using errcode='P0001';
  end if;
  if v_request.action = 'replace_with_approval' and v_request.status <> 'approved' then
    raise exception 'replacement is not approved';
  end if;
  if v_request.action = 'remove_refund' and v_request.status <> 'processing' then
    raise exception 'removal is not ready for execution';
  end if;
  if v_request.action not in ('replace_with_approval', 'remove_refund') then
    raise exception 'substitution action is not executable';
  end if;
  if v_order.status <> 'paid'
    or coalesce(v_order.fulfillment_status, 'pending') in ('completed', 'cancelled') then
    raise exception 'order is not active and paid';
  end if;
  if v_order.customer_id is distinct from v_request.customer_id then
    raise exception 'substitution customer mismatch';
  end if;
  if v_order.branch_id is null or v_order.client_request_id is null then
    raise exception 'order reservation metadata is missing';
  end if;

  for v_item, v_original_position in
    select value, (ordinality - 1)::numeric
    from jsonb_array_elements(coalesce(v_order.cart_items, '[]'::jsonb))
      with ordinality
  loop
    v_item_line_key := coalesce(
      nullif(btrim(v_item->>'lineKey'), ''),
      coalesce(
        nullif(btrim(v_item->>'id'), ''),
        nullif(btrim(v_item->>'productId'), ''),
        'item'
      ) || ':' || v_original_position::text
    );
    if v_item_line_key = v_request.line_key then
      v_original_item := v_item;
      exit;
    end if;
  end loop;

  if v_original_item is null then raise exception 'order line not found'; end if;
  v_item_product_id := coalesce(
    nullif(btrim(v_original_item->>'id'), ''),
    nullif(btrim(v_original_item->>'productId'), '')
  );
  if v_item_product_id is distinct from v_request.product_id then
    raise exception 'order line product changed';
  end if;
  if coalesce(v_original_item->>'quantity', '') !~ '^[0-9]{1,2}(\.[0-9]{1,3})?$' then
    raise exception 'order line quantity is invalid';
  end if;
  v_original_quantity := (v_original_item->>'quantity')::numeric;
  if mod(v_request.quantity,coalesce((v_original_item->>'quantityStep')::numeric,1))<>0 then raise exception 'quantity does not match product unit'; end if;
  if v_request.quantity > v_original_quantity then
    raise exception 'order line quantity is no longer available';
  end if;
  if coalesce(v_original_item->>'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
    raise exception 'order line price is invalid';
  end if;
  v_original_unit := (v_original_item->>'price')::numeric;
  if v_original_unit <= 0 then raise exception 'order line price is invalid'; end if;

  select * into v_original_reservation
  from public.inventory_reservations
  where order_id = v_order.id
    and product_id = v_request.product_id
    and status = 'committed'
  order by id
  limit 1
  for update;
  if v_original_reservation.id is not null
    and v_original_reservation.quantity < v_request.quantity then
    raise exception 'original inventory reservation is insufficient';
  end if;

  if v_request.action = 'replace_with_approval' then
    if p_replacement is null or jsonb_typeof(p_replacement) <> 'object' then
      raise exception 'replacement product is required';
    end if;
    v_replacement_id := nullif(btrim(p_replacement->>'id'), '');
    v_replacement_name := nullif(btrim(p_replacement->>'name'), '');
    v_replacement_line_key := nullif(btrim(p_replacement->>'lineKey'), '');
    if v_replacement_id is null
      or v_replacement_id <> v_request.replacement_product_id
      or length(v_replacement_id) > 100
      or v_replacement_name is null
      or length(v_replacement_name) > 160 then
      raise exception 'replacement product changed';
    end if;
    if coalesce(p_replacement->>'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'replacement price is invalid';
    end if;
    v_replacement_unit := (p_replacement->>'price')::numeric;
    if v_replacement_unit <= 0 then raise exception 'replacement price is invalid'; end if;
    if v_replacement_unit > v_original_unit then
      raise exception 'replacement price exceeds original price';
    end if;
    if v_replacement_line_key is null then
      v_replacement_line_key := v_replacement_id || ':substitution:' || v_request.id::text;
    end if;
    if length(v_replacement_line_key) > 220 then
      raise exception 'replacement line key is invalid';
    end if;

    v_charged_unit := v_replacement_unit;
    v_refund_amount := round(
      coalesce((v_original_item->>'lineTotal')::numeric,round(v_original_unit*v_original_quantity))*v_request.quantity/v_original_quantity
    ) - round(
      v_charged_unit * v_request.quantity
    );
    v_waived_amount := 0;
    if v_refund_amount > 0
      and coalesce(v_order.refund_status, '') in ('processing', 'unknown') then
      raise exception 'another refund is already being processed';
    end if;

    select * into v_inventory
    from public.branch_product_inventory
    where branch_id = v_order.branch_id and product_id = v_replacement_id
    for update;
    if v_inventory.branch_id is null or (case when v_original_reservation.allocation_kind='preorder' then v_inventory.preorder_stop else v_inventory.manual_stop end) then
      raise exception 'replacement inventory is unavailable';
    end if;

    if mod(v_request.quantity,v_inventory.quantity_step)<>0 then raise exception 'replacement quantity does not match product unit'; end if;
    select * into v_replacement_reservation
    from public.inventory_reservations
    where client_request_id = v_order.client_request_id
      and product_id = v_replacement_id
    for update;

    if v_replacement_reservation.id is not null then
      if v_replacement_reservation.allocation_kind is distinct from coalesce(v_original_reservation.allocation_kind,'display') or v_replacement_reservation.order_id is distinct from v_order.id
        or v_replacement_reservation.customer_id is distinct from v_order.customer_id
        or v_replacement_reservation.branch_id is distinct from v_order.branch_id then
        raise exception 'replacement reservation ownership conflict';
      end if;
      if v_replacement_reservation.status = 'committed' then
        v_previous_replacement_quantity := v_replacement_reservation.quantity;
      elsif v_replacement_reservation.status in ('released', 'expired') then
        v_previous_replacement_quantity := 0;
      else
        raise exception 'replacement reservation state conflict';
      end if;
    end if;
    if v_previous_replacement_quantity + v_request.quantity > 99 then
      raise exception 'replacement quantity exceeds reservation limit';
    end if;

    select coalesce(sum(reservation.quantity), 0)::numeric
    into v_held
    from public.inventory_reservations reservation
    where reservation.branch_id = v_order.branch_id
      and reservation.product_id = v_replacement_id
      and reservation.allocation_kind='display'
      and (
        reservation.status = 'committed'
        or (reservation.status = 'active' and reservation.expires_at > now())
      )
      and (
        v_replacement_reservation.id is null
        or reservation.id <> v_replacement_reservation.id
      );
    if coalesce(v_original_reservation.allocation_kind,'display')='display' and v_inventory.source_quantity is not null
      and v_inventory.source_quantity - v_held - v_previous_replacement_quantity
        < v_request.quantity then
      raise exception 'replacement inventory is insufficient';
    end if;

    if v_replacement_reservation.id is null then
      insert into public.inventory_reservations(
        customer_id,
        client_request_id,
        order_id,
        branch_id,
        product_id,
        allocation_kind,
        preorder_for,
        quantity,
        status,
        expires_at,
        updated_at
      ) values (
        v_order.customer_id,
        v_order.client_request_id,
        v_order.id,
        v_order.branch_id,
        v_replacement_id,
        coalesce(v_original_reservation.allocation_kind,'display'),
        v_original_reservation.preorder_for,
        v_request.quantity,
        'committed',
        now() + interval '365 days',
        now()
      )
      returning * into v_replacement_reservation;
    else
      update public.inventory_reservations
      set
        quantity = v_previous_replacement_quantity + v_request.quantity,
        status = 'committed',
        order_id = v_order.id,
        expires_at = greatest(expires_at, now() + interval '365 days'),
        updated_at = now()
      where id = v_replacement_reservation.id
      returning * into v_replacement_reservation;
    end if;

    v_replacement_item := jsonb_build_object(
      'id', v_replacement_id,
      'iikoProductId', nullif(btrim(p_replacement->>'iikoProductId'), ''),
      'productSizeId', nullif(btrim(p_replacement->>'productSizeId'), ''),
      'name', v_replacement_name,
      'price', v_charged_unit,
      'basePrice', v_charged_unit,
      'catalogPrice', v_replacement_unit,
      'quantity', v_request.quantity,
      'quantityStep', coalesce((p_replacement->>'quantityStep')::numeric,1),
      'unit', coalesce(p_replacement->>'unit','шт.'),
      'lineTotal', round(v_charged_unit*v_request.quantity),
      'source', left(coalesce(nullif(btrim(p_replacement->>'source'), ''), 'iiko'), 40),
      'preparationMinutes', case
        when coalesce(p_replacement->>'preparationMinutes', '') ~ '^[1-9][0-9]{0,2}$'
          then (p_replacement->>'preparationMinutes')::numeric
        else null
      end,
      'configuration', case
        when jsonb_typeof(p_replacement->'configuration') = 'object'
          then p_replacement->'configuration'
        else null
      end,
      'modifiers', case
        when jsonb_typeof(p_replacement->'modifiers') = 'array'
          then p_replacement->'modifiers'
        else '[]'::jsonb
      end,
      'lineKey', v_replacement_line_key,
      'substitutionRequestId', v_request.id
    );
  end if;

  v_payload := jsonb_build_object(
    'action', v_request.action,
    'quantity', v_request.quantity,
    'originalLineKey', v_request.line_key,
    'originalPosition', v_original_position,
    'originalProductId', v_request.product_id,
    'originalUnitAmount', v_original_unit,
    'originalGross', round(coalesce((v_original_item->>'lineTotal')::numeric,round(v_original_unit*v_original_quantity))*v_request.quantity/v_original_quantity),
    'originalReservationId', v_original_reservation.id,
    'replacementProductId', v_replacement_id,
    'replacementUnitAmount', v_replacement_unit,
    'chargedUnitAmount', v_charged_unit,
    'refundAmount', v_refund_amount,
    'waivedAmount', v_waived_amount,
    'replacementItem', v_replacement_item,
    'replacementReservationId', v_replacement_reservation.id,
    'replacementReservationPreviousQuantity', v_previous_replacement_quantity
  );

  update public.order_substitution_requests
  set
    status = 'processing',
    execution_payload = v_payload,
    execution_started_at = coalesce(execution_started_at, now()),
    original_unit_amount = v_original_unit,
    replacement_unit_amount = v_replacement_unit,
    charged_unit_amount = v_charged_unit,
    refund_amount = v_refund_amount,
    waived_amount = v_waived_amount,
    error = null,
    completed_at = null,
    updated_at = now()
  where id = v_request.id;

  return v_payload || jsonb_build_object(
    'status', 'prepared',
    'duplicate', false,
    'refundId', v_request.refund_id
  );
end;
$$;

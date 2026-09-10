alter table public.order_partial_refund_items alter column quantity type numeric(12,3);
alter table public.order_substitution_requests alter column quantity type numeric(12,3);
-- migration-safety: allow-destructive reason=replace whole-unit quantity bound with a three-decimal positive quantity bound; existing requests remain valid
alter table public.order_substitution_requests drop constraint order_substitution_requests_quantity_check;
alter table public.order_substitution_requests add constraint order_substitution_requests_quantity_check check(quantity between 0.001 and 99);

create or replace function public.claim_partial_refund(
  p_order_id uuid,
  p_idempotency_key uuid,
  p_processor_token uuid,
  p_amount numeric,
  p_reason text,
  p_requested_by text,
  p_items jsonb
)
returns public.order_partial_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.kaspi_orders%rowtype;
  v_refund public.order_partial_refunds%rowtype;
  v_item jsonb;
  v_line_key text;
  v_quantity numeric;
  v_original_quantity numeric;
  v_claimed_quantity numeric;
  v_items_amount numeric(12,2) := 0;
begin
  if p_order_id is null or p_idempotency_key is null or p_processor_token is null then
    raise exception 'order, idempotency key and processor token are required';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid refund amount'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid refund items';
  end if;

  perform pg_advisory_xact_lock(hashtext('partial-refund-claim:' || p_order_id::text));

  select * into v_refund
  from public.order_partial_refunds
  where order_id = p_order_id and idempotency_key = p_idempotency_key;
  if v_refund.id is not null then return v_refund; end if;

  select * into v_order from public.kaspi_orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'order not found'; end if;
  if v_order.status <> 'paid' then raise exception 'order is not paid'; end if;
  if coalesce(v_order.refund_status, '') in ('processing', 'unknown') then
    raise exception 'another refund is already being processed';
  end if;
  if coalesce(v_order.partially_refunded_amount, 0) + p_amount > v_order.amount then
    raise exception 'refund exceeds order amount';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line_key := nullif(btrim(v_item->>'line_key'), '');
    v_quantity := coalesce((v_item->>'quantity')::numeric, 0);
    v_original_quantity := coalesce((v_item->>'original_quantity')::numeric, 0);
    if v_line_key is null or v_quantity < 0.001 or v_quantity<>round(v_quantity,3) or v_original_quantity < v_quantity then
      raise exception 'invalid refund line';
    end if;

    select coalesce(sum(items.quantity), 0)::numeric into v_claimed_quantity
    from public.order_partial_refund_items items
    join public.order_partial_refunds refunds on refunds.id = items.refund_id
    where refunds.order_id = p_order_id
      and refunds.status in ('processing', 'succeeded')
      and items.line_key = v_line_key;
    if v_claimed_quantity + v_quantity > v_original_quantity then
      raise exception 'refund quantity already claimed for line %', v_line_key;
    end if;
    v_items_amount := v_items_amount + coalesce((v_item->>'refund_amount')::numeric, 0);
  end loop;

  if round(v_items_amount, 2) <> round(p_amount, 2) then
    raise exception 'refund amount does not match items';
  end if;

  insert into public.order_partial_refunds(
    order_id, idempotency_key, processor_token, amount, reason, status, requested_by
  ) values (
    p_order_id,
    p_idempotency_key,
    p_processor_token,
    p_amount,
    nullif(btrim(p_reason), ''),
    'processing',
    left(coalesce(nullif(btrim(p_requested_by), ''), 'admin'), 160)
  ) returning * into v_refund;

  insert into public.order_partial_refund_items(
    refund_id, line_key, product_id, product_name, quantity, unit_amount, refund_amount
  )
  select
    v_refund.id,
    item->>'line_key',
    coalesce(item->>'product_id', ''),
    left(coalesce(item->>'product_name', 'Товар'), 200),
    (item->>'quantity')::numeric,
    coalesce((item->>'unit_amount')::numeric, 0),
    coalesce((item->>'refund_amount')::numeric, 0)
  from jsonb_array_elements(p_items) item;

  -- The order itself is the cross-flow mutex. A full cancellation and another
  -- partial refund must not reach Kaspi while this request is in flight.
  update public.kaspi_orders
  set refund_status = 'processing',
      refund_requested_at = now(),
      refund_error = null,
      updated_at = now()
  where id = p_order_id;

  return v_refund;
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
    if v_inventory.branch_id is null or v_inventory.manual_stop then
      raise exception 'replacement inventory is unavailable';
    end if;

    select * into v_replacement_reservation
    from public.inventory_reservations
    where client_request_id = v_order.client_request_id
      and product_id = v_replacement_id
    for update;

    if v_replacement_reservation.id is not null then
      if v_replacement_reservation.order_id is distinct from v_order.id
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
      and (
        reservation.status = 'committed'
        or (reservation.status = 'active' and reservation.expires_at > now())
      )
      and (
        v_replacement_reservation.id is null
        or reservation.id <> v_replacement_reservation.id
      );
    if v_inventory.source_quantity is not null
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

create or replace function public.abort_order_substitution_execution(
  p_order_id uuid,
  p_request_id uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.order_substitution_requests%rowtype;
  v_reservation_id uuid;
  v_previous_quantity numeric := 0;
begin
  perform id from public.bulka_locations where id=(select branch_id from public.kaspi_orders where id=p_order_id) for update;
  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text, 0));

  select * into v_request
  from public.order_substitution_requests
  where id = p_request_id and order_id = p_order_id
  for update;
  if v_request.id is null or v_request.status not in ('approved', 'processing') then
    return false;
  end if;

  if nullif(v_request.execution_payload->>'replacementReservationId', '') is not null then
    v_reservation_id :=
      (v_request.execution_payload->>'replacementReservationId')::uuid;
    v_previous_quantity := coalesce(
      (v_request.execution_payload->>'replacementReservationPreviousQuantity')::numeric,
      0
    );
    if v_previous_quantity > 0 then
      update public.inventory_reservations
      set quantity = v_previous_quantity, status = 'committed', updated_at = now()
      where id = v_reservation_id and order_id = p_order_id;
    else
      update public.inventory_reservations
      set status = 'released', updated_at = now()
      where id = v_reservation_id and order_id = p_order_id;
    end if;
  end if;

  update public.order_substitution_requests
  set
    status = 'failed',
    error = left(coalesce(nullif(btrim(p_error), ''), 'Substitution execution failed'), 1000),
    completed_at = now(),
    updated_at = now()
  where id = v_request.id;
  return true;
end;
$$;

create or replace function public.complete_order_substitution_execution(
  p_order_id uuid,
  p_request_id uuid,
  p_refund_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.kaspi_orders%rowtype;
  v_request public.order_substitution_requests%rowtype;
  v_refund public.order_partial_refunds%rowtype;
  v_payload jsonb;
  v_action text;
  v_quantity numeric;
  v_original_position integer;
  v_original_line_key text;
  v_original_product_id text;
  v_original_unit numeric(12,2);
  v_replacement_unit numeric(12,2);
  v_refund_amount numeric(12,2) := 0;
  v_line_refund_amount numeric(12,2) := 0;
  v_original_gross numeric(12,2);
  v_discount_reduction numeric(12,2) := 0;
  v_original_reservation_id uuid;
  v_replacement_reservation_id uuid;
  v_previous_replacement_quantity numeric := 0;
  v_original_reservation public.inventory_reservations%rowtype;
  v_replacement_reservation public.inventory_reservations%rowtype;
  v_replacement_item jsonb;
  v_replacement_line_key text;
  v_has_replacement_line boolean := false;
  v_item jsonb;
  v_normalized_item jsonb;
  v_item_line_key text;
  v_item_product_id text;
  v_position integer;
  v_item_quantity numeric;
  v_found_original boolean := false;
  v_new_cart jsonb := '[]'::jsonb;
  v_subtotal_reduction numeric(12,2) := 0;
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
    return jsonb_build_object(
      'status', 'completed',
      'duplicate', true,
      'requestId', v_request.id,
      'refundId', v_request.refund_id,
      'refundAmount', v_request.refund_amount,
      'waivedAmount', v_request.waived_amount,
      'effectiveAmount', greatest(
        0,
        coalesce(v_order.amount, 0) - coalesce(v_order.partially_refunded_amount, 0)
      )
    );
  end if;
  if v_request.status <> 'processing'
    or v_request.execution_payload = '{}'::jsonb then
    raise exception 'substitution execution is not prepared';
  end if;
  if v_order.status not in ('paid', 'refunded') then
    raise exception 'order payment state changed';
  end if;

  v_payload := v_request.execution_payload;
  v_action := v_payload->>'action';
  v_quantity := coalesce((v_payload->>'quantity')::numeric, 0);
  v_original_position := coalesce((v_payload->>'originalPosition')::numeric, -1);
  v_original_line_key := v_payload->>'originalLineKey';
  v_original_product_id := v_payload->>'originalProductId';
  v_original_unit := coalesce((v_payload->>'originalUnitAmount')::numeric, 0);
  v_replacement_unit := coalesce((v_payload->>'replacementUnitAmount')::numeric, 0);
  v_refund_amount := coalesce((v_payload->>'refundAmount')::numeric, 0);
  v_original_gross := coalesce((v_payload->>'originalGross')::numeric,round(v_original_unit * v_quantity));
  v_replacement_item := v_payload->'replacementItem';
  v_replacement_line_key := v_replacement_item->>'lineKey';
  v_original_reservation_id :=
    nullif(v_payload->>'originalReservationId', '')::uuid;
  v_replacement_reservation_id :=
    nullif(v_payload->>'replacementReservationId', '')::uuid;
  v_previous_replacement_quantity := coalesce(
    (v_payload->>'replacementReservationPreviousQuantity')::numeric,
    0
  );

  if v_action not in ('replace_with_approval', 'remove_refund')
    or v_quantity < 0.001 or v_original_unit <= 0 then
    raise exception 'substitution execution payload is invalid';
  end if;

  if v_action = 'remove_refund' or v_refund_amount > 0 then
    if p_refund_id is null then raise exception 'completed refund is required'; end if;
    select * into v_refund
    from public.order_partial_refunds
    where id = p_refund_id and order_id = p_order_id
    for update;
    if v_refund.id is null or v_refund.status <> 'succeeded' then
      raise exception 'refund is not completed';
    end if;
    if v_action = 'replace_with_approval'
      and round(v_refund.amount, 2) <> round(v_refund_amount, 2) then
      raise exception 'replacement refund amount mismatch';
    end if;
    v_refund_amount := v_refund.amount;
    select coalesce(sum(refund_item.refund_amount), 0)
    into v_line_refund_amount
    from public.order_partial_refund_items refund_item
    where refund_item.refund_id = v_refund.id
      and refund_item.line_key = v_request.line_key;
  elsif p_refund_id is not null then
    raise exception 'unexpected refund for equal-price replacement';
  end if;

  if v_original_reservation_id is not null then
    select * into v_original_reservation
    from public.inventory_reservations
    where id = v_original_reservation_id and order_id = p_order_id
    for update;
    if v_original_reservation.id is null
      or v_original_reservation.status <> 'committed'
      or v_original_reservation.quantity < v_quantity then
      raise exception 'original inventory reservation changed';
    end if;
  end if;

  if v_action = 'replace_with_approval' then
    if v_replacement_reservation_id is null
      or v_replacement_item is null
      or jsonb_typeof(v_replacement_item) <> 'object'
      or v_replacement_unit <= 0
      or v_replacement_unit > v_original_unit then
      raise exception 'replacement execution payload is invalid';
    end if;
    select * into v_replacement_reservation
    from public.inventory_reservations
    where id = v_replacement_reservation_id and order_id = p_order_id
    for update;
    if v_replacement_reservation.id is null
      or v_replacement_reservation.status <> 'committed'
      or v_replacement_reservation.quantity
        < v_previous_replacement_quantity + v_quantity then
      raise exception 'replacement inventory reservation changed';
    end if;

    for v_item, v_position in
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
        ) || ':' || v_position::text
      );
      if v_position <> v_original_position
        and v_item_line_key = v_replacement_line_key then
        v_has_replacement_line := true;
        exit;
      end if;
    end loop;
  end if;

  for v_item, v_position in
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
      ) || ':' || v_position::text
    );
    v_normalized_item := jsonb_set(
      v_item,
      '{lineKey}',
      to_jsonb(v_item_line_key),
      true
    );

    if v_position = v_original_position then
      v_item_product_id := coalesce(
        nullif(btrim(v_item->>'id'), ''),
        nullif(btrim(v_item->>'productId'), '')
      );
      if v_item_line_key <> v_original_line_key
        or v_item_product_id is distinct from v_original_product_id
        or coalesce(v_item->>'quantity', '') !~ '^[0-9]{1,2}(\.[0-9]{1,3})?$' then
        raise exception 'original order line changed';
      end if;
      v_item_quantity := (v_item->>'quantity')::numeric;
      if v_item_quantity < v_quantity then
        raise exception 'original order line quantity changed';
      end if;
      v_found_original := true;
      if v_item_quantity > v_quantity then
        v_new_cart := v_new_cart || jsonb_build_array(
          jsonb_set(
            jsonb_set(v_normalized_item,'{lineTotal}',to_jsonb(greatest(0,coalesce((v_item->>'lineTotal')::numeric,round(v_original_unit*v_item_quantity))-v_original_gross))),
            '{quantity}',
            to_jsonb(v_item_quantity - v_quantity),
            true
          )
        );
      end if;
      if v_action = 'replace_with_approval' and not v_has_replacement_line then
        v_new_cart := v_new_cart || jsonb_build_array(v_replacement_item);
      end if;
    elsif v_action = 'replace_with_approval'
      and v_has_replacement_line
      and v_item_line_key = v_replacement_line_key then
      if coalesce(v_item->>'quantity', '') !~ '^[0-9]{1,2}(\.[0-9]{1,3})?$' then
        raise exception 'replacement order line quantity is invalid';
      end if;
      v_new_cart := v_new_cart || jsonb_build_array(
        jsonb_set(
          jsonb_set(v_normalized_item,'{lineTotal}',to_jsonb(coalesce((v_item->>'lineTotal')::numeric,round(v_replacement_unit*(v_item->>'quantity')::numeric))+round(v_replacement_unit*v_quantity))),
          '{quantity}',
          to_jsonb((v_item->>'quantity')::numeric + v_quantity),
          true
        )
      );
    else
      v_new_cart := v_new_cart || jsonb_build_array(v_normalized_item);
    end if;
  end loop;
  if not v_found_original then raise exception 'original order line changed'; end if;

  if v_original_reservation.id is not null then
    if v_original_reservation.quantity = v_quantity then
      update public.inventory_reservations
      set status = 'released', updated_at = now()
      where id = v_original_reservation.id;
    else
      update public.inventory_reservations
      set quantity = quantity - v_quantity, updated_at = now()
      where id = v_original_reservation.id;
    end if;
  end if;

  if v_action = 'remove_refund' then
    v_subtotal_reduction := v_original_gross;
    v_discount_reduction := least(
      coalesce(v_order.discount_amount, 0),
      greatest(0, v_original_gross - v_line_refund_amount)
    );
  else
    v_subtotal_reduction := round(
      v_original_gross - round(v_replacement_unit * v_quantity)
    );
  end if;

  update public.kaspi_orders
  set
    cart_items = v_new_cart,
    subtotal = greatest(
      0,
      coalesce(
        subtotal,
        amount - coalesce(delivery_fee, 0) + coalesce(discount_amount, 0)
      ) - v_subtotal_reduction
    ),
    discount_amount = greatest(
      0,
      coalesce(discount_amount, 0) - v_discount_reduction
    ),
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  update public.order_substitution_requests
  set
    status = 'completed',
    refund_id = p_refund_id,
    refund_amount = v_refund_amount,
    error = null,
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = v_request.id;

  return jsonb_build_object(
    'status', 'completed',
    'duplicate', false,
    'requestId', v_request.id,
    'refundId', p_refund_id,
    'refundAmount', v_refund_amount,
    'waivedAmount', coalesce(v_request.waived_amount, 0),
    'subtotal', v_order.subtotal,
    'discountAmount', v_order.discount_amount,
    'effectiveAmount', greatest(
      0,
      coalesce(v_order.amount, 0) - coalesce(v_order.partially_refunded_amount, 0)
    )
  );
end;
$$;

-- Returning an unavailable delivery must preserve merchandise cashback,
-- spent bonuses, family owner and merchandise turnover. Full refunds remain full.
create or replace function public.apply_partial_refund_adjustments(p_refund_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.order_partial_refunds%rowtype;
  v_order public.kaspi_orders%rowtype;
  v_customer public.customers%rowtype;
  v_existing public.order_partial_refund_adjustments%rowtype;
  v_original_order_id text;
  v_total_refunded numeric(12,2) := 0;
  v_delivery_refunded numeric(12,2) := 0;
  v_goods_refunded numeric(12,2) := 0;
  v_ratio numeric := 0;
  v_target_earned numeric(12,2) := 0;
  v_prior_earned numeric(12,2) := 0;
  v_delta_earned numeric(12,2) := 0;
  v_pending_transaction_id uuid;
  v_pending_available numeric(12,2) := 0;
  v_pending_cancelled numeric(12,2) := 0;
  v_active_removed numeric(12,2) := 0;
  v_held_balance numeric := 0;
  v_unrecovered numeric(12,2) := 0;
  v_original_spent numeric(12,2) := 0;
  v_target_spent numeric(12,2) := 0;
  v_prior_spent numeric(12,2) := 0;
  v_delta_spent numeric(12,2) := 0;
  v_eligible_paid numeric(12,2) := 0;
  v_target_real_money numeric(12,2) := 0;
  v_prior_real_money numeric(12,2) := 0;
  v_delta_real_money numeric(12,2) := 0;
  v_current_promo_discount numeric(12,2) := 0;
  v_promotion_id uuid;
  v_promotion_released boolean := false;
begin
  if p_refund_id is null then raise exception 'refund id is required'; end if;

  select * into v_refund
  from public.order_partial_refunds
  where id = p_refund_id
  for update;
  if v_refund.id is null then raise exception 'refund not found'; end if;
  if v_refund.status <> 'succeeded' then raise exception 'refund is not completed'; end if;

  select * into v_existing
  from public.order_partial_refund_adjustments
  where refund_id = p_refund_id;
  if v_existing.refund_id is not null then
    return jsonb_build_object(
      'duplicate', true,
      'earnedBonusReversed', v_existing.earned_bonus_reversed,
      'pendingBonusCancelled', v_existing.pending_bonus_cancelled,
      'activeBonusRemoved', v_existing.active_bonus_removed,
      'unrecoveredBonus', v_existing.unrecovered_bonus,
      'spentBonusRestored', v_existing.spent_bonus_restored,
      'realMoneyReversed', v_existing.real_money_reversed,
      'promoDiscountRefunded', v_existing.promo_discount_refunded,
      'promotionUsageReleased', v_existing.promotion_usage_released
    );
  end if;

  select * into v_order
  from public.kaspi_orders
  where id = v_refund.order_id
  for update;
  if v_order.id is null then raise exception 'order not found'; end if;

  perform pg_advisory_xact_lock(hashtext('partial-refund:' || v_order.id::text));
  if coalesce(v_order.bonus_customer_id, v_order.customer_id) is not null then
    perform pg_advisory_xact_lock(hashtext(coalesce(v_order.bonus_customer_id, v_order.customer_id)::text));
    select * into v_customer from public.customers where id=coalesce(v_order.bonus_customer_id, v_order.customer_id) for update;
  end if;

  select coalesce(sum(amount), 0) into v_total_refunded
  from public.order_partial_refunds
  where order_id = v_order.id and status = 'succeeded';
  v_total_refunded := least(coalesce(v_order.amount, 0), v_total_refunded);
  select coalesce(sum(items.refund_amount),0) into v_delivery_refunded
  from public.order_partial_refund_items items
  join public.order_partial_refunds refunds on refunds.id=items.refund_id
  where refunds.order_id=v_order.id and refunds.status='succeeded'
    and items.line_key='__delivery_fee__';
  v_goods_refunded := greatest(0,v_total_refunded-v_delivery_refunded);
  v_eligible_paid := greatest(
    0,
    coalesce(v_order.subtotal, v_order.amount, 0) - coalesce(v_order.discount_amount, 0) - coalesce(v_order.bonus_spent, 0)
  );
  -- Cashback and spent loyalty funds are attached to the merchandise value,
  -- not to a delivery fee. Refunding every item therefore reverses them fully
  -- even when the original Kaspi payment also contained delivery.
  if v_eligible_paid > 0 then
    v_ratio := least(1, v_goods_refunded / v_eligible_paid);
  end if;

  v_original_order_id := 'kaspi:' || v_order.operation_id;
  v_target_earned := case
    when v_total_refunded >= v_order.amount and v_goods_refunded>0 then coalesce(v_order.earned_bonus, 0)
    else round(coalesce(v_order.earned_bonus, 0) * v_ratio, 2)
  end;
  select coalesce(sum(earned_bonus_reversed), 0) into v_prior_earned
  from public.order_partial_refund_adjustments where order_id = v_order.id;
  v_delta_earned := greatest(0, v_target_earned - v_prior_earned);

  select id, amount into v_pending_transaction_id, v_pending_available
  from public.transactions
  where customer_id = coalesce(v_order.bonus_customer_id, v_order.customer_id)
    and order_id = v_original_order_id
    and type = 'pending_deposit'
    and amount > 0
  order by created_at
  limit 1
  for update;
  v_pending_cancelled := least(v_delta_earned, coalesce(v_pending_available, 0));
  if v_pending_transaction_id is not null and v_pending_cancelled > 0 then
    update public.transactions
    set amount = greatest(0, amount - v_pending_cancelled),
        type = case when amount - v_pending_cancelled <= 0
          then 'cancelled_deposit' else type end,
        activated_at = case when amount - v_pending_cancelled <= 0
          then coalesce(activated_at, now()) else activated_at end,
        description = coalesce(description, '') || ' / частично отменён возвратом'
    where id = v_pending_transaction_id;
  end if;

  select coalesce(sum(amount), 0) into v_original_spent
  from public.transactions
  where customer_id = coalesce(v_order.bonus_customer_id, v_order.customer_id)
    and order_id = v_original_order_id
    and type = 'withdrawal';
  v_target_spent := case
    when v_total_refunded >= v_order.amount and v_goods_refunded>0 then v_original_spent
    else round(v_original_spent * v_ratio, 2)
  end;
  select coalesce(sum(spent_bonus_restored), 0) into v_prior_spent
  from public.order_partial_refund_adjustments where order_id = v_order.id;
  v_delta_spent := greatest(0, v_target_spent - v_prior_spent);

  v_target_real_money := case
    when v_goods_refunded >= v_eligible_paid then v_eligible_paid
    else round(v_eligible_paid * v_ratio, 2)
  end;
  select coalesce(sum(real_money_reversed), 0) into v_prior_real_money
  from public.order_partial_refund_adjustments where order_id = v_order.id;
  v_delta_real_money := greatest(0, v_target_real_money - v_prior_real_money);

  if coalesce(v_order.bonus_customer_id, v_order.customer_id) is not null then
    if v_customer.id is not null then
      select coalesce(sum(discount_amount),0) into v_held_balance
      from public.loyalty_reservations
      where customer_id=v_customer.id and status='active' and expires_at>now();
      v_active_removed := least(
        greatest(0, coalesce(v_customer.balance, 0) + v_delta_spent - v_held_balance),
        greatest(0, v_delta_earned - v_pending_cancelled)
      );
      v_unrecovered := greatest(
        0,
        v_delta_earned - v_pending_cancelled - v_active_removed
      );
      update public.customers
      set balance = greatest(0, balance + v_delta_spent - v_active_removed),
          total_spent = greatest(0, total_spent - v_delta_real_money),
          updated_at = now()
      where id = coalesce(v_order.bonus_customer_id, v_order.customer_id);

      if v_delta_spent > 0 then
        insert into public.transactions(
          customer_id, order_id, branch_id, type, amount, order_total, description
        ) values (
          coalesce(v_order.bonus_customer_id, v_order.customer_id),
          v_original_order_id || ':refund:' || v_refund.id::text || ':restore',
          v_order.branch_id,
          'refund_bonus_restore',
          v_delta_spent,
          v_refund.amount,
          'Возврат потраченных бонусов за возвращённые позиции'
        );
      end if;

      if v_delta_earned > 0 then
        insert into public.transactions(
          customer_id, order_id, branch_id, type, amount, order_total, description
        ) values (
          coalesce(v_order.bonus_customer_id, v_order.customer_id),
          v_original_order_id || ':refund:' || v_refund.id::text,
          v_order.branch_id,
          'refund_reversal',
          v_delta_earned,
          v_delta_real_money,
          case when v_unrecovered > 0
            then 'Пропорциональное сторнирование кэшбэка / часть бонусов уже использована'
            else 'Пропорциональное сторнирование кэшбэка' end
        );
      end if;
    end if;
  end if;

  select coalesce(sum(greatest(0, unit_amount * quantity - refund_amount)), 0)
  into v_current_promo_discount
  from public.order_partial_refund_items
  where refund_id = v_refund.id;

  if v_order.bonus_spent > 0 and v_order.subtotal > 0 then
    select round(coalesce(v_order.discount_amount, 0) *
      coalesce(sum(unit_amount * quantity) filter (where line_key <> '__delivery_fee__'), 0)
      / v_order.subtotal, 2) into v_current_promo_discount
    from public.order_partial_refund_items where refund_id = v_refund.id;
  end if;

  update public.promotion_redemptions
  set refunded_discount_amount = least(
        discount_amount,
        refunded_discount_amount + v_current_promo_discount
      )
  where order_id = v_order.id;

  if v_goods_refunded>0 and v_goods_refunded >= v_eligible_paid then
    select promotion_id into v_promotion_id
    from public.promotion_redemptions
    where order_id = v_order.id and released_at is null
    limit 1
    for update;
    if v_promotion_id is not null then
      update public.promotion_redemptions
      set released_at = now(), refunded_discount_amount = discount_amount
      where promotion_id = v_promotion_id and order_id = v_order.id and released_at is null;
      if found then
        update public.targeted_promotions
        set used_count = greatest(0, used_count - 1), updated_at = now()
        where id = v_promotion_id;
        v_promotion_released := true;
      end if;
    end if;
  end if;

  insert into public.order_partial_refund_adjustments(
    refund_id, order_id, customer_id,
    earned_bonus_reversed, pending_bonus_cancelled, active_bonus_removed,
    unrecovered_bonus, spent_bonus_restored, real_money_reversed,
    promo_discount_refunded, promotion_usage_released
  ) values (
    v_refund.id, v_order.id, coalesce(v_order.bonus_customer_id, v_order.customer_id),
    v_delta_earned, v_pending_cancelled, v_active_removed,
    v_unrecovered, v_delta_spent, v_delta_real_money,
    v_current_promo_discount, v_promotion_released
  );

  return jsonb_build_object(
    'duplicate', false,
    'earnedBonusReversed', v_delta_earned,
    'pendingBonusCancelled', v_pending_cancelled,
    'activeBonusRemoved', v_active_removed,
    'unrecoveredBonus', v_unrecovered,
    'spentBonusRestored', v_delta_spent,
    'realMoneyReversed', v_delta_real_money,
    'promoDiscountRefunded', v_current_promo_discount,
    'promotionUsageReleased', v_promotion_released
  );
end;
$$;

-- Serialize the fee refund with the cashier decision using the same order lock.
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
  if p_requested_by='delivery-replacement' and
    (v_order.delivery_resolution->>'status' is distinct from 'pickup_accepting'
      or v_order.delivery_resolution->>'id' is distinct from p_idempotency_key::text
      or jsonb_array_length(p_items)<>1 or p_items->0->>'line_key' is distinct from '__delivery_fee__'
      or p_amount is distinct from v_order.delivery_fee
      or (p_items->0->>'quantity')::numeric is distinct from 1
      or (p_items->0->>'original_quantity')::numeric is distinct from 1) then
    raise exception 'delivery replacement fee refund conflicts with current decision';
  end if;
  perform public.assert_front_partial_refund(p_order_id,p_amount);
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

-- Approval becomes pickup only after the unavailable delivery has been refunded.
create or replace function public.finish_delivery_resolution(p_order uuid,p_resolution uuid,p_next text,p_actor text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.kaspi_orders%rowtype; s text; branch uuid;
begin
 select branch_id into branch from public.kaspi_orders where id=p_order;
 perform id from public.bulka_locations where id=branch for update;
 select * into o from public.kaspi_orders where id=p_order for update;
 if not found then raise exception 'DELIVERY_RESOLUTION_NOT_FOUND'; end if;
 if o.branch_id is distinct from branch then raise exception 'DELIVERY_RESOLUTION_CONFLICT'; end if;
 if o.delivery_resolution->>'id' is distinct from p_resolution::text then raise exception 'DELIVERY_RESOLUTION_CONFLICT'; end if;
 s:=o.delivery_resolution->>'status';
 if s=p_next then return to_jsonb(o); end if;
 if not ((s='pickup_cancelling' and p_next='pickup_pending_approval')
  or (s='cancel_cancelling' and p_next='cancel_refunding')
  or (s='pickup_pending_approval' and p_next in ('pickup_accepting','pickup_rejecting'))
  or (s='pickup_accepting' and p_next in ('pickup_accepted','pickup_rejecting'))
  or (s='cancel_refunding' and p_next='cancelled')
  or (s='pickup_rejecting' and p_next='pickup_rejected')
  or (s in ('pickup_cancelling','cancel_cancelling') and p_next='delivery_resumed'))
  then raise exception 'DELIVERY_RESOLUTION_CONFLICT'; end if;
 if p_next not in ('delivery_resumed','cancelled','pickup_rejected') and
  (o.status<>'paid' or coalesce(o.refund_status,'') not in ('','partial','failed') or o.courier_id is not null
   or o.courier_assigned_at is not null or not public.delivery_resolution_unassigned(o.id)
   or not public.delivery_resolution_delivery_closed(o.id)) then raise exception 'DELIVERY_RESOLUTION_DELIVERY_ACTIVE'; end if;
 if p_next in ('cancelled','pickup_rejected') and (o.fulfillment_status<>'cancelled' or o.refund_status is distinct from 'succeeded')
  then raise exception 'DELIVERY_RESOLUTION_CONFLICT'; end if;
 if p_next in ('pickup_accepting','pickup_accepted') then
  if not public.delivery_resolution_valid_pickup(o.branch_id,(o.delivery_resolution->>'pickupTime')::timestamptz,
   coalesce((o.delivery_resolution->>'timezoneOffsetMinutes')::integer,300))
   then raise exception 'DELIVERY_RESOLUTION_INVALID_SLOT'; end if;
 end if;
 if p_next='pickup_accepted' then
  if coalesce(o.delivery_fee,0)>0 and not exists(
    select 1 from public.order_partial_refunds refunds
    join public.order_partial_refund_items items on items.refund_id=refunds.id
    where refunds.order_id=o.id and refunds.status='succeeded' and items.line_key='__delivery_fee__'
    having coalesce(sum(items.refund_amount),0)>=o.delivery_fee
  ) then raise exception 'DELIVERY_RESOLUTION_FEE_REFUND_PENDING'; end if;
  if not exists(select 1 from public.fulfillment_slot_reservations where client_request_id=p_resolution
   and order_id=o.id and status='committed') then raise exception 'DELIVERY_RESOLUTION_INVALID_SLOT'; end if;
  update public.fulfillment_slot_reservations set status='released',updated_at=now()
   where order_id=o.id and fulfillment_type='delivery' and status in ('active','committed');
 end if;
 if p_next='delivery_resumed' then
  update public.fulfillment_slot_reservations set status='released',updated_at=now()
   where client_request_id=p_resolution and status in ('active','committed');
 end if;
 update public.kaspi_orders set delivery_resolution=o.delivery_resolution||jsonb_build_object('status',p_next,'error',null,
  'retryAt',now(),'reviewedAt',case when p_next in ('pickup_accepting','pickup_rejecting') then now() else
    (o.delivery_resolution->>'reviewedAt')::timestamptz end,
  'reviewedBy',coalesce(p_actor,o.delivery_resolution->>'reviewedBy')),
  fulfillment_type=case when p_next='pickup_accepted' then 'pickup' else fulfillment_type end,
  scheduled_at=case when p_next='pickup_accepted' then (delivery_resolution->>'pickupTime')::timestamptz else scheduled_at end,
  pickup_time=case when p_next='pickup_accepted' then delivery_resolution->>'pickupTime' else pickup_time end,
  courier_dispatch_status=case when p_next='pickup_accepted' then 'failed' else courier_dispatch_status end,
  courier_timeout_at=case when p_next in ('pickup_accepted','delivery_resumed') then null else courier_timeout_at end,
  updated_at=now() where id=o.id returning * into o;
 return to_jsonb(o);
end;
$$;

-- A fee-only refund keeps the approved goods fulfillable even at zero cash remainder.
create or replace function public.complete_partial_refund(
  p_refund_id uuid,
  p_kaspi_reference text
)
returns public.kaspi_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.order_partial_refunds%rowtype;
  v_order public.kaspi_orders%rowtype;
  v_next_refunded numeric(12,2);
  v_reference varchar(160);
  v_cancel_order boolean;
begin
  select * into v_refund
  from public.order_partial_refunds
  where id = p_refund_id
  for update;
  if v_refund.id is null then raise exception 'refund not found'; end if;

  select * into v_order
  from public.kaspi_orders
  where id = v_refund.order_id
  for update;
  if v_order.id is null then raise exception 'order not found'; end if;

  if v_refund.status = 'succeeded' then return v_order; end if;
  if v_refund.status not in ('processing', 'unknown') then
    raise exception 'refund state conflict';
  end if;
  if coalesce(v_order.refund_status, '') not in ('processing', 'unknown') then
    raise exception 'order refund state conflict';
  end if;

  v_next_refunded := coalesce(v_order.partially_refunded_amount, 0) + v_refund.amount;
  if v_next_refunded > v_order.amount then raise exception 'refund exceeds order amount'; end if;
  -- Merchandise can be free or paid with loyalty funds. Returning only
  -- delivery is never an instruction to cancel or release the goods.
  v_cancel_order := v_next_refunded>=v_order.amount and v_refund.requested_by is distinct from 'delivery-replacement';
  v_reference := left(
    coalesce(
      nullif(btrim(p_kaspi_reference), ''),
      v_refund.provider_reference,
      v_refund.kaspi_reference
    ),
    160
  );

  update public.order_partial_refunds
  set
    status = 'succeeded',
    kaspi_reference = v_reference,
    provider_reference = v_reference,
    error = null,
    completed_at = now(),
    last_reconciled_at = case when v_refund.status = 'unknown' then now() else last_reconciled_at end,
    next_reconcile_at = null,
    updated_at = now()
  where id = v_refund.id;

  update public.kaspi_orders
  set
    partially_refunded_amount = v_next_refunded,
    refund_amount = v_next_refunded,
    refund_status = case when v_cancel_order then 'succeeded' else 'partial' end,
    refund_reference = coalesce(v_reference, refund_reference),
    refunded_at = case when v_cancel_order then now() else refunded_at end,
    status = case when v_cancel_order then 'refunded' else status end,
    fulfillment_status = case when v_cancel_order then 'cancelled' else fulfillment_status end,
    kitchen_status = case when v_cancel_order then 'cancelled' else kitchen_status end,
    refund_error = null,
    last_error = null,
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

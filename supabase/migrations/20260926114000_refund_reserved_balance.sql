-- Refunds reverse only available bonus; funds reserved by another payment remain payable.
-- Keep the latest checkout proration and existing earned/restored transaction meanings.
-- Partial refunds persist actual/unrecovered amounts in their adjustment ledger.

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
  if v_order.customer_id is not null then
    perform pg_advisory_xact_lock(hashtext(v_order.customer_id::text));
    select * into v_customer from public.customers where id=v_order.customer_id for update;
  end if;

  select coalesce(sum(amount), 0) into v_total_refunded
  from public.order_partial_refunds
  where order_id = v_order.id and status = 'succeeded';
  v_total_refunded := least(coalesce(v_order.amount, 0), v_total_refunded);
  v_eligible_paid := greatest(
    0,
    coalesce(v_order.subtotal, v_order.amount, 0) - coalesce(v_order.discount_amount, 0) - coalesce(v_order.bonus_spent, 0)
  );
  -- Cashback and spent loyalty funds are attached to the merchandise value,
  -- not to a delivery fee. Refunding every item therefore reverses them fully
  -- even when the original Kaspi payment also contained delivery.
  if v_eligible_paid > 0 then
    v_ratio := least(1, v_total_refunded / v_eligible_paid);
  end if;

  v_original_order_id := 'kaspi:' || v_order.operation_id;
  v_target_earned := case
    when v_total_refunded >= v_order.amount then coalesce(v_order.earned_bonus, 0)
    else round(coalesce(v_order.earned_bonus, 0) * v_ratio, 2)
  end;
  select coalesce(sum(earned_bonus_reversed), 0) into v_prior_earned
  from public.order_partial_refund_adjustments where order_id = v_order.id;
  v_delta_earned := greatest(0, v_target_earned - v_prior_earned);

  select id, amount into v_pending_transaction_id, v_pending_available
  from public.transactions
  where customer_id = v_order.customer_id
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
  where customer_id = v_order.customer_id
    and order_id = v_original_order_id
    and type = 'withdrawal';
  v_target_spent := case
    when v_total_refunded >= v_order.amount then v_original_spent
    else round(v_original_spent * v_ratio, 2)
  end;
  select coalesce(sum(spent_bonus_restored), 0) into v_prior_spent
  from public.order_partial_refund_adjustments where order_id = v_order.id;
  v_delta_spent := greatest(0, v_target_spent - v_prior_spent);

  v_target_real_money := case
    when v_total_refunded >= v_eligible_paid then v_eligible_paid
    else round(v_eligible_paid * v_ratio, 2)
  end;
  select coalesce(sum(real_money_reversed), 0) into v_prior_real_money
  from public.order_partial_refund_adjustments where order_id = v_order.id;
  v_delta_real_money := greatest(0, v_target_real_money - v_prior_real_money);

  if v_order.customer_id is not null then
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
      where id = v_order.customer_id;

      if v_delta_spent > 0 then
        insert into public.transactions(
          customer_id, order_id, branch_id, type, amount, order_total, description
        ) values (
          v_order.customer_id,
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
          v_order.customer_id,
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

  if v_total_refunded >= v_eligible_paid then
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
    v_refund.id, v_order.id, v_order.customer_id,
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

create or replace function public.reverse_loyalty_order(
  p_customer_id uuid,
  p_order_id text,
  p_real_money_paid numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund_order_id text := p_order_id || ':refund';
  v_order public.kaspi_orders%rowtype;
  v_customer public.customers%rowtype;
  v_original_found boolean := false;
  v_items jsonb;
  v_pending_id uuid;
  v_pending_available numeric(12,2) := 0;
  v_pending_cancelled numeric(12,2) := 0;
  v_original_active_earned numeric(12,2) := 0;
  v_target_earned numeric(12,2) := 0;
  v_prior_earned numeric(12,2) := 0;
  v_delta_earned numeric(12,2) := 0;
  v_active_removed numeric(12,2) := 0;
  v_held_balance numeric := 0;
  v_unrecovered numeric(12,2) := 0;
  v_original_spent numeric(12,2) := 0;
  v_prior_spent numeric(12,2) := 0;
  v_delta_spent numeric(12,2) := 0;
  v_prior_real_money numeric(12,2) := 0;
  v_delta_real_money numeric(12,2) := 0;
  v_promotion_id uuid;
  v_promotion_released boolean := false;
begin
  if p_customer_id is null or nullif(btrim(p_order_id), '') is null
    or coalesce(p_real_money_paid, 0) < 0 then
    raise exception 'invalid loyalty refund values';
  end if;

  select * into v_order
  from public.kaspi_orders
  where customer_id = p_customer_id
    and 'kaspi:' || operation_id = p_order_id
  limit 1
  for update;
  if v_order.id is null then raise exception 'order not found'; end if;

  perform pg_advisory_xact_lock(hashtext('partial-refund:' || v_order.id::text));

  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;
  if v_customer.id is null then raise exception 'customer not found'; end if;

  if exists (
    select 1 from public.transactions
    where customer_id = p_customer_id
      and order_id = v_refund_order_id
      and type = 'refund_reversal'
  ) then
    return jsonb_build_object(
      'duplicate', true,
      'balance', v_customer.balance,
      'total_spent', v_customer.total_spent,
      'earnedBonusReversed', 0,
      'spentBonusRestored', 0,
      'realMoneyReversed', 0,
      'promotionUsageReleased', false
    );
  end if;

  select exists (
    select 1 from public.transactions
    where customer_id = p_customer_id
      and order_id = p_order_id
      and type in ('deposit', 'pending_deposit', 'cancelled_deposit', 'withdrawal', 'order')
  ) into v_original_found;
  if not v_original_found then
    return jsonb_build_object(
      'duplicate', false,
      'applied', false,
      'balance', v_customer.balance,
      'total_spent', v_customer.total_spent
    );
  end if;

  select
    coalesce(sum(amount) filter (where type = 'deposit'), 0),
    coalesce(sum(amount) filter (where type = 'withdrawal'), 0),
    (array_agg(items) filter (where items is not null))[1]
  into v_original_active_earned, v_original_spent, v_items
  from public.transactions
  where customer_id = p_customer_id and order_id = p_order_id;

  select
    coalesce(sum(earned_bonus_reversed), 0),
    coalesce(sum(spent_bonus_restored), 0),
    coalesce(sum(real_money_reversed), 0)
  into v_prior_earned, v_prior_spent, v_prior_real_money
  from public.order_partial_refund_adjustments
  where order_id = v_order.id;

  v_target_earned := greatest(
    0,
    coalesce(v_order.earned_bonus, 0),
    v_original_active_earned
  );
  v_delta_earned := greatest(0, v_target_earned - v_prior_earned);
  v_delta_spent := greatest(0, v_original_spent - v_prior_spent);
  v_delta_real_money := greatest(
    0,
    coalesce(p_real_money_paid, 0) - v_prior_real_money
  );

  select id, amount into v_pending_id, v_pending_available
  from public.transactions
  where customer_id = p_customer_id
    and order_id = p_order_id
    and type = 'pending_deposit'
    and amount > 0
  order by created_at
  limit 1
  for update;
  v_pending_cancelled := least(v_delta_earned, coalesce(v_pending_available, 0));
  if v_pending_id is not null then
    update public.transactions
    set amount = greatest(0, amount - v_pending_cancelled),
        type = case when amount - v_pending_cancelled <= 0
          then 'cancelled_deposit' else type end,
        activated_at = case when amount - v_pending_cancelled <= 0
          then coalesce(activated_at, now()) else activated_at end,
        description = coalesce(description, '') || ' / отменён полным возвратом'
    where id = v_pending_id;
  end if;

  select coalesce(sum(discount_amount),0) into v_held_balance
  from public.loyalty_reservations
  where customer_id=p_customer_id and status='active' and expires_at>now();
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
  where id = p_customer_id
  returning * into v_customer;

  if v_delta_spent > 0 then
    insert into public.transactions(
      customer_id, order_id, branch_id, type, amount, order_total, description, items
    ) values (
      p_customer_id,
      v_refund_order_id || ':restore',
      v_order.branch_id,
      'refund_bonus_restore',
      v_delta_spent,
      v_order.amount,
      'Возврат остатка потраченных бонусов или подарочного сертификата',
      v_items
    );
  end if;

  insert into public.transactions(
    customer_id, order_id, branch_id, type, amount, order_total, description, items
  ) values (
    p_customer_id,
    v_refund_order_id,
    v_order.branch_id,
    'refund_reversal',
    v_delta_earned,
    v_delta_real_money,
    'Сторнирование остатка кэшбэка; снято=' || v_active_removed::text ||
      '; отменено ожидающее=' || v_pending_cancelled::text ||
      '; не взыскано=' || v_unrecovered::text || '; восстановлено=' || v_delta_spent::text,
    v_items
  );

  select promotion_id into v_promotion_id
  from public.promotion_redemptions
  where order_id = v_order.id and released_at is null
  limit 1
  for update;
  if v_promotion_id is not null then
    update public.promotion_redemptions
    set released_at = now(), refunded_discount_amount = discount_amount
    where promotion_id = v_promotion_id
      and order_id = v_order.id
      and released_at is null;
    if found then
      update public.targeted_promotions
      set used_count = greatest(0, used_count - 1), updated_at = now()
      where id = v_promotion_id;
      v_promotion_released := true;
    end if;
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'applied', true,
    'balance', v_customer.balance,
    'total_spent', v_customer.total_spent,
    'earnedBonusReversed', v_delta_earned,
    'pendingBonusCancelled', v_pending_cancelled,
    'activeBonusRemoved', v_active_removed,
    'unrecoveredBonus', v_unrecovered,
    'spentBonusRestored', v_delta_spent,
    'realMoneyReversed', v_delta_real_money,
    'promotionUsageReleased', v_promotion_released
  );
end;
$$;

revoke all on function public.apply_partial_refund_adjustments(uuid),
  public.reverse_loyalty_order(uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.apply_partial_refund_adjustments(uuid),
  public.reverse_loyalty_order(uuid,text,numeric) to service_role;

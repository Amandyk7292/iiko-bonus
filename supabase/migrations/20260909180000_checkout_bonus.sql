-- Online loyalty uses the same customer lock and reservation ledger as POS.
alter table public.kaspi_orders
  add column if not exists bonus_spent integer not null default 0,
  add column if not exists bonus_reservation_id uuid references public.loyalty_reservations(id);
do $$ begin
if not exists (select 1 from pg_constraint where conrelid = 'public.kaspi_orders'::regclass
  and conname = 'kaspi_orders_checkout_bonus_check') then
alter table public.kaspi_orders add constraint kaspi_orders_checkout_bonus_check check (
  bonus_spent >= 0 and
  bonus_spent <= floor(greatest(0, coalesce(subtotal, amount, 0) - coalesce(discount_amount, 0)) / 2)
  and (bonus_spent = 0 or bonus_reservation_id is not null)
) not valid;
end if;
end $$;
alter table public.kaspi_orders validate constraint kaspi_orders_checkout_bonus_check;
create unique index if not exists kaspi_orders_bonus_reservation_unique
  on public.kaspi_orders(bonus_reservation_id) where bonus_reservation_id is not null;

create or replace function public.quote_checkout_bonus(p_customer_id uuid, p_order_total numeric)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('available', floor(greatest(0, c.balance - coalesce((
    select sum(r.discount_amount) from public.loyalty_reservations r
    where r.customer_id = c.id and r.status = 'active' and r.expires_at > now()
  ), 0)))) from public.customers c where c.id = p_customer_id;
$$;

create or replace function public.reserve_checkout_bonus(
  p_customer_id uuid, p_request_id uuid, p_order_total numeric, p_expected_amount integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_available numeric;
  v_amount integer;
  v_result jsonb;
  v_existing public.loyalty_reservations%rowtype;
  v_key text := 'checkout:' || p_customer_id::text || ':' || p_request_id::text;
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  if p_order_total is null or p_order_total < 0 or p_order_total <> trunc(p_order_total)
    or p_expected_amount is null or p_expected_amount < 0 then
    raise exception 'invalid checkout bonus values';
  end if;
  select * into v_existing from public.loyalty_reservations
    where customer_id = p_customer_id and order_id = v_key for update;
  if found and v_existing.status = 'active' and v_existing.expires_at > now() then
    if v_existing.order_total <> p_order_total or v_existing.discount_amount <> p_expected_amount then
      raise exception 'checkout bonus changed';
    end if;
    return jsonb_build_object('amount', p_expected_amount, 'reservationId', v_existing.id);
  end if;
  select (public.quote_checkout_bonus(p_customer_id, p_order_total)->>'available')::numeric
    into v_available;
  if v_available is null then raise exception 'customer not found'; end if;
  v_amount := least(v_available, floor(p_order_total / 2));
  if p_expected_amount <> v_amount then raise exception 'checkout bonus changed'; end if;
  if v_amount = 0 then return jsonb_build_object('amount', 0, 'reservationId', null); end if;
  v_result := public.reserve_loyalty_balance(p_customer_id, v_key, p_order_total, v_amount, 50, 1);
  select * into v_existing from public.loyalty_reservations where order_id = v_key;
  return jsonb_build_object('amount', v_amount, 'reservationId', v_existing.id);
end;
$$;

create or replace function public.attach_checkout_bonus()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_res public.loyalty_reservations%rowtype;
begin
  if new.bonus_spent = 0 then return new; end if;
  perform pg_advisory_xact_lock(hashtext(new.customer_id::text));
  select * into v_res from public.loyalty_reservations
    where id = new.bonus_reservation_id and customer_id = new.customer_id for update;
  if not found or v_res.status <> 'active' or v_res.expires_at <= now()
    or v_res.order_id <> 'checkout:' || new.customer_id::text || ':' || new.client_request_id::text
    or v_res.discount_amount <> new.bonus_spent
    or new.subtotal is null or new.discount_amount is null or new.delivery_fee is null
    or v_res.order_total <> new.subtotal - new.discount_amount
    or new.amount <> new.subtotal - new.discount_amount - new.bonus_spent + new.delivery_fee then
    raise exception 'checkout bonus reservation mismatch';
  end if;
  update public.loyalty_reservations set order_id = 'kaspi:' || new.operation_id,
    updated_at = now() where id = v_res.id;
  return new;
end;
$$;
drop trigger if exists kaspi_order_attach_checkout_bonus on public.kaspi_orders;
create trigger kaspi_order_attach_checkout_bonus before insert on public.kaspi_orders
  for each row execute function public.attach_checkout_bonus();

create or replace function public.release_unattached_checkout_bonus(
  p_customer_id uuid, p_request_id uuid, p_reservation_id uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  update public.loyalty_reservations set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where id = p_reservation_id and customer_id = p_customer_id
      and order_id = 'checkout:' || p_customer_id::text || ':' || p_request_id::text
      and status = 'active'
      and not exists(select 1 from public.kaspi_orders where bonus_reservation_id = p_reservation_id);
end;
$$;

create or replace function public.release_terminal_checkout_bonus()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.bonus_reservation_id is not null and new.status in ('failed', 'expired', 'refunded') then
    perform pg_advisory_xact_lock(hashtext(new.customer_id::text));
    update public.loyalty_reservations set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = new.bonus_reservation_id and customer_id = new.customer_id and status = 'active';
  end if;
  return new;
end;
$$;
drop trigger if exists kaspi_order_release_checkout_bonus on public.kaspi_orders;
create trigger kaspi_order_release_checkout_bonus after update of status on public.kaspi_orders
  for each row execute function public.release_terminal_checkout_bonus();

create or replace function public.commit_checkout_bonus(
  p_order_id uuid, p_earned_bonus numeric, p_activation_delay_days integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order public.kaspi_orders%rowtype;
  v_res public.loyalty_reservations%rowtype;
  v_result jsonb;
  v_total numeric;
begin
  select * into v_order from public.kaspi_orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  perform pg_advisory_xact_lock(hashtext(v_order.customer_id::text));
  select * into v_order from public.kaspi_orders where id = p_order_id for update;
  if v_order.bonus_awarded_at is not null then return jsonb_build_object('status', 'committed'); end if;
  if v_order.status <> 'paid' or v_order.bonus_spent <= 0 or v_order.bonus_reversed_at is not null
    or coalesce(v_order.refund_status, '') in ('processing', 'unknown', 'succeeded') then
    return jsonb_build_object('status', 'unavailable');
  end if;
  v_total := greatest(0, v_order.subtotal - v_order.discount_amount);
  select * into v_res from public.loyalty_reservations where id = v_order.bonus_reservation_id for update;
  if not found or v_res.customer_id <> v_order.customer_id or v_res.order_id <> 'kaspi:' || v_order.operation_id
    or v_res.discount_amount <> v_order.bonus_spent then raise exception 'checkout bonus mismatch'; end if;
  if v_res.status <> 'committed' and (v_res.status <> 'active' or v_res.expires_at <= now()) then
    begin
      perform public.reserve_loyalty_balance(v_order.customer_id, v_res.order_id, v_total, v_order.bonus_spent, 50, 1);
    exception when raise_exception then
      if sqlerrm = 'discount exceeds available reserved balance' then
        return jsonb_build_object('status', 'unavailable');
      end if;
      raise;
    end;
  end if;
  v_result := public.commit_loyalty_reservation(v_order.customer_id, v_res.order_id,
    v_res.id, v_total, p_earned_bonus, p_activation_delay_days, v_order.cart_items);
  update public.transactions set branch_id = v_order.branch_id
    where customer_id = v_order.customer_id and order_id = v_res.order_id and branch_id is null;
  update public.kaspi_orders set earned_bonus = p_earned_bonus, bonus_awarded_at = now() where id = p_order_id;
  return v_result || jsonb_build_object('status', 'committed');
end;
$$;

revoke all on function public.quote_checkout_bonus(uuid, numeric) from public, anon, authenticated;
revoke all on function public.reserve_checkout_bonus(uuid, uuid, numeric, integer) from public, anon, authenticated;
revoke all on function public.attach_checkout_bonus() from public, anon, authenticated;
revoke all on function public.release_unattached_checkout_bonus(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_terminal_checkout_bonus() from public, anon, authenticated;
revoke all on function public.commit_checkout_bonus(uuid, numeric, integer) from public, anon, authenticated;
grant execute on function public.quote_checkout_bonus(uuid, numeric) to service_role;
grant execute on function public.reserve_checkout_bonus(uuid, uuid, numeric, integer) to service_role;
grant execute on function public.release_unattached_checkout_bonus(uuid, uuid, uuid) to service_role;
grant execute on function public.commit_checkout_bonus(uuid, numeric, integer) to service_role;

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
    select * into v_customer
    from public.customers where id = v_order.customer_id for update;
    if v_customer.id is not null then
      v_active_removed := least(
        greatest(0, coalesce(v_customer.balance, 0) + v_delta_spent),
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

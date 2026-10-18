begin;

-- All online earnings, including cashback without bonus spending, serialize
-- with refunds on the order before locking the captured family bonus owner.
create or replace function public.commit_checkout_bonus(
  p_order_id uuid, p_earned_bonus numeric, p_activation_delay_days integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order public.kaspi_orders%rowtype;
  v_res public.loyalty_reservations%rowtype;
  v_result jsonb;
  v_total numeric;
  v_earned numeric;
  v_awarded_at timestamptz := now();
  v_owner uuid;
  v_actor uuid;
  v_renewed_id uuid;
begin
  if p_earned_bonus is null or p_earned_bonus < 0 or p_earned_bonus::text='NaN'
    or p_activation_delay_days is null or p_activation_delay_days < 0 then
    raise exception 'invalid loyalty transaction values';
  end if;
  select * into v_order from public.kaspi_orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  v_owner := coalesce(v_order.bonus_customer_id, v_order.customer_id);
  perform pg_advisory_xact_lock(hashtext(v_owner::text));
  if v_order.status <> 'paid' or v_order.bonus_reversed_at is not null
    or coalesce(v_order.refund_status, '') in ('processing', 'unknown', 'succeeded') then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if v_order.bonus_awarded_at is not null then
    return jsonb_build_object('status', 'committed', 'earnedBonus', v_order.earned_bonus,
      'bonusAwardedAt', v_order.bonus_awarded_at);
  end if;
  v_total := greatest(0, coalesce(v_order.subtotal,v_order.amount,0) - coalesce(v_order.discount_amount,0));
  if coalesce(v_order.bonus_spent,0) <= 0 then
    v_result := public.apply_loyalty_transaction(v_owner, 'kaspi:' || v_order.operation_id,
      0, p_earned_bonus, v_total, v_total, p_activation_delay_days, v_order.cart_items);
  else
    select * into v_res from public.loyalty_reservations where id = v_order.bonus_reservation_id for update;
    if not found or v_res.customer_id <> v_owner or v_res.order_id <> 'kaspi:' || v_order.operation_id
      or v_res.discount_amount <> v_order.bonus_spent then raise exception 'checkout bonus mismatch'; end if;
    if v_res.status <> 'committed' and (v_res.status <> 'active' or v_res.expires_at <= now()) then
      v_actor := coalesce(v_res.family_actor_customer_id, v_order.customer_id);
      begin
        v_result := public.reserve_loyalty_balance(v_owner, v_res.order_id, v_total, v_order.bonus_spent, 50, 1);
        v_renewed_id := (v_result->>'reservation_id')::uuid;
        select * into v_res from public.loyalty_reservations where id = v_renewed_id for update;
        if not found or v_res.customer_id is distinct from v_owner
          or v_res.order_id is distinct from 'kaspi:' || v_order.operation_id
          or v_res.discount_amount is distinct from v_order.bonus_spent then
          raise exception 'checkout bonus mismatch';
        end if;
        update public.loyalty_reservations set family_actor_customer_id = v_actor where id = v_res.id;
        update public.kaspi_orders set bonus_reservation_id = v_res.id where id = p_order_id;
      exception when raise_exception then
        if sqlerrm = 'discount exceeds available reserved balance' then
          return jsonb_build_object('status', 'unavailable');
        end if;
        raise;
      end;
    end if;
    v_result := public.commit_loyalty_reservation(v_owner, v_res.order_id,
      v_res.id, v_total, p_earned_bonus, p_activation_delay_days, v_order.cart_items);
  end if;
  update public.transactions set branch_id = v_order.branch_id
    where customer_id = v_owner and order_id = 'kaspi:' || v_order.operation_id and branch_id is null;
  -- A retry can find an older ledger commit whose order-marker write failed.
  -- Preserve its actual earning even if the customer's tier changed since.
  select coalesce(sum(amount),0) into v_earned from public.transactions
    where customer_id=v_owner and order_id='kaspi:' || v_order.operation_id
      and type in ('deposit','pending_deposit');
  update public.kaspi_orders set earned_bonus = v_earned, bonus_awarded_at = v_awarded_at where id = p_order_id;
  return v_result || jsonb_build_object('status', 'committed', 'earnedBonus', v_earned,
    'bonusAwardedAt', v_awarded_at);
end;
$$;
revoke all on function public.commit_checkout_bonus(uuid,numeric,integer) from public,anon,authenticated;
grant execute on function public.commit_checkout_bonus(uuid,numeric,integer) to service_role;

-- Older code stamped the reconciliation marker before local finalization.
-- Reopen only unfinished paid product orders; no ledger/bank mutation occurs.
update public.kaspi_orders set payment_reconciled_at=null
where payment_method='forte_card' and status='paid' and payment_reconciled_at is not null
  and coalesce(order_kind,'product')<>'gift_certificate'
  and fulfillment_status<>'cancelled'
  and coalesce(refund_status,'') not in ('processing','unknown','succeeded')
  and (fulfillment_status='pending' or bonus_awarded_at is null);

commit;

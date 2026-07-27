-- Financial, branch-scope and courier security hardening.
-- Canonical immutable migration; apply it only through the migration runner.
-- This migration is intentionally idempotent because the deployment runner
-- reapplies every SQL file inside one transaction.

alter table public.transactions
  add column if not exists branch_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_branch_id_fkey'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_branch_id_fkey
      foreign key (branch_id) references public.bulka_locations(id) on delete set null;
  end if;
end $$;

update public.transactions tx
set branch_id = orders.branch_id
from public.kaspi_orders orders
where tx.branch_id is null
  and orders.branch_id is not null
  and tx.customer_id = orders.customer_id
  and left(tx.order_id, length('kaspi:' || orders.operation_id)) =
      'kaspi:' || orders.operation_id;

create index if not exists transactions_branch_time_idx
  on public.transactions(branch_id, timestamp desc);

alter table public.promotion_redemptions
  add column if not exists refunded_discount_amount numeric(12,2) not null default 0,
  add column if not exists released_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'promotion_redemptions_refunded_discount_check'
      and conrelid = 'public.promotion_redemptions'::regclass
  ) then
    alter table public.promotion_redemptions
      add constraint promotion_redemptions_refunded_discount_check
      check (
        refunded_discount_amount >= 0
        and refunded_discount_amount <= discount_amount
      );
  end if;
end $$;

alter table public.order_partial_refunds
  add column if not exists processor_token uuid;

create table if not exists public.order_partial_refund_adjustments (
  refund_id uuid primary key references public.order_partial_refunds(id) on delete cascade,
  order_id uuid not null references public.kaspi_orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  earned_bonus_reversed numeric(12,2) not null default 0 check (earned_bonus_reversed >= 0),
  pending_bonus_cancelled numeric(12,2) not null default 0 check (pending_bonus_cancelled >= 0),
  active_bonus_removed numeric(12,2) not null default 0 check (active_bonus_removed >= 0),
  unrecovered_bonus numeric(12,2) not null default 0 check (unrecovered_bonus >= 0),
  spent_bonus_restored numeric(12,2) not null default 0 check (spent_bonus_restored >= 0),
  real_money_reversed numeric(12,2) not null default 0 check (real_money_reversed >= 0),
  promo_discount_refunded numeric(12,2) not null default 0 check (promo_discount_refunded >= 0),
  promotion_usage_released boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists order_partial_refund_adjustments_order_idx
  on public.order_partial_refund_adjustments(order_id, created_at);

alter table public.order_partial_refund_adjustments enable row level security;
drop policy if exists "service role manages refund adjustments"
  on public.order_partial_refund_adjustments;
create policy "service role manages refund adjustments"
  on public.order_partial_refund_adjustments
  for all to service_role using (true) with check (true);
revoke all on public.order_partial_refund_adjustments from public, anon, authenticated;
grant all on public.order_partial_refund_adjustments to service_role;

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
  v_quantity integer;
  v_original_quantity integer;
  v_claimed_quantity integer;
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
    v_quantity := coalesce((v_item->>'quantity')::integer, 0);
    v_original_quantity := coalesce((v_item->>'original_quantity')::integer, 0);
    if v_line_key is null or v_quantity < 1 or v_original_quantity < v_quantity then
      raise exception 'invalid refund line';
    end if;

    select coalesce(sum(items.quantity), 0)::integer into v_claimed_quantity
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
    (item->>'quantity')::integer,
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

revoke all on function public.claim_partial_refund(uuid, uuid, uuid, numeric, text, text, jsonb)
  from public;
grant execute on function public.claim_partial_refund(uuid, uuid, uuid, numeric, text, text, jsonb)
  to service_role;

create or replace function public.fail_partial_refund(
  p_refund_id uuid,
  p_error text,
  p_result_unknown boolean default false
)
returns public.kaspi_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.order_partial_refunds%rowtype;
  v_order public.kaspi_orders%rowtype;
  v_succeeded numeric(12,2) := 0;
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

  if v_refund.status = 'processing' then
    update public.order_partial_refunds
    set status = 'failed',
        error = left(coalesce(nullif(btrim(p_error), ''), 'Kaspi refund failed'), 1000),
        completed_at = now()
    where id = v_refund.id;
  end if;

  select coalesce(sum(amount), 0) into v_succeeded
  from public.order_partial_refunds
  where order_id = v_order.id and status = 'succeeded';

  update public.kaspi_orders
  set refund_status = case
        when coalesce(p_result_unknown, false) then 'unknown'
        when v_succeeded > 0 then 'partial'
        else 'failed'
      end,
      refund_error = left(coalesce(nullif(btrim(p_error), ''), 'Kaspi refund failed'), 1000),
      last_error = case when coalesce(p_result_unknown, false)
        then 'Результат частичного возврата требует проверки в Kaspi Pay'
        else last_error end,
      updated_at = now()
  where id = v_order.id
  returning * into v_order;
  return v_order;
end;
$$;

revoke all on function public.fail_partial_refund(uuid, text, boolean) from public;
grant execute on function public.fail_partial_refund(uuid, text, boolean) to service_role;

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
  if v_refund.status <> 'processing' then raise exception 'refund state conflict'; end if;
  if coalesce(v_order.refund_status, '') not in ('processing', 'unknown') then
    raise exception 'order refund state conflict';
  end if;

  v_next_refunded := coalesce(v_order.partially_refunded_amount, 0) + v_refund.amount;
  if v_next_refunded > v_order.amount then raise exception 'refund exceeds order amount'; end if;

  update public.order_partial_refunds
  set status = 'succeeded',
      kaspi_reference = nullif(btrim(p_kaspi_reference), ''),
      error = null,
      completed_at = now()
  where id = v_refund.id;

  update public.kaspi_orders
  set partially_refunded_amount = v_next_refunded,
      refund_amount = v_next_refunded,
      refund_status = case when v_next_refunded >= amount then 'succeeded' else 'partial' end,
      refund_reference = nullif(btrim(p_kaspi_reference), ''),
      refunded_at = case when v_next_refunded >= amount then now() else refunded_at end,
      status = case when v_next_refunded >= amount then 'refunded' else status end,
      fulfillment_status = case when v_next_refunded >= amount then 'cancelled' else fulfillment_status end,
      kitchen_status = case when v_next_refunded >= amount then 'cancelled' else kitchen_status end,
      refund_error = null,
      last_error = null,
      updated_at = now()
  where id = v_order.id
  returning * into v_order;
  return v_order;
end;
$$;

revoke all on function public.complete_partial_refund(uuid, text) from public;
grant execute on function public.complete_partial_refund(uuid, text) to service_role;

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
    coalesce(v_order.subtotal, v_order.amount, 0) - coalesce(v_order.discount_amount, 0)
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

revoke all on function public.apply_partial_refund_adjustments(uuid) from public;
grant execute on function public.apply_partial_refund_adjustments(uuid) to service_role;

-- Full cancellation may follow one or more partial refunds. The legacy
-- implementation reversed the entire loyalty movement again. This version
-- applies only the remainder and uses the full-reversal transaction as an
-- idempotency marker.
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
    case when v_unrecovered > 0
      then 'Сторнирование остатка кэшбэка / часть бонусов уже использована'
      else 'Сторнирование остатка кэшбэка после полного возврата' end,
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

revoke all on function public.reverse_loyalty_order(uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.reverse_loyalty_order(uuid, text, numeric)
  to service_role;

create or replace function public.record_order_promotion_redemption(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.kaspi_orders%rowtype;
  v_promotion public.targeted_promotions%rowtype;
  v_inserted integer := 0;
begin
  select * into v_order from public.kaspi_orders where id = p_order_id for update;
  if v_order.id is null or v_order.customer_id is null
    or nullif(btrim(v_order.promo_code), '') is null then
    return false;
  end if;
  select * into v_promotion
  from public.targeted_promotions
  where upper(code) = upper(v_order.promo_code)
  for update;
  if v_promotion.id is null then return false; end if;

  insert into public.promotion_redemptions(
    promotion_id, customer_id, order_id, discount_amount
  ) values (
    v_promotion.id, v_order.customer_id, v_order.id, coalesce(v_order.discount_amount, 0)
  ) on conflict (promotion_id, order_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return false; end if;

  update public.targeted_promotions
  set used_count = used_count + 1, updated_at = now()
  where id = v_promotion.id;
  return true;
end;
$$;

revoke all on function public.record_order_promotion_redemption(uuid) from public;
grant execute on function public.record_order_promotion_redemption(uuid) to service_role;

create or replace function public.admin_scoped_customers(
  p_branch_ids uuid[],
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped_orders as (
    select
      customer_id,
      sum(greatest(0, amount - coalesce(refund_amount, 0))) as branch_total_spent,
      max(created_at) as last_order_at
    from public.kaspi_orders
    where branch_id = any(coalesce(p_branch_ids, '{}'::uuid[]))
      and customer_id is not null
      and status in ('paid', 'refunded')
    group by customer_id
  ),
  filtered as (
    select
      c.*,
      scoped_orders.branch_total_spent,
      scoped_orders.last_order_at
    from public.customers c
    join scoped_orders on scoped_orders.customer_id = c.id
    where coalesce(p_search, '') = ''
       or c.name ilike '%' || p_search || '%'
       or c.phone ilike '%' || p_search || '%'
  ),
  page as (
    select * from filtered
    order by last_order_at desc, created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'customers', coalesce((
      select jsonb_agg(
        (to_jsonb(page) - 'branch_total_spent' - 'last_order_at' - 'total_spent')
        || jsonb_build_object(
          'total_spent', page.branch_total_spent,
          'branch_total_spent', page.branch_total_spent,
          'last_order_at', page.last_order_at
        )
        order by page.last_order_at desc, page.created_at desc
      ) from page
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  );
$$;

revoke all on function public.admin_scoped_customers(uuid[], text, integer, integer) from public;
grant execute on function public.admin_scoped_customers(uuid[], text, integer, integer) to service_role;

create or replace function public.get_admin_stats_scoped(p_branch_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped_orders as (
    select * from public.kaspi_orders
    where branch_id = any(coalesce(p_branch_ids, '{}'::uuid[]))
      and customer_id is not null
      and status in ('paid', 'refunded')
  ),
  scoped_customers as (
    select c.*
    from public.customers c
    where c.id in (select distinct customer_id from scoped_orders)
  ),
  scoped_transactions as (
    select * from public.transactions
    where branch_id = any(coalesce(p_branch_ids, '{}'::uuid[]))
  ),
  metrics as (
    select
      (select count(*) from scoped_customers) as total_customers,
      (select count(distinct customer_id) from scoped_orders
        where created_at >= now() - interval '30 days') as new_customers_30,
      (select coalesce(sum(greatest(0, amount - coalesce(refund_amount, 0))), 0)
        from scoped_orders) as total_sales,
      greatest(0,
        (select coalesce(sum(amount), 0) from scoped_transactions
          where type in ('deposit', 'pending_deposit', 'manual_deposit', 'manual'))
        - (select coalesce(sum(amount), 0) from scoped_transactions
          where type = 'refund_reversal')
      ) as total_earned,
      greatest(0,
        (select coalesce(sum(amount), 0) from scoped_transactions
          where type in ('withdrawal', 'manual_withdrawal', 'expiration'))
        - (select coalesce(sum(amount), 0) from scoped_transactions
          where type = 'refund_bonus_restore')
      ) as total_burned,
      greatest(0,
        (select coalesce(sum(amount), 0) from scoped_transactions
          where type in ('deposit', 'pending_deposit', 'manual_deposit', 'manual')
            and timestamp >= now() - interval '30 days')
        - (select coalesce(sum(amount), 0) from scoped_transactions
          where type = 'refund_reversal'
            and timestamp >= now() - interval '30 days')
      ) as earned_30,
      greatest(0,
        (select coalesce(sum(amount), 0) from scoped_transactions
          where type in ('withdrawal', 'manual_withdrawal', 'expiration')
            and timestamp >= now() - interval '30 days')
        - (select coalesce(sum(amount), 0) from scoped_transactions
          where type = 'refund_bonus_restore'
            and timestamp >= now() - interval '30 days')
      ) as burned_30,
      greatest(0,
        (select coalesce(sum(amount), 0) from scoped_transactions
          where type in ('deposit', 'pending_deposit', 'manual_deposit', 'manual', 'refund_bonus_restore'))
        - (select coalesce(sum(amount), 0) from scoped_transactions
          where type in ('withdrawal', 'manual_withdrawal', 'expiration', 'refund_reversal'))
      ) as liabilities
  )
  select jsonb_build_object(
    'totalCustomers', total_customers,
    'newCustomersLast30Days', new_customers_30,
    'totalSales', total_sales,
    'totalEarned', total_earned,
    'totalBurned', total_burned,
    'earnedLast30Days', earned_30,
    'burnedLast30Days', burned_30,
    'bonusPaymentPercent', case when total_sales + total_burned > 0
      then round(total_burned * 100.0 / (total_sales + total_burned), 1)::text
      else '0.0' end,
    'currentLiabilities', liabilities
  ) from metrics;
$$;

revoke all on function public.get_admin_stats_scoped(uuid[]) from public;
grant execute on function public.get_admin_stats_scoped(uuid[]) to service_role;

create or replace function public.apply_manual_bonus_scoped(
  p_customer_id uuid,
  p_amount_change numeric,
  p_reason text default null,
  p_branch_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if p_customer_id is null or p_amount_change is null or abs(p_amount_change) > 100000000 then
    raise exception 'invalid manual bonus arguments';
  end if;
  update public.customers
  set balance = balance + p_amount_change, updated_at = now()
  where id = p_customer_id and balance + p_amount_change >= 0
  returning balance into v_balance;
  if v_balance is null then raise exception 'customer not found or insufficient balance'; end if;

  insert into public.transactions(customer_id, order_id, branch_id, type, amount, description)
  values (
    p_customer_id,
    'MANUAL-' || gen_random_uuid()::text,
    p_branch_id,
    case when p_amount_change >= 0 then 'manual_deposit' else 'manual_withdrawal' end,
    abs(p_amount_change),
    coalesce(nullif(btrim(p_reason), ''), 'Корректировка администратором')
  );
  return v_balance;
end;
$$;

revoke all on function public.apply_manual_bonus_scoped(uuid, numeric, text, uuid) from public;
grant execute on function public.apply_manual_bonus_scoped(uuid, numeric, text, uuid) to service_role;

alter table public.couriers
  add column if not exists auth_version integer not null default 1,
  add column if not exists last_login_at timestamptz;

alter table public.kaspi_orders
  add column if not exists delivery_pin varchar(6),
  add column if not exists delivery_confirmed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_delivery_pin_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders add constraint kaspi_orders_delivery_pin_check
      check (delivery_pin is null or delivery_pin ~ '^[0-9]{4,6}$');
  end if;
end $$;

create table if not exists public.courier_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.couriers(id) on delete cascade,
  token_hash varchar(64) not null unique,
  auth_version integer not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  ip_hash varchar(64),
  user_agent_hash varchar(64),
  created_at timestamptz not null default now()
);

create index if not exists courier_auth_sessions_courier_idx
  on public.courier_auth_sessions(courier_id, expires_at desc);
create index if not exists courier_auth_sessions_active_idx
  on public.courier_auth_sessions(token_hash, expires_at)
  where revoked_at is null;

create table if not exists public.courier_route_events (
  id bigint generated by default as identity primary key,
  courier_id uuid not null references public.couriers(id) on delete cascade,
  session_id uuid references public.courier_auth_sessions(id) on delete set null,
  order_id uuid references public.kaspi_orders(id) on delete set null,
  event_type varchar(32) not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint courier_route_event_coordinates_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  constraint courier_route_event_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists courier_route_events_courier_time_idx
  on public.courier_route_events(courier_id, created_at desc);
create index if not exists courier_route_events_order_time_idx
  on public.courier_route_events(order_id, created_at desc)
  where order_id is not null;

create table if not exists public.delivery_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.kaspi_orders(id) on delete cascade,
  courier_id uuid not null references public.couriers(id) on delete restrict,
  session_id uuid references public.courier_auth_sessions(id) on delete set null,
  photo_path text not null,
  pin_verified boolean not null default false,
  latitude numeric(10,7),
  longitude numeric(10,7),
  created_at timestamptz not null default now(),
  constraint delivery_proof_coordinates_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

create or replace function public.complete_courier_delivery(
  p_order_id uuid,
  p_courier_id uuid,
  p_session_id uuid,
  p_delivery_pin text,
  p_photo_path text,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns public.kaspi_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.kaspi_orders%rowtype;
begin
  if p_order_id is null or p_courier_id is null or p_session_id is null
    or nullif(btrim(p_photo_path), '') is null then
    raise exception 'delivery confirmation arguments are required';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
    or (p_latitude is not null and (p_latitude not between -90 and 90
      or p_longitude not between -180 and 180)) then
    raise exception 'invalid delivery coordinates';
  end if;

  select * into v_order from public.kaspi_orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'order not found'; end if;
  if v_order.courier_id is distinct from p_courier_id then
    raise exception 'order is assigned to another courier';
  end if;
  if v_order.delivery_status = 'delivered' and exists (
    select 1 from public.delivery_proofs
    where order_id = p_order_id and courier_id = p_courier_id and pin_verified = true
  ) then
    return v_order;
  end if;
  if v_order.status <> 'paid' or v_order.delivery_status not in ('picked_up', 'en_route') then
    raise exception 'order is not ready for delivery confirmation';
  end if;
  if v_order.delivery_pin is null
    or length(btrim(coalesce(p_delivery_pin, ''))) <> length(v_order.delivery_pin)
    or btrim(p_delivery_pin) <> v_order.delivery_pin then
    raise exception 'invalid delivery pin';
  end if;

  insert into public.delivery_proofs(
    order_id, courier_id, session_id, photo_path, pin_verified, latitude, longitude
  ) values (
    p_order_id, p_courier_id, p_session_id, p_photo_path, true, p_latitude, p_longitude
  );

  update public.kaspi_orders
  set delivery_status = 'delivered',
      delivered_at = now(),
      delivery_confirmed_at = now(),
      delivery_pin = null,
      fulfillment_status = 'completed',
      fulfilled_at = now(),
      updated_at = now()
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

revoke all on function public.complete_courier_delivery(uuid, uuid, uuid, text, text, numeric, numeric)
  from public;
grant execute on function public.complete_courier_delivery(uuid, uuid, uuid, text, text, numeric, numeric)
  to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'courier_auth_sessions', 'courier_route_events', 'delivery_proofs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
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

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'delivery-proofs',
  'delivery-proofs',
  false,
  6291456,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

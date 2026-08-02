-- Idempotent Kaspi refunds and loyalty reversal.
-- Canonical immutable migration; apply it only through the migration runner.

alter table public.kaspi_orders add column if not exists refund_status varchar(24);
alter table public.kaspi_orders add column if not exists refund_amount numeric(12, 2);
alter table public.kaspi_orders add column if not exists refund_reference varchar(160);
alter table public.kaspi_orders add column if not exists refund_requested_at timestamptz;
alter table public.kaspi_orders add column if not exists refunded_at timestamptz;
alter table public.kaspi_orders add column if not exists refund_error varchar(1000);
alter table public.kaspi_orders add column if not exists bonus_reversed_at timestamptz;

create index if not exists kaspi_orders_refund_reconcile_idx
  on public.kaspi_orders(status, bonus_reversed_at)
  where status = 'refunded';

create unique index if not exists transactions_refund_reversal_unique_idx
  on public.transactions(order_id)
  where type = 'refund_reversal';

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
  v_balance numeric;
  v_total_spent numeric;
  v_active_bonus numeric := 0;
  v_pending_bonus numeric := 0;
  v_removed_bonus numeric := 0;
  v_items jsonb;
  v_original_found boolean := false;
begin
  if p_customer_id is null
    or p_order_id is null
    or btrim(p_order_id) = ''
    or coalesce(p_real_money_paid, 0) < 0 then
    raise exception 'invalid loyalty refund values';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_order_id));

  select balance, total_spent
    into v_balance, v_total_spent
    from public.customers
    where id = p_customer_id
    for update;

  if not found then
    raise exception 'customer not found';
  end if;

  if exists (
    select 1
    from public.transactions
    where customer_id = p_customer_id
      and order_id = v_refund_order_id
      and type = 'refund_reversal'
  ) then
    return jsonb_build_object(
      'duplicate', true,
      'balance', v_balance,
      'total_spent', v_total_spent,
      'removed_bonus', 0
    );
  end if;

  select exists (
    select 1
    from public.transactions
    where customer_id = p_customer_id
      and order_id = p_order_id
      and type in ('deposit', 'pending_deposit', 'withdrawal', 'order')
  ) into v_original_found;

  if not v_original_found then
    return jsonb_build_object(
      'duplicate', false,
      'applied', false,
      'balance', v_balance,
      'total_spent', v_total_spent,
      'removed_bonus', 0
    );
  end if;

  select
    coalesce(sum(amount) filter (where type = 'deposit'), 0),
    coalesce(sum(amount) filter (where type = 'pending_deposit'), 0),
    (array_agg(items) filter (where items is not null))[1]
  into v_active_bonus, v_pending_bonus, v_items
  from public.transactions
  where customer_id = p_customer_id
    and order_id = p_order_id;

  v_removed_bonus := least(v_balance, v_active_bonus);

  update public.customers
  set
    balance = greatest(0, balance - v_removed_bonus),
    total_spent = greatest(0, total_spent - coalesce(p_real_money_paid, 0)),
    updated_at = now()
  where id = p_customer_id
  returning balance, total_spent into v_balance, v_total_spent;

  update public.transactions
  set
    type = 'cancelled_deposit',
    activated_at = coalesce(activated_at, now()),
    description = coalesce(description, '') || ' / отменён возвратом'
  where customer_id = p_customer_id
    and order_id = p_order_id
    and type = 'pending_deposit';

  insert into public.transactions (
    customer_id,
    order_id,
    type,
    amount,
    order_total,
    description,
    items
  )
  values (
    p_customer_id,
    v_refund_order_id,
    'refund_reversal',
    v_removed_bonus,
    coalesce(p_real_money_paid, 0),
    case
      when v_removed_bonus < v_active_bonus
        then 'Сторнирование кэшбэка после возврата / часть бонусов уже использована'
      else 'Сторнирование кэшбэка после возврата'
    end,
    v_items
  );

  return jsonb_build_object(
    'duplicate', false,
    'applied', true,
    'balance', v_balance,
    'total_spent', v_total_spent,
    'removed_bonus', v_removed_bonus,
    'cancelled_pending_bonus', v_pending_bonus
  );
end;
$$;

revoke all on function public.reverse_loyalty_order(uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.reverse_loyalty_order(uuid, text, numeric)
  to service_role;

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
      coalesce(sum(
        case
          when type in ('deposit', 'manual_deposit', 'manual') then amount
          when type = 'refund_reversal' then -amount
          else 0
        end
      ), 0)::numeric as earned,
      coalesce(sum(amount) filter (
        where type in ('withdrawal', 'manual_withdrawal', 'expiration')
      ), 0)::numeric as burned,
      coalesce(sum(
        case
          when timestamp >= now() - interval '30 days'
            and type in ('deposit', 'manual_deposit', 'manual') then amount
          when timestamp >= now() - interval '30 days'
            and type = 'refund_reversal' then -amount
          else 0
        end
      ), 0)::numeric as earned_30,
      coalesce(sum(amount) filter (
        where type in ('withdrawal', 'manual_withdrawal', 'expiration')
          and timestamp >= now() - interval '30 days'
      ), 0)::numeric as burned_30
    from public.transactions
  )
  select jsonb_build_object(
    'totalCustomers', c.total_customers,
    'newCustomersLast30Days', c.new_customers,
    'totalSales', c.total_sales,
    'totalEarned', greatest(t.earned, 0),
    'totalBurned', t.burned,
    'earnedLast30Days', greatest(t.earned_30, 0),
    'burnedLast30Days', t.burned_30,
    'bonusPaymentPercent', case
      when c.total_sales + t.burned > 0
        then round(t.burned * 100 / (c.total_sales + t.burned), 1)::text
      else '0.0'
    end,
    'currentLiabilities', c.liabilities
  )
  from customer_totals c cross join transaction_totals t;
$$;

revoke all on function public.get_admin_stats() from public, anon, authenticated;
grant execute on function public.get_admin_stats() to service_role;

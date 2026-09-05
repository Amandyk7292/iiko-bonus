-- Keep analytics aligned with the financial ledger. This migration replaces
-- the two admin stats RPCs without rewriting the already applied migrations.

begin;

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
      greatest(
        0,
        coalesce(sum(amount) filter (where type in ('deposit', 'pending_deposit', 'manual_deposit', 'manual')), 0)
          - coalesce(sum(amount) filter (where type = 'refund_reversal'), 0)
      )::numeric as earned,
      greatest(
        0,
        coalesce(sum(amount) filter (where type in ('withdrawal', 'manual_withdrawal', 'expiration')), 0)
          - coalesce(sum(amount) filter (where type = 'refund_bonus_restore'), 0)
      )::numeric as burned,
      greatest(
        0,
        coalesce(sum(amount) filter (where type = 'withdrawal' and order_id is not null), 0)
          - coalesce(sum(amount) filter (where type = 'refund_bonus_restore'), 0)
      )::numeric as redeemed,
      greatest(
        0,
        coalesce(sum(amount) filter (where type in ('deposit', 'pending_deposit', 'manual_deposit', 'manual') and timestamp >= now() - interval '30 days'), 0)
          - coalesce(sum(amount) filter (where type = 'refund_reversal' and timestamp >= now() - interval '30 days'), 0)
      )::numeric as earned_30,
      greatest(
        0,
        coalesce(sum(amount) filter (where type in ('withdrawal', 'manual_withdrawal', 'expiration') and timestamp >= now() - interval '30 days'), 0)
          - coalesce(sum(amount) filter (where type = 'refund_bonus_restore' and timestamp >= now() - interval '30 days'), 0)
      )::numeric as burned_30,
      greatest(
        0,
        coalesce(sum(amount) filter (where type = 'withdrawal' and order_id is not null and timestamp >= now() - interval '30 days'), 0)
          - coalesce(sum(amount) filter (where type = 'refund_bonus_restore' and timestamp >= now() - interval '30 days'), 0)
      )::numeric as redeemed_30
    from public.transactions
  ), order_totals as (
    select
      count(*) filter (where status in ('paid', 'refunded'))::integer as paid_orders,
      count(*) filter (where status in ('paid', 'refunded') and created_at >= now() - interval '30 days')::integer as paid_orders_30,
      coalesce(sum(greatest(0, amount - greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0)))) filter (where status in ('paid', 'refunded') and created_at >= now() - interval '30 days'), 0)::numeric as sales_30,
      coalesce(avg(greatest(0, amount - greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0)))) filter (where status in ('paid', 'refunded') and created_at >= now() - interval '30 days'), 0)::numeric as average_order_30,
      count(*) filter (where fulfillment_status = 'cancelled' and created_at >= now() - interval '30 days')::integer as cancelled_30,
      count(*) filter (where greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0)) > 0 and created_at >= now() - interval '30 days')::integer as refunds_30,
      coalesce(sum(greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0))) filter (where greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0)) > 0 and created_at >= now() - interval '30 days'), 0)::numeric as refund_amount_30,
      count(*) filter (where status = 'paid' and fulfillment_status not in ('completed', 'cancelled'))::integer as active_orders,
      coalesce(avg(extract(epoch from (fulfilled_at - created_at)) / 60)
        filter (where fulfillment_status = 'completed' and fulfilled_at is not null and created_at >= now() - interval '30 days'), 0)::numeric as completion_minutes_30
    from public.kaspi_orders
  ), branch_stats as (
    select coalesce(jsonb_agg(row_to_json(value) order by value.revenue desc), '[]'::jsonb) as value
    from (
      select coalesce(branch_name, 'Без филиала') as branch,
        count(*)::integer as orders,
        coalesce(sum(greatest(0, amount - greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0)))), 0)::numeric as revenue
      from public.kaspi_orders
      where status = 'paid' and created_at >= now() - interval '30 days'
      group by coalesce(branch_name, 'Без филиала')
      limit 20
    ) value
  ), top_products as (
    select coalesce(jsonb_agg(row_to_json(value) order by value.quantity desc), '[]'::jsonb) as value
    from (
      select item->>'id' as id,
        max(item->>'name') as name,
        sum(greatest(coalesce((item->>'quantity')::integer, 0), 0))::integer as quantity,
        sum(greatest(coalesce((item->>'quantity')::numeric, 0), 0) * greatest(coalesce((item->>'price')::numeric, 0), 0))::numeric as revenue
      from public.kaspi_orders cross join lateral jsonb_array_elements(coalesce(cart_items, '[]'::jsonb)) item
      where status = 'paid' and created_at >= now() - interval '30 days'
      group by item->>'id'
      order by quantity desc
      limit 10
    ) value
  ), funnel as (
    select coalesce(jsonb_object_agg(event_type, count_value), '{}'::jsonb) as value
    from (
      select event_type, count(*)::integer as count_value
      from public.customer_app_events
      where occurred_at >= now() - interval '30 days'
      group by event_type
    ) source
  )
  select jsonb_build_object(
    'totalCustomers', c.total_customers,
    'newCustomersLast30Days', c.new_customers,
    'totalSales', c.total_sales,
    'totalEarned', t.earned,
    'totalBurned', t.burned,
    'totalRedeemed', t.redeemed,
    'earnedLast30Days', t.earned_30,
    'burnedLast30Days', t.burned_30,
    'redeemedLast30Days', t.redeemed_30,
    'bonusPaymentPercent', case when c.total_sales + t.redeemed > 0 then round(t.redeemed * 100 / (c.total_sales + t.redeemed), 1)::text else '0.0' end,
    'currentLiabilities', c.liabilities,
    'paidOrders', o.paid_orders,
    'paidOrdersLast30Days', o.paid_orders_30,
    'salesLast30Days', o.sales_30,
    'averageOrderValueLast30Days', round(o.average_order_30, 2),
    'cancelledOrdersLast30Days', o.cancelled_30,
    'refundsLast30Days', o.refunds_30,
    'refundAmountLast30Days', o.refund_amount_30,
    'activeOrders', o.active_orders,
    'averageCompletionMinutesLast30Days', round(o.completion_minutes_30, 1),
    'branchPerformance', b.value,
    'topProducts', p.value,
    'funnel', f.value
  )
  from customer_totals c
  cross join transaction_totals t
  cross join order_totals o
  cross join branch_stats b
  cross join top_products p
  cross join funnel f;
$$;

create or replace function public.get_admin_stats_scoped(p_branch_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped_orders as (
    select *
    from public.kaspi_orders
    where branch_id = any(coalesce(p_branch_ids, '{}'::uuid[]))
  ), eligible_orders as (
    select *
    from scoped_orders
    where customer_id is not null
      and status in ('paid', 'refunded')
  ), scoped_customers as (
    select customer.*
    from public.customers customer
    where customer.id in (select distinct customer_id from eligible_orders)
  ), scoped_transactions as (
    select *
    from public.transactions
    where branch_id = any(coalesce(p_branch_ids, '{}'::uuid[]))
  ), customer_totals as (
    select
      count(*)::integer as total_customers,
      count(*) filter (where created_at >= now() - interval '30 days')::integer as new_customers,
      coalesce(sum(total_spent), 0)::numeric as customer_total_spent
    from scoped_customers
  ), transaction_totals as (
    select
      greatest(0, coalesce(sum(amount) filter (where type in ('deposit', 'pending_deposit', 'manual_deposit', 'manual')), 0) - coalesce(sum(amount) filter (where type = 'refund_reversal'), 0))::numeric as earned,
      greatest(0, coalesce(sum(amount) filter (where type in ('withdrawal', 'manual_withdrawal', 'expiration')), 0) - coalesce(sum(amount) filter (where type = 'refund_bonus_restore'), 0))::numeric as burned,
      greatest(0, coalesce(sum(amount) filter (where type = 'withdrawal' and order_id is not null), 0) - coalesce(sum(amount) filter (where type = 'refund_bonus_restore'), 0))::numeric as redeemed,
      greatest(0, coalesce(sum(amount) filter (where type in ('deposit', 'pending_deposit', 'manual_deposit', 'manual') and timestamp >= now() - interval '30 days'), 0) - coalesce(sum(amount) filter (where type = 'refund_reversal' and timestamp >= now() - interval '30 days'), 0))::numeric as earned_30,
      greatest(0, coalesce(sum(amount) filter (where type in ('withdrawal', 'manual_withdrawal', 'expiration') and timestamp >= now() - interval '30 days'), 0) - coalesce(sum(amount) filter (where type = 'refund_bonus_restore' and timestamp >= now() - interval '30 days'), 0))::numeric as burned_30,
      greatest(0, coalesce(sum(amount) filter (where type = 'withdrawal' and order_id is not null and timestamp >= now() - interval '30 days'), 0) - coalesce(sum(amount) filter (where type = 'refund_bonus_restore' and timestamp >= now() - interval '30 days'), 0))::numeric as redeemed_30,
      greatest(0,
        coalesce(sum(amount) filter (where type in ('deposit', 'pending_deposit', 'manual_deposit', 'manual', 'refund_bonus_restore')), 0)
        - coalesce(sum(amount) filter (where type in ('withdrawal', 'manual_withdrawal', 'expiration', 'refund_reversal')), 0)
      )::numeric as liabilities
    from scoped_transactions
  ), order_totals as (
    select
      count(*) filter (where status in ('paid', 'refunded'))::integer as paid_orders,
      count(*) filter (where status in ('paid', 'refunded') and created_at >= now() - interval '30 days')::integer as paid_orders_30,
      coalesce(sum(greatest(0, amount - greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0)))) filter (where status in ('paid', 'refunded') and created_at >= now() - interval '30 days'), 0)::numeric as sales_30,
      coalesce(avg(greatest(0, amount - greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0)))) filter (where status in ('paid', 'refunded') and created_at >= now() - interval '30 days'), 0)::numeric as average_order_30,
      count(*) filter (where fulfillment_status = 'cancelled' and created_at >= now() - interval '30 days')::integer as cancelled_30,
      count(*) filter (where greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0)) > 0 and created_at >= now() - interval '30 days')::integer as refunds_30,
      coalesce(sum(greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0))) filter (where greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0)) > 0 and created_at >= now() - interval '30 days'), 0)::numeric as refund_amount_30,
      count(*) filter (where status = 'paid' and fulfillment_status not in ('completed', 'cancelled'))::integer as active_orders,
      coalesce(avg(extract(epoch from (fulfilled_at - created_at)) / 60) filter (where fulfillment_status = 'completed' and fulfilled_at is not null and created_at >= now() - interval '30 days'), 0)::numeric as completion_minutes_30,
      coalesce(sum(greatest(0, amount - greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0)))) filter (where status in ('paid', 'refunded')), 0)::numeric as total_sales
    from scoped_orders
  ), branch_stats as (
    select coalesce(jsonb_agg(row_to_json(value) order by value.revenue desc), '[]'::jsonb) as value
    from (
      select coalesce(branch_name, 'Без филиала') as branch,
        count(*)::integer as orders,
        coalesce(sum(greatest(0, amount - greatest(coalesce(refund_amount, 0), coalesce(partially_refunded_amount, 0)))), 0)::numeric as revenue
      from scoped_orders
      where status in ('paid', 'refunded') and created_at >= now() - interval '30 days'
      group by coalesce(branch_name, 'Без филиала')
      order by revenue desc
      limit 20
    ) value
  ), top_products as (
    select coalesce(jsonb_agg(row_to_json(value) order by value.quantity desc), '[]'::jsonb) as value
    from (
      select item->>'id' as id,
        max(item->>'name') as name,
        sum(greatest(coalesce((item->>'quantity')::integer, 0), 0))::integer as quantity,
        sum(greatest(coalesce((item->>'quantity')::numeric, 0), 0) * greatest(coalesce((item->>'price')::numeric, 0), 0))::numeric as revenue
      from scoped_orders
      cross join lateral jsonb_array_elements(coalesce(cart_items, '[]'::jsonb)) item
      where status = 'paid' and created_at >= now() - interval '30 days'
      group by item->>'id'
      order by quantity desc
      limit 10
    ) value
  ), funnel as (
    select coalesce(jsonb_object_agg(event_type, count_value), '{}'::jsonb) as value
    from (
      select event_type, count(*)::integer as count_value
      from public.customer_app_events
      where branch_id = any(coalesce(p_branch_ids, '{}'::uuid[]))
        and occurred_at >= now() - interval '30 days'
      group by event_type
    ) source
  )
  select jsonb_build_object(
    'totalCustomers', customer.total_customers,
    'newCustomersLast30Days', customer.new_customers,
    'totalSales', orders.total_sales,
    'totalEarned', transactions.earned,
    'totalBurned', transactions.burned,
    'totalRedeemed', transactions.redeemed,
    'earnedLast30Days', transactions.earned_30,
    'burnedLast30Days', transactions.burned_30,
    'redeemedLast30Days', transactions.redeemed_30,
    'bonusPaymentPercent', case
      when orders.total_sales + transactions.redeemed > 0
        then round(transactions.redeemed * 100 / (orders.total_sales + transactions.redeemed), 1)::text
      else '0.0'
    end,
    'currentLiabilities', transactions.liabilities,
    'paidOrders', orders.paid_orders,
    'paidOrdersLast30Days', orders.paid_orders_30,
    'salesLast30Days', orders.sales_30,
    'averageOrderValueLast30Days', round(orders.average_order_30, 2),
    'cancelledOrdersLast30Days', orders.cancelled_30,
    'refundsLast30Days', orders.refunds_30,
    'refundAmountLast30Days', orders.refund_amount_30,
    'activeOrders', orders.active_orders,
    'averageCompletionMinutesLast30Days', round(orders.completion_minutes_30, 1),
    'branchPerformance', branches.value,
    'topProducts', products.value,
    'funnel', funnel.value
  )
  from customer_totals customer
  cross join transaction_totals transactions
  cross join order_totals orders
  cross join branch_stats branches
  cross join top_products products
  cross join funnel;
$$;

revoke all on function public.get_admin_stats() from public, anon, authenticated;
grant execute on function public.get_admin_stats() to service_role;
revoke all on function public.get_admin_stats_scoped(uuid[]) from public, anon, authenticated;
grant execute on function public.get_admin_stats_scoped(uuid[]) to service_role;

commit;

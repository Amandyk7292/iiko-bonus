begin;

alter table public.customer_support_requests
  add column if not exists priority text not null default 'normal',
  add column if not exists due_at timestamptz,
  add column if not exists first_responded_at timestamptz,
  add column if not exists last_message_at timestamptz,
  add column if not exists last_message_preview text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_support_requests_priority_check'
      and conrelid = 'public.customer_support_requests'::regclass
  ) then
    alter table public.customer_support_requests
      add constraint customer_support_requests_priority_check
      check (priority in ('low', 'normal', 'high', 'urgent'));
  end if;
end;
$$;

update public.customer_support_requests
set
  due_at = coalesce(
    due_at,
    created_at + case priority
      when 'urgent' then interval '30 minutes'
      when 'high' then interval '2 hours'
      when 'low' then interval '1 day'
      else interval '4 hours'
    end
  ),
  last_message_at = coalesce(last_message_at, updated_at, created_at),
  last_message_preview = coalesce(last_message_preview, message);

alter table public.customer_support_requests
  alter column due_at set default (now() + interval '4 hours');

create table if not exists public.customer_support_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.customer_support_requests(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer', 'admin', 'system')),
  sender_id text,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 3),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists customer_support_messages_request_idx
  on public.customer_support_messages(request_id, created_at);
create index if not exists customer_support_sla_queue_idx
  on public.customer_support_requests(status, due_at, priority, created_at desc);
create index if not exists customer_support_assignee_idx
  on public.customer_support_requests(assigned_to, status, updated_at desc);

insert into public.customer_support_messages (
  request_id,
  sender_type,
  sender_id,
  body,
  attachments,
  created_at
)
select
  request.id,
  'customer',
  request.customer_id::text,
  request.message,
  request.attachments,
  request.created_at
from public.customer_support_requests request
where not exists (
  select 1
  from public.customer_support_messages message
  where message.request_id = request.id
    and message.sender_type = 'customer'
    and message.created_at = request.created_at
);

insert into public.customer_support_messages (
  request_id,
  sender_type,
  sender_id,
  body,
  created_at
)
select
  request.id,
  'admin',
  request.assigned_to,
  request.resolution,
  coalesce(request.resolved_at, request.updated_at)
from public.customer_support_requests request
where request.resolution is not null
  and char_length(btrim(request.resolution)) > 0
  and not exists (
    select 1
    from public.customer_support_messages message
    where message.request_id = request.id
      and message.sender_type = 'admin'
      and message.body = request.resolution
  );

update public.customer_support_requests request
set
  last_message_at = coalesce(
    (
      select message.created_at
      from public.customer_support_messages message
      where message.request_id = request.id
      order by message.created_at desc, message.id desc
      limit 1
    ),
    request.last_message_at,
    request.updated_at,
    request.created_at
  ),
  last_message_preview = coalesce(
    (
      select left(message.body, 500)
      from public.customer_support_messages message
      where message.request_id = request.id
      order by message.created_at desc, message.id desc
      limit 1
    ),
    request.last_message_preview,
    request.message
  ),
  first_responded_at = coalesce(
    request.first_responded_at,
    (
      select message.created_at
      from public.customer_support_messages message
      where message.request_id = request.id
        and message.sender_type = 'admin'
        and message.is_internal = false
      order by message.created_at, message.id
      limit 1
    )
  );

create or replace function public.sync_customer_support_request_from_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.customer_support_requests
  set
    last_message_at = new.created_at,
    last_message_preview = left(new.body, 500),
    first_responded_at = case
      when new.sender_type = 'admin' and new.is_internal = false
        then coalesce(first_responded_at, new.created_at)
      else first_responded_at
    end,
    status = case
      when new.sender_type = 'admin' and new.is_internal = false and status = 'new'
        then 'in_review'
      when new.sender_type = 'customer' and status in ('resolved', 'rejected')
        then 'in_review'
      else status
    end,
    resolved_at = case
      when new.sender_type = 'customer' and status in ('resolved', 'rejected') then null
      else resolved_at
    end,
    updated_at = now()
  where id = new.request_id;
  return new;
end;
$$;

revoke all on function public.sync_customer_support_request_from_message()
  from public, anon, authenticated;

drop trigger if exists customer_support_messages_sync_request
  on public.customer_support_messages;
create trigger customer_support_messages_sync_request
after insert on public.customer_support_messages
for each row execute function public.sync_customer_support_request_from_message();

alter table public.customer_support_messages enable row level security;
drop policy if exists service_role_all_customer_support_messages
  on public.customer_support_messages;
create policy service_role_all_customer_support_messages
  on public.customer_support_messages for all to service_role
  using (true) with check (true);

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
  ),
  eligible_orders as (
    select *
    from scoped_orders
    where customer_id is not null
      and status in ('paid', 'refunded')
  ),
  scoped_customers as (
    select customer.*
    from public.customers customer
    where customer.id in (select distinct customer_id from eligible_orders)
  ),
  scoped_transactions as (
    select *
    from public.transactions
    where branch_id = any(coalesce(p_branch_ids, '{}'::uuid[]))
  ),
  customer_totals as (
    select
      count(*)::integer as total_customers,
      count(*) filter (where created_at >= now() - interval '30 days')::integer as new_customers,
      coalesce(sum(total_spent), 0)::numeric as customer_total_spent
    from scoped_customers
  ),
  transaction_totals as (
    select
      greatest(
        0,
        coalesce(sum(amount) filter (
          where type in ('deposit', 'pending_deposit', 'manual_deposit', 'manual')
        ), 0)
        - coalesce(sum(amount) filter (where type = 'refund_reversal'), 0)
      )::numeric as earned,
      greatest(
        0,
        coalesce(sum(amount) filter (
          where type in ('withdrawal', 'manual_withdrawal', 'expiration')
        ), 0)
        - coalesce(sum(amount) filter (where type = 'refund_bonus_restore'), 0)
      )::numeric as burned,
      greatest(
        0,
        coalesce(sum(amount) filter (
          where type in ('deposit', 'pending_deposit', 'manual_deposit', 'manual')
            and timestamp >= now() - interval '30 days'
        ), 0)
        - coalesce(sum(amount) filter (
          where type = 'refund_reversal'
            and timestamp >= now() - interval '30 days'
        ), 0)
      )::numeric as earned_30,
      greatest(
        0,
        coalesce(sum(amount) filter (
          where type in ('withdrawal', 'manual_withdrawal', 'expiration')
            and timestamp >= now() - interval '30 days'
        ), 0)
        - coalesce(sum(amount) filter (
          where type = 'refund_bonus_restore'
            and timestamp >= now() - interval '30 days'
        ), 0)
      )::numeric as burned_30,
      greatest(
        0,
        coalesce(sum(amount) filter (
          where type in (
            'deposit',
            'pending_deposit',
            'manual_deposit',
            'manual',
            'refund_bonus_restore'
          )
        ), 0)
        - coalesce(sum(amount) filter (
          where type in (
            'withdrawal',
            'manual_withdrawal',
            'expiration',
            'refund_reversal'
          )
        ), 0)
      )::numeric as liabilities
    from scoped_transactions
  ),
  order_totals as (
    select
      count(*) filter (where status in ('paid', 'refunded'))::integer as paid_orders,
      count(*) filter (
        where status in ('paid', 'refunded')
          and created_at >= now() - interval '30 days'
      )::integer as paid_orders_30,
      coalesce(sum(amount) filter (
        where status = 'paid' and created_at >= now() - interval '30 days'
      ), 0)::numeric as sales_30,
      coalesce(avg(amount) filter (
        where status in ('paid', 'refunded')
          and created_at >= now() - interval '30 days'
      ), 0)::numeric as average_order_30,
      count(*) filter (
        where fulfillment_status = 'cancelled'
          and created_at >= now() - interval '30 days'
      )::integer as cancelled_30,
      count(*) filter (
        where status = 'refunded' and created_at >= now() - interval '30 days'
      )::integer as refunds_30,
      coalesce(sum(refund_amount) filter (
        where status = 'refunded' and created_at >= now() - interval '30 days'
      ), 0)::numeric as refund_amount_30,
      count(*) filter (
        where status = 'paid'
          and fulfillment_status not in ('completed', 'cancelled')
      )::integer as active_orders,
      coalesce(avg(extract(epoch from (fulfilled_at - created_at)) / 60) filter (
        where fulfillment_status = 'completed'
          and fulfilled_at is not null
          and created_at >= now() - interval '30 days'
      ), 0)::numeric as completion_minutes_30,
      coalesce(sum(greatest(0, amount - coalesce(refund_amount, 0))) filter (
        where status in ('paid', 'refunded')
      ), 0)::numeric as total_sales
    from scoped_orders
  ),
  branch_stats as (
    select coalesce(
      jsonb_agg(row_to_json(value) order by value.revenue desc),
      '[]'::jsonb
    ) as value
    from (
      select
        coalesce(branch_name, 'Без филиала') as branch,
        count(*)::integer as orders,
        coalesce(sum(amount) filter (where status = 'paid'), 0)::numeric as revenue
      from scoped_orders
      where status in ('paid', 'refunded')
        and created_at >= now() - interval '30 days'
      group by coalesce(branch_name, 'Без филиала')
      order by revenue desc
      limit 20
    ) value
  ),
  top_products as (
    select coalesce(
      jsonb_agg(row_to_json(value) order by value.quantity desc),
      '[]'::jsonb
    ) as value
    from (
      select
        item->>'id' as id,
        max(item->>'name') as name,
        sum(greatest(coalesce((item->>'quantity')::integer, 0), 0))::integer as quantity,
        sum(
          greatest(coalesce((item->>'quantity')::numeric, 0), 0)
          * greatest(coalesce((item->>'price')::numeric, 0), 0)
        )::numeric as revenue
      from scoped_orders
      cross join lateral jsonb_array_elements(coalesce(cart_items, '[]'::jsonb)) item
      where status = 'paid'
        and created_at >= now() - interval '30 days'
      group by item->>'id'
      order by quantity desc
      limit 10
    ) value
  ),
  funnel as (
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
    'earnedLast30Days', transactions.earned_30,
    'burnedLast30Days', transactions.burned_30,
    'bonusPaymentPercent', case
      when orders.total_sales + transactions.burned > 0
        then round(
          transactions.burned * 100 / (orders.total_sales + transactions.burned),
          1
        )::text
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

revoke all on function public.get_admin_stats_scoped(uuid[]) from public, anon, authenticated;
grant execute on function public.get_admin_stats_scoped(uuid[]) to service_role;

commit;

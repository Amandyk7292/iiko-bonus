begin;

alter table public.customer_app_events
  add column if not exists client_event_id uuid;

alter table public.customer_app_events
  drop constraint if exists customer_app_events_type_check;

alter table public.customer_app_events
  add constraint customer_app_events_type_check check (
    event_type in (
      'app_open', 'catalog_view', 'product_view', 'add_to_cart', 'remove_from_cart',
      'checkout_start', 'checkout_quote', 'payment_created', 'payment_paid',
      'payment_failed', 'payment_cancelled', 'search', 'promotion_view'
    )
  );

create unique index if not exists customer_app_events_client_event_idx
  on public.customer_app_events(client_event_id);

drop index if exists public.customer_app_events_order_milestone_idx;
create unique index customer_app_events_order_milestone_idx
  on public.customer_app_events(event_type, order_id)
  where order_id is not null
    and event_type in (
      'payment_created', 'payment_paid', 'payment_failed', 'payment_cancelled'
    );

create or replace function public.get_app_funnel(p_branch_ids uuid[] default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with identified_events as (
    select
      event_type,
      case
        when event_type in (
          'payment_created', 'payment_paid', 'payment_failed', 'payment_cancelled'
        ) and order_id is not null then 'order:' || order_id::text
        when anonymous_session_id is not null then 'session:' || anonymous_session_id
        when customer_id is not null then 'customer:' || customer_id::text
        else 'event:' || id::text
      end as actor_key
    from public.customer_app_events
    where occurred_at >= now() - interval '30 days'
      and (
        p_branch_ids is null
        or branch_id = any(coalesce(p_branch_ids, '{}'::uuid[]))
      )
  ),
  counts as (
    select event_type, count(distinct actor_key)::integer as value
    from identified_events
    group by event_type
  )
  select jsonb_build_object(
    'funnel',
    coalesce(jsonb_object_agg(event_type, value), '{}'::jsonb),
    'funnelStartEvent',
    case when p_branch_ids is null then 'app_open' else 'catalog_view' end
  )
  from counts;
$$;

revoke all on function public.get_app_funnel(uuid[]) from public, anon, authenticated;
grant execute on function public.get_app_funnel(uuid[]) to service_role;

create table if not exists public.order_substitution_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.kaspi_orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  line_key text not null,
  product_id text not null,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 99),
  action text not null check (
    action in ('remove_refund', 'call_customer', 'replace_with_approval')
  ),
  status text not null default 'pending' check (
    status in (
      'pending', 'processing', 'contacting', 'awaiting_customer',
      'approved', 'rejected', 'completed', 'failed', 'cancelled'
    )
  ),
  replacement_product_id text,
  replacement_product_name text,
  note text,
  error text,
  refund_id uuid references public.order_partial_refunds(id) on delete set null,
  requested_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  completed_at timestamptz,
  constraint order_substitution_replacement_check check (
    action <> 'replace_with_approval'
    or (
      replacement_product_id is not null
      and replacement_product_name is not null
    )
  )
);

create index if not exists order_substitution_requests_order_idx
  on public.order_substitution_requests(order_id, created_at desc);
create index if not exists order_substitution_requests_customer_idx
  on public.order_substitution_requests(customer_id, status, created_at desc);
create unique index if not exists order_substitution_requests_active_line_idx
  on public.order_substitution_requests(order_id, line_key)
  where status in (
    'pending', 'processing', 'contacting', 'awaiting_customer', 'approved'
  );

alter table public.order_substitution_requests enable row level security;
drop policy if exists service_role_all_order_substitution_requests
  on public.order_substitution_requests;
create policy service_role_all_order_substitution_requests
  on public.order_substitution_requests for all to service_role
  using (true) with check (true);
revoke all on table public.order_substitution_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.order_substitution_requests to service_role;

commit;

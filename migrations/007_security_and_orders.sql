-- Security hardening, durable checkout metadata and admin audit trail.

create sequence if not exists public.kaspi_order_number_seq start with 100001;

alter table public.kaspi_orders add column if not exists subtotal numeric(12, 2);
alter table public.kaspi_orders add column if not exists discount_amount numeric(12, 2) not null default 0;
alter table public.kaspi_orders add column if not exists promo_code varchar(64);
alter table public.kaspi_orders add column if not exists branch_name varchar(160);
alter table public.kaspi_orders add column if not exists pickup_time varchar(40);
alter table public.kaspi_orders add column if not exists additional_phone varchar(32);
alter table public.kaspi_orders add column if not exists comment varchar(500);
alter table public.kaspi_orders add column if not exists fulfillment_status varchar(40) not null default 'pending';
alter table public.kaspi_orders add column if not exists fulfilled_at timestamptz;
alter table public.kaspi_orders add column if not exists iiko_order_id varchar(100);
alter table public.kaspi_orders add column if not exists last_error varchar(1000);
alter table public.kaspi_orders add column if not exists client_request_id uuid;
alter table public.kaspi_orders add column if not exists payment_method varchar(20);
alter table public.kaspi_orders add column if not exists qr_token varchar(1000);
alter table public.kaspi_orders add column if not exists earned_bonus numeric(12, 2);
alter table public.kaspi_orders add column if not exists bonus_awarded_at timestamptz;
alter table public.kaspi_orders add column if not exists order_number bigint;
alter table public.kaspi_orders add column if not exists cancellation_reason varchar(500);

alter table public.kaspi_orders
  alter column order_number set default nextval('public.kaspi_order_number_seq');
update public.kaspi_orders
set order_number = nextval('public.kaspi_order_number_seq')
where order_number is null;
alter table public.kaspi_orders alter column order_number set not null;
alter sequence public.kaspi_order_number_seq owned by public.kaspi_orders.order_number;

update public.kaspi_orders set subtotal = amount where subtotal is null;
create unique index if not exists kaspi_orders_operation_id_unique_idx
  on public.kaspi_orders(operation_id);
create unique index if not exists kaspi_orders_client_request_unique_idx
  on public.kaspi_orders(customer_id, client_request_id)
  where client_request_id is not null;
create unique index if not exists kaspi_orders_order_number_unique_idx
  on public.kaspi_orders(order_number);
create index if not exists kaspi_orders_fulfillment_idx
  on public.kaspi_orders(status, fulfillment_status, created_at desc);

alter table public.menu_overrides enable row level security;
alter table public.menu_category_overrides enable row level security;
alter table public.custom_products enable row level security;
drop policy if exists "service role manages menu overrides" on public.menu_overrides;
drop policy if exists "service role manages menu category overrides" on public.menu_category_overrides;
drop policy if exists "service role manages custom products" on public.custom_products;
create policy "service role manages menu overrides" on public.menu_overrides
  for all to service_role using (true) with check (true);
create policy "service role manages menu category overrides" on public.menu_category_overrides
  for all to service_role using (true) with check (true);
create policy "service role manages custom products" on public.custom_products
  for all to service_role using (true) with check (true);
revoke all on public.menu_overrides, public.menu_category_overrides, public.custom_products
  from public, anon, authenticated;
grant all on public.menu_overrides, public.menu_category_overrides, public.custom_products
  to service_role;

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_subject varchar(160) not null,
  admin_role varchar(32) not null,
  action varchar(16) not null,
  path varchar(500) not null,
  status_code integer not null,
  ip_hash varchar(64),
  user_agent varchar(500),
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs(created_at desc);
alter table public.admin_audit_logs enable row level security;
drop policy if exists "service role manages admin audit logs" on public.admin_audit_logs;
create policy "service role manages admin audit logs" on public.admin_audit_logs
  for all to service_role using (true) with check (true);
revoke all on public.admin_audit_logs from public, anon, authenticated;
grant all on public.admin_audit_logs to service_role;

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
      coalesce(sum(amount) filter (where type in ('deposit', 'manual_deposit', 'manual')), 0)::numeric as earned,
      coalesce(sum(amount) filter (where type in ('withdrawal', 'manual_withdrawal', 'expiration')), 0)::numeric as burned,
      coalesce(sum(amount) filter (where type in ('deposit', 'manual_deposit', 'manual') and timestamp >= now() - interval '30 days'), 0)::numeric as earned_30,
      coalesce(sum(amount) filter (where type in ('withdrawal', 'manual_withdrawal', 'expiration') and timestamp >= now() - interval '30 days'), 0)::numeric as burned_30
    from public.transactions
  )
  select jsonb_build_object(
    'totalCustomers', c.total_customers,
    'newCustomersLast30Days', c.new_customers,
    'totalSales', c.total_sales,
    'totalEarned', t.earned,
    'totalBurned', t.burned,
    'earnedLast30Days', t.earned_30,
    'burnedLast30Days', t.burned_30,
    'bonusPaymentPercent', case when c.total_sales + t.burned > 0 then round(t.burned * 100 / (c.total_sales + t.burned), 1)::text else '0.0' end,
    'currentLiabilities', c.liabilities
  )
  from customer_totals c cross join transaction_totals t;
$$;
revoke all on function public.get_admin_stats() from public, anon, authenticated;
grant execute on function public.get_admin_stats() to service_role;

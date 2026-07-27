create extension if not exists pgcrypto;

alter table public.kaspi_orders
  add column if not exists receipt_created_at timestamptz;

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique
    references public.kaspi_orders(id) on delete restrict,
  customer_id uuid
    references public.customers(id) on delete set null,
  order_number bigint not null,
  document_number varchar(80) not null unique,
  provider varchar(40) not null,
  payment_system varchar(40),
  operation_type varchar(32) not null default 'purchase',
  transaction_reference varchar(160),
  transaction_at timestamptz not null,
  currency char(3) not null default 'KZT',
  amount numeric(12, 2) not null,
  items jsonb not null default '[]'::jsonb,
  merchant_name varchar(160) not null default 'ИП РУБЛЕВА',
  merchant_code varchar(100),
  merchant_city varchar(100) not null default 'Астана',
  resource_name varchar(160) not null default 'Bulka',
  resource_url varchar(500) not null default 'https://bulka.com.kz',
  card_first_six varchar(6),
  card_last_four varchar(4),
  authorization_code varchar(100),
  outbox_id uuid
    references public.whatsapp_outbox(id) on delete set null,
  phone_queued_at timestamptz,
  phone_delivered_at timestamptz,
  email_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_receipts_amount_check
    check (amount >= 0 and amount <= 10000000),
  constraint payment_receipts_items_check
    check (jsonb_typeof(items) = 'array'),
  constraint payment_receipts_card_first_six_check
    check (card_first_six is null or card_first_six ~ '^[0-9]{6}$'),
  constraint payment_receipts_card_last_four_check
    check (card_last_four is null or card_last_four ~ '^[0-9]{4}$')
);

create index if not exists payment_receipts_customer_created_idx
  on public.payment_receipts(customer_id, created_at desc);
create index if not exists payment_receipts_order_number_idx
  on public.payment_receipts(order_number);
create index if not exists kaspi_orders_missing_receipt_idx
  on public.kaspi_orders(created_at)
  where status in ('paid', 'refunded') and receipt_created_at is null;

alter table public.payment_receipts enable row level security;
drop policy if exists service_role_all_payment_receipts
  on public.payment_receipts;
create policy service_role_all_payment_receipts
  on public.payment_receipts for all to service_role
  using (true) with check (true);
revoke all on public.payment_receipts from public, anon, authenticated;
grant all on public.payment_receipts to service_role;

insert into public.payment_receipts (
  order_id,
  customer_id,
  order_number,
  document_number,
  provider,
  payment_system,
  operation_type,
  transaction_reference,
  transaction_at,
  currency,
  amount,
  items,
  merchant_city
)
select
  orders.id,
  orders.customer_id,
  orders.order_number,
  'BLK-' || orders.order_number::text,
  'Kaspi Pay',
  'Kaspi Pay',
  'purchase',
  orders.operation_id,
  coalesce(orders.updated_at, orders.created_at, now()),
  'KZT',
  orders.amount,
  coalesce(orders.cart_items, '[]'::jsonb),
  coalesce(locations.city, 'Астана')
from public.kaspi_orders orders
left join public.bulka_locations locations on locations.id = orders.branch_id
where orders.status in ('paid', 'refunded')
on conflict (order_id) do nothing;

update public.kaspi_orders orders
set receipt_created_at = receipts.created_at
from public.payment_receipts receipts
where receipts.order_id = orders.id
  and orders.receipt_created_at is null;

update public.bulka_locations
set active = false, updated_at = now()
where city <> 'Астана'
  and active = true;

insert into public.bulka_locations (
  id,
  two_gis_id,
  city,
  name,
  address,
  latitude,
  longitude,
  hours,
  active,
  pickup_enabled,
  preorder_enabled,
  delivery_enabled,
  sort_order
)
values
  (
    '8b16867e-7e16-410c-967d-41fe6d045225',
    '70000001083965965',
    'Астана',
    'Bulka — Кабанбай батыра, 46а',
    'проспект Кабанбай батыра, 46а',
    51.115129,
    71.413679,
    '{"daily":{"open":"08:30","close":"20:30"}}',
    true,
    true,
    true,
    false,
    10
  ),
  (
    '247daad2-84c4-4f9d-ad7e-fa025b737601',
    '70000001084023223',
    'Астана',
    'Bulka — Кабанбай батыра, 59/3',
    'проспект Кабанбай батыра, 59/3',
    51.076150,
    71.396704,
    '{"daily":{"open":"08:30","close":"20:30"}}',
    true,
    true,
    true,
    false,
    20
  ),
  (
    'a0d9e30a-eafb-452a-9384-dabc4e927c20',
    '70000001101673386',
    'Астана',
    'Bulka — Улы Дала, 67',
    'проспект Улы Дала, 67',
    51.093634,
    71.444875,
    '{"daily":{"open":"08:30","close":"20:30"}}',
    true,
    true,
    true,
    false,
    30
  ),
  (
    '3d13eaa8-30e9-4d8a-9884-1ed59828f98b',
    '70000001088912178',
    'Астана',
    'Bulka — Улы Дала, 41/2',
    'проспект Улы Дала, 41/2',
    51.099446,
    71.416284,
    '{"daily":{"open":"09:00","close":"21:00"}}',
    true,
    true,
    true,
    false,
    40
  ),
  (
    '3b431d08-3321-4371-9cda-f92a28188739',
    '70000001104369754',
    'Астана',
    'Bulka — Розы Баглановой, 4',
    'улица Розы Баглановой, 4',
    51.116384,
    71.394683,
    '{"daily":{"open":"09:00","close":"21:00"}}',
    true,
    true,
    true,
    false,
    50
  )
on conflict (two_gis_id) do update set
  city = excluded.city,
  name = excluded.name,
  address = excluded.address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  hours = excluded.hours,
  active = true,
  pickup_enabled = true,
  preorder_enabled = true,
  sort_order = excluded.sort_order,
  updated_at = now();

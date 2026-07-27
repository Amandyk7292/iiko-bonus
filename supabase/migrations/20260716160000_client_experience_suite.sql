-- Client experience suite: notification preferences, order support, Live Activities and prep ETA.

alter table public.bulka_locations
  add column if not exists default_preparation_minutes integer not null default 15;

alter table public.menu_overrides
  add column if not exists preparation_minutes integer;

alter table public.custom_products
  add column if not exists preparation_minutes integer;

alter table public.branch_product_inventory
  add column if not exists preparation_minutes integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bulka_locations_default_preparation_check'
  ) then
    alter table public.bulka_locations
      add constraint bulka_locations_default_preparation_check
      check (default_preparation_minutes between 1 and 240);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'menu_overrides_preparation_check'
  ) then
    alter table public.menu_overrides
      add constraint menu_overrides_preparation_check
      check (preparation_minutes is null or preparation_minutes between 1 and 240);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'custom_products_preparation_check'
  ) then
    alter table public.custom_products
      add constraint custom_products_preparation_check
      check (preparation_minutes is null or preparation_minutes between 1 and 240);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'branch_inventory_preparation_check'
  ) then
    alter table public.branch_product_inventory
      add constraint branch_inventory_preparation_check
      check (preparation_minutes is null or preparation_minutes between 1 and 240);
  end if;
end $$;

create table if not exists public.customer_notification_preferences (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  orders_enabled boolean not null default true,
  bonus_enabled boolean not null default true,
  promos_enabled boolean not null default true,
  support_enabled boolean not null default true,
  quiet_hours_enabled boolean not null default false,
  quiet_start time not null default '22:00',
  quiet_end time not null default '08:00',
  timezone text not null default 'Asia/Aqtau',
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_support_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_id uuid references public.kaspi_orders(id) on delete set null,
  category text not null
    check (category in ('order_issue', 'product_quality', 'delivery', 'refund', 'other')),
  message text not null check (char_length(message) between 5 and 2000),
  status text not null default 'new'
    check (status in ('new', 'in_review', 'resolved', 'rejected')),
  refund_requested boolean not null default false,
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 3),
  resolution text,
  assigned_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists customer_support_customer_idx
  on public.customer_support_requests(customer_id, created_at desc);
create index if not exists customer_support_admin_queue_idx
  on public.customer_support_requests(status, created_at desc);
create index if not exists customer_support_order_idx
  on public.customer_support_requests(order_id, created_at desc);

create table if not exists public.customer_live_activity_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  installation_id text not null,
  activity_id text not null,
  push_token text not null unique,
  order_id uuid references public.kaspi_orders(id) on delete cascade,
  environment text not null default 'production'
    check (environment in ('sandbox', 'production')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, installation_id, activity_id)
);

create index if not exists customer_live_activity_order_idx
  on public.customer_live_activity_tokens(order_id, active);

alter table public.customer_notification_preferences enable row level security;
alter table public.customer_support_requests enable row level security;
alter table public.customer_live_activity_tokens enable row level security;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


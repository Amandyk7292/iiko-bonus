-- Yandex Delivery integration. Provider jobs are stored separately from Bulka's
-- own couriers so external performers never pollute the internal courier roster.

create table if not exists public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.kaspi_orders(id) on delete cascade,
  provider varchar(32) not null default 'yandex',
  client_request_id uuid not null default gen_random_uuid(),
  external_claim_id varchar(128),
  external_version integer,
  provider_status varchar(64) not null default 'draft',
  internal_status varchar(24) not null default 'unassigned',
  auto_accept boolean not null default false,
  quoted_price numeric(12, 2),
  provider_price numeric(12, 2),
  currency varchar(3) not null default 'KZT',
  eta_minutes integer,
  distance_meters integer,
  tracking_url text,
  courier_name varchar(160),
  courier_phone varchar(32),
  courier_transport_type varchar(40),
  courier_car_model varchar(120),
  courier_car_number varchar(40),
  courier_car_color varchar(60),
  quote_expires_at timestamptz,
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  request_payload jsonb not null default '{}'::jsonb,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_jobs_provider_check check (provider in ('yandex')),
  constraint delivery_jobs_internal_status_check check (
    internal_status in ('unassigned', 'assigned', 'picked_up', 'en_route', 'delivered', 'cancelled')
  ),
  constraint delivery_jobs_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint delivery_jobs_price_check check (
    (quoted_price is null or quoted_price >= 0)
    and (provider_price is null or provider_price >= 0)
  )
);

create unique index if not exists delivery_jobs_client_request_unique_idx
  on public.delivery_jobs(client_request_id);
create unique index if not exists delivery_jobs_external_claim_unique_idx
  on public.delivery_jobs(provider, external_claim_id)
  where external_claim_id is not null;
create unique index if not exists delivery_jobs_one_active_per_order_idx
  on public.delivery_jobs(order_id, provider)
  where provider_status not in (
    'estimating_failed', 'performer_not_found', 'delivered', 'delivered_finish',
    'returned', 'returned_finish', 'failed', 'cancelled', 'cancelled_with_payment',
    'cancelled_by_taxi', 'cancelled_with_items_on_hands'
  );
create index if not exists delivery_jobs_sync_queue_idx
  on public.delivery_jobs(provider, last_synced_at, created_at)
  where external_claim_id is not null
    and provider_status not in (
      'estimating_failed', 'performer_not_found', 'delivered', 'delivered_finish',
      'returned', 'returned_finish', 'failed', 'cancelled', 'cancelled_with_payment',
      'cancelled_by_taxi', 'cancelled_with_items_on_hands'
    );
create index if not exists delivery_jobs_order_history_idx
  on public.delivery_jobs(order_id, created_at desc);

drop trigger if exists delivery_jobs_set_updated_at on public.delivery_jobs;
create trigger delivery_jobs_set_updated_at
before update on public.delivery_jobs
for each row execute function public.set_updated_at();

alter table public.delivery_jobs enable row level security;
drop policy if exists "service role manages delivery jobs" on public.delivery_jobs;
create policy "service role manages delivery jobs"
on public.delivery_jobs for all to service_role using (true) with check (true);
revoke all on public.delivery_jobs from public, anon, authenticated;
grant all on public.delivery_jobs to service_role;

comment on table public.delivery_jobs is
  'Idempotent jobs and status snapshots for external last-mile delivery providers.';

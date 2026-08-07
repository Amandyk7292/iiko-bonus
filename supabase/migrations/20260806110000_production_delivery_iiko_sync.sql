-- Durable production delivery orchestration and iiko delivery synchronization.
-- Payment creates the POS sync job; accepting the order in the kitchen creates
-- the courier dispatch job. Both jobs are retried by background workers.

alter table public.kaspi_orders
  add column if not exists iiko_pos_order_id uuid,
  add column if not exists iiko_sync_status varchar(24),
  add column if not exists iiko_sync_attempts integer not null default 0,
  add column if not exists iiko_sync_next_attempt_at timestamptz,
  add column if not exists iiko_sync_attempted_at timestamptz,
  add column if not exists iiko_synced_at timestamptz,
  add column if not exists iiko_sync_error text,
  add column if not exists iiko_delivery_status varchar(40),
  add column if not exists iiko_status_synced_at timestamptz,
  add column if not exists courier_dispatch_status varchar(24),
  add column if not exists courier_dispatch_provider varchar(24),
  add column if not exists courier_dispatch_attempts integer not null default 0,
  add column if not exists courier_dispatch_requested_at timestamptz,
  add column if not exists courier_dispatch_next_attempt_at timestamptz,
  add column if not exists courier_dispatch_attempted_at timestamptz,
  add column if not exists courier_dispatch_completed_at timestamptz,
  add column if not exists courier_dispatch_error text;

alter table public.couriers
  add column if not exists transport_type varchar(24);

update public.couriers
set transport_type = 'car'
where transport_type is null;

alter table public.couriers
  alter column transport_type set default 'car',
  alter column transport_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kaspi_orders_iiko_sync_status_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_iiko_sync_status_check
      check (
        iiko_sync_status is null
        or iiko_sync_status in ('pending', 'processing', 'retrying', 'succeeded', 'failed')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'kaspi_orders_courier_dispatch_status_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_courier_dispatch_status_check
      check (
        courier_dispatch_status is null
        or courier_dispatch_status in ('pending', 'processing', 'retrying', 'succeeded', 'failed')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'kaspi_orders_delivery_attempts_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_delivery_attempts_check
      check (iiko_sync_attempts >= 0 and courier_dispatch_attempts >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'couriers_transport_type_check'
      and conrelid = 'public.couriers'::regclass
  ) then
    alter table public.couriers
      add constraint couriers_transport_type_check
      check (transport_type in ('car', 'motorcycle', 'bicycle', 'foot'));
  end if;
end $$;

create index if not exists kaspi_orders_iiko_sync_queue_idx
  on public.kaspi_orders(iiko_sync_next_attempt_at, created_at)
  where iiko_sync_status in ('pending', 'retrying');

create index if not exists kaspi_orders_iiko_status_poll_idx
  on public.kaspi_orders(iiko_status_synced_at, created_at)
  where iiko_sync_status = 'succeeded'
    and iiko_order_id is not null
    and status = 'paid'
    and kitchen_status not in ('handed_over', 'cancelled');

create index if not exists kaspi_orders_courier_dispatch_queue_idx
  on public.kaspi_orders(courier_dispatch_next_attempt_at, created_at)
  where courier_dispatch_status in ('pending', 'retrying');

comment on column public.kaspi_orders.iiko_order_id is
  'Stable Bulka-generated UUID used as the iikoCloud delivery order ID.';
comment on column public.kaspi_orders.iiko_pos_order_id is
  'POS order ID returned by iikoCloud after the order reaches iikoFront.';
comment on column public.kaspi_orders.courier_dispatch_requested_at is
  'Set only after kitchen acceptance; payment alone must not call a courier.';
comment on column public.couriers.transport_type is
  'Courier transport. Production food delivery assignment accepts car only.';

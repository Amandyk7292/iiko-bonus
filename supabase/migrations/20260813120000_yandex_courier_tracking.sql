-- Persist the last location snapshot returned by Yandex Delivery.
-- The provider's performer-position endpoint is polled by the delivery worker;
-- customer and branch-scoped admin APIs expose only the sanitized latest point.

alter table public.delivery_jobs
  add column if not exists courier_latitude numeric(10, 7),
  add column if not exists courier_longitude numeric(10, 7),
  add column if not exists courier_location_updated_at timestamptz,
  add column if not exists courier_location_accuracy numeric(10, 2),
  add column if not exists courier_speed numeric(10, 3),
  add column if not exists courier_direction numeric(6, 2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'delivery_jobs_courier_position_check'
      and conrelid = 'public.delivery_jobs'::regclass
  ) then
    alter table public.delivery_jobs
      add constraint delivery_jobs_courier_position_check check (
        (courier_latitude is null and courier_longitude is null)
        or (
          courier_latitude between -90 and 90
          and courier_longitude between -180 and 180
        )
      );
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'delivery_jobs_courier_motion_check'
      and conrelid = 'public.delivery_jobs'::regclass
  ) then
    alter table public.delivery_jobs
      add constraint delivery_jobs_courier_motion_check check (
        (courier_location_accuracy is null or courier_location_accuracy >= 0)
        and (courier_speed is null or courier_speed >= 0)
        and (courier_direction is null or courier_direction between 0 and 360)
      );
  end if;
end
$$;

create index if not exists delivery_jobs_courier_location_idx
  on public.delivery_jobs(order_id, courier_location_updated_at desc)
  where courier_latitude is not null and courier_longitude is not null;

comment on column public.delivery_jobs.courier_latitude is
  'Latest provider courier latitude; refreshed by the delivery worker.';
comment on column public.delivery_jobs.courier_longitude is
  'Latest provider courier longitude; refreshed by the delivery worker.';
comment on column public.delivery_jobs.courier_location_updated_at is
  'Provider GPS timestamp for the latest courier position.';


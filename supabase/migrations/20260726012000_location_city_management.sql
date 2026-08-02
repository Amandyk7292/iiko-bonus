create table if not exists public.bulka_cities (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null,
  center_latitude numeric(10, 7),
  center_longitude numeric(10, 7),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bulka_cities_center_check check (
    (center_latitude is null and center_longitude is null)
    or (
      center_latitude between -90 and 90
      and center_longitude between -180 and 180
    )
  )
);

create unique index if not exists bulka_cities_name_unique_idx
  on public.bulka_cities ((lower(btrim(name))));

alter table public.bulka_locations
  add column if not exists city_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bulka_locations_city_id_fkey'
      and conrelid = 'public.bulka_locations'::regclass
  ) then
    alter table public.bulka_locations
      add constraint bulka_locations_city_id_fkey
      foreign key (city_id) references public.bulka_cities(id) on delete restrict;
  end if;
end
$$;

insert into public.bulka_cities (name, center_latitude, center_longitude)
select
  min(btrim(location.city)) as name,
  case
    when count(location.latitude) > 0 then round(avg(location.latitude), 7)
    else null
  end as center_latitude,
  case
    when count(location.longitude) > 0 then round(avg(location.longitude), 7)
    else null
  end as center_longitude
from public.bulka_locations location
where btrim(location.city) <> ''
group by lower(btrim(location.city))
on conflict ((lower(btrim(name)))) do update
set
  center_latitude = coalesce(
    public.bulka_cities.center_latitude,
    excluded.center_latitude
  ),
  center_longitude = coalesce(
    public.bulka_cities.center_longitude,
    excluded.center_longitude
  ),
  updated_at = now();

update public.bulka_locations location
set city_id = city.id
from public.bulka_cities city
where location.city_id is null
  and lower(btrim(location.city)) = lower(btrim(city.name));

create index if not exists bulka_locations_city_id_sort_idx
  on public.bulka_locations (city_id, sort_order, name);

alter table public.bulka_cities enable row level security;
drop policy if exists "service role manages bulka cities" on public.bulka_cities;
create policy "service role manages bulka cities"
  on public.bulka_cities
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.bulka_cities from public, anon, authenticated;
grant all on public.bulka_cities to service_role;

comment on table public.bulka_cities is
  'Canonical city registry for Bulka fulfillment locations.';

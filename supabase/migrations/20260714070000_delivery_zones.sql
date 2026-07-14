-- Multi-tier delivery zones managed from the admin map.
alter table public.bulka_locations
  add column if not exists delivery_zones jsonb not null default '[]'::jsonb;

update public.bulka_locations
set delivery_zones = jsonb_build_array(
  jsonb_build_object(
    'id', 'zone-near',
    'radiusKm', round((delivery_radius_km * 0.25)::numeric, 1),
    'fee', greatest(delivery_fee - 300, 0),
    'minOrder', delivery_min_order,
    'color', '#66BB6A'
  ),
  jsonb_build_object(
    'id', 'zone-city',
    'radiusKm', round((delivery_radius_km * 0.5)::numeric, 1),
    'fee', greatest(delivery_fee - 200, 0),
    'minOrder', delivery_min_order,
    'color', '#29B6F6'
  ),
  jsonb_build_object(
    'id', 'zone-far',
    'radiusKm', round((delivery_radius_km * 0.75)::numeric, 1),
    'fee', delivery_fee,
    'minOrder', delivery_min_order,
    'color', '#FFD54F'
  ),
  jsonb_build_object(
    'id', 'zone-edge',
    'radiusKm', delivery_radius_km,
    'fee', delivery_fee + 300,
    'minOrder', delivery_min_order,
    'color', '#EC407A'
  )
)
where delivery_enabled = true
  and delivery_radius_km > 0
  and delivery_fee >= 0
  and delivery_min_order >= 0
  and jsonb_array_length(delivery_zones) = 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bulka_locations_delivery_zones_check'
      and conrelid = 'public.bulka_locations'::regclass
  ) then
    alter table public.bulka_locations
      add constraint bulka_locations_delivery_zones_check
      check (
        jsonb_typeof(delivery_zones) = 'array'
        and jsonb_array_length(delivery_zones) <= 8
      );
  end if;
end $$;

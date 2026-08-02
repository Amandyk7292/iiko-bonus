-- Product facts and ETA 3.0 data.

alter table public.menu_overrides
  add column if not exists ingredients text,
  add column if not exists ingredients_translations jsonb,
  add column if not exists allergens text[] not null default '{}',
  add column if not exists dietary_tags text[] not null default '{}',
  add column if not exists search_keywords text[] not null default '{}',
  add column if not exists weight_grams integer,
  add column if not exists calories_kcal numeric(8, 2),
  add column if not exists protein_grams numeric(8, 2),
  add column if not exists fat_grams numeric(8, 2),
  add column if not exists carbs_grams numeric(8, 2);

alter table public.custom_products
  add column if not exists ingredients text,
  add column if not exists ingredients_translations jsonb,
  add column if not exists allergens text[] not null default '{}',
  add column if not exists dietary_tags text[] not null default '{}',
  add column if not exists search_keywords text[] not null default '{}',
  add column if not exists weight_grams integer,
  add column if not exists calories_kcal numeric(8, 2),
  add column if not exists protein_grams numeric(8, 2),
  add column if not exists fat_grams numeric(8, 2),
  add column if not exists carbs_grams numeric(8, 2),
  add column if not exists updated_at timestamptz not null default now();

alter table public.bulka_locations
  add column if not exists kitchen_parallel_capacity integer not null default 3;

alter table public.kaspi_orders
  add column if not exists eta_min_at timestamptz,
  add column if not exists eta_max_at timestamptz,
  add column if not exists eta_confidence varchar(16),
  add column if not exists eta_version varchar(32),
  add column if not exists eta_components jsonb not null default '{}'::jsonb,
  add column if not exists eta_updated_at timestamptz,
  add column if not exists route_distance_km numeric(8, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_overrides_product_facts_check') then
    alter table public.menu_overrides add constraint menu_overrides_product_facts_check check (
      (weight_grams is null or weight_grams between 1 and 100000)
      and (calories_kcal is null or calories_kcal between 0 and 100000)
      and (protein_grams is null or protein_grams between 0 and 100000)
      and (fat_grams is null or fat_grams between 0 and 100000)
      and (carbs_grams is null or carbs_grams between 0 and 100000)
      and cardinality(allergens) <= 30
      and cardinality(dietary_tags) <= 30
      and cardinality(search_keywords) <= 50
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'custom_products_product_facts_check') then
    alter table public.custom_products add constraint custom_products_product_facts_check check (
      (weight_grams is null or weight_grams between 1 and 100000)
      and (calories_kcal is null or calories_kcal between 0 and 100000)
      and (protein_grams is null or protein_grams between 0 and 100000)
      and (fat_grams is null or fat_grams between 0 and 100000)
      and (carbs_grams is null or carbs_grams between 0 and 100000)
      and cardinality(allergens) <= 30
      and cardinality(dietary_tags) <= 30
      and cardinality(search_keywords) <= 50
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bulka_locations_kitchen_capacity_check') then
    alter table public.bulka_locations add constraint bulka_locations_kitchen_capacity_check
      check (kitchen_parallel_capacity between 1 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kaspi_orders_eta_window_check') then
    alter table public.kaspi_orders add constraint kaspi_orders_eta_window_check check (
      eta_min_at is null or eta_max_at is null or eta_max_at >= eta_min_at
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kaspi_orders_eta_confidence_check') then
    alter table public.kaspi_orders add constraint kaspi_orders_eta_confidence_check check (
      eta_confidence is null or eta_confidence in ('low', 'medium', 'high')
    );
  end if;
end $$;

create index if not exists kaspi_orders_eta_history_idx
  on public.kaspi_orders(branch_id, delivered_at desc)
  where delivered_at is not null;

create index if not exists kaspi_orders_eta_active_kitchen_idx
  on public.kaspi_orders(branch_id, kitchen_status, created_at)
  where status = 'paid';

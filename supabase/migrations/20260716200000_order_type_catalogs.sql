-- Separate customer catalogs for pickup, delivery and preorder.

alter table public.menu_overrides
  add column if not exists fulfillment_types text[] not null
  default array['pickup', 'delivery', 'preorder']::text[];

alter table public.custom_products
  add column if not exists fulfillment_types text[] not null
  default array['pickup', 'delivery', 'preorder']::text[];

update public.menu_overrides
set fulfillment_types = array['pickup', 'delivery', 'preorder']::text[]
where fulfillment_types is null or cardinality(fulfillment_types) = 0;

update public.custom_products
set fulfillment_types = array['pickup', 'delivery', 'preorder']::text[]
where fulfillment_types is null or cardinality(fulfillment_types) = 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'menu_overrides_fulfillment_types_check'
  ) then
    alter table public.menu_overrides
      add constraint menu_overrides_fulfillment_types_check check (
        cardinality(fulfillment_types) between 1 and 3
        and fulfillment_types <@ array['pickup', 'delivery', 'preorder']::text[]
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'custom_products_fulfillment_types_check'
  ) then
    alter table public.custom_products
      add constraint custom_products_fulfillment_types_check check (
        cardinality(fulfillment_types) between 1 and 3
        and fulfillment_types <@ array['pickup', 'delivery', 'preorder']::text[]
      );
  end if;
end $$;

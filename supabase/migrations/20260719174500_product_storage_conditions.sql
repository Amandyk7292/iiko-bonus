-- Configurable product storage conditions shown in the client catalog.

alter table public.menu_overrides
  add column if not exists storage_conditions jsonb not null default '[]'::jsonb;

alter table public.custom_products
  add column if not exists storage_conditions jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'menu_overrides_storage_conditions_check'
      and conrelid = 'public.menu_overrides'::regclass
  ) then
    alter table public.menu_overrides
      add constraint menu_overrides_storage_conditions_check check (
        jsonb_typeof(storage_conditions) = 'array'
        and jsonb_array_length(storage_conditions) <= 2
        and pg_column_size(storage_conditions) <= 4096
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'custom_products_storage_conditions_check'
      and conrelid = 'public.custom_products'::regclass
  ) then
    alter table public.custom_products
      add constraint custom_products_storage_conditions_check check (
        jsonb_typeof(storage_conditions) = 'array'
        and jsonb_array_length(storage_conditions) <= 2
        and pg_column_size(storage_conditions) <= 4096
      );
  end if;
end $$;


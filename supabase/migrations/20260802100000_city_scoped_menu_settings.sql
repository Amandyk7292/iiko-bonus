-- Keep menu overrides and manually created dishes inside the selected iiko city profile.

alter table public.menu_overrides
  add column if not exists iiko_profile text not null default 'default';

alter table public.menu_category_overrides
  add column if not exists iiko_profile text not null default 'default';

alter table public.custom_products
  add column if not exists iiko_profile text not null default 'default';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'menu_overrides_iiko_profile_check'
      and conrelid = 'public.menu_overrides'::regclass
  ) then
    alter table public.menu_overrides
      add constraint menu_overrides_iiko_profile_check
      check (iiko_profile ~ '^[a-z0-9_-]{1,64}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'menu_category_overrides_iiko_profile_check'
      and conrelid = 'public.menu_category_overrides'::regclass
  ) then
    alter table public.menu_category_overrides
      add constraint menu_category_overrides_iiko_profile_check
      check (iiko_profile ~ '^[a-z0-9_-]{1,64}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'custom_products_iiko_profile_check'
      and conrelid = 'public.custom_products'::regclass
  ) then
    alter table public.custom_products
      add constraint custom_products_iiko_profile_check
      check (iiko_profile ~ '^[a-z0-9_-]{1,64}$');
  end if;
end $$;

alter table public.menu_overrides
  drop constraint if exists menu_overrides_pkey;

alter table public.menu_overrides
  add constraint menu_overrides_pkey primary key (iiko_profile, iiko_product_id);

alter table public.menu_category_overrides
  drop constraint if exists menu_category_overrides_pkey;

alter table public.menu_category_overrides
  add constraint menu_category_overrides_pkey
  primary key (iiko_profile, iiko_category_id);

create index if not exists custom_products_iiko_profile_sort_idx
  on public.custom_products(iiko_profile, sort_order, id);

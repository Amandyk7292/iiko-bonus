-- Keep manually created dishes inside the iiko city profile where they were created.

alter table public.custom_products
  add column if not exists iiko_profile text not null default 'default';

do $$
begin
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

create index if not exists custom_products_iiko_profile_sort_idx
  on public.custom_products(iiko_profile, sort_order, id);

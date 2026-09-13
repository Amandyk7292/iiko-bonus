alter table public.custom_products add column if not exists name_translations jsonb;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.custom_products'::regclass
      and conname = 'custom_product_names_object'
  ) then
    alter table public.custom_products add constraint custom_product_names_object
      check (name_translations is null or jsonb_typeof(name_translations) = 'object');
  end if;
end;
$$;
notify pgrst, 'reload schema';

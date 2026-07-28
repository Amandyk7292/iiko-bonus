alter table public.kaspi_orders
  add column if not exists substitution_preference text not null default 'call_customer';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'kaspi_orders_substitution_preference_check'
       and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_substitution_preference_check
      check (
        substitution_preference in (
          'remove_refund',
          'call_customer',
          'replace_with_approval'
        )
      );
  end if;
end
$$;

comment on column public.kaspi_orders.substitution_preference is
  'Customer choice when an ordered item is unavailable.';

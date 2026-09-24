create table public.customer_saved_variants (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id text not null check (length(product_id) between 1 and 128),
  name text not null check (length(name) between 1 and 100),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration)='object' and octet_length(configuration::text)<=4096),
  modifiers jsonb not null default '[]'::jsonb check (jsonb_typeof(modifiers)='array' and octet_length(modifiers::text)<=4096),
  selection_key text not null check (length(selection_key)=64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id,selection_key)
);
create index customer_saved_variants_recent on public.customer_saved_variants(customer_id,updated_at desc);
alter table public.customer_saved_variants enable row level security;
revoke all on public.customer_saved_variants from public,anon,authenticated;
grant select,insert,update,delete on public.customer_saved_variants to service_role;
create policy customer_saved_variants_service on public.customer_saved_variants
  for all to service_role using (true) with check (true);

-- Account deletion already removes the parent customer; this also covers soft deletion.
create function public.clear_deleted_customer_saved_variants() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from public.customer_saved_variants where customer_id=new.id;
  return new;
end; $$;
create trigger clear_deleted_customer_saved_variants after update of deleted_at on public.customers
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.clear_deleted_customer_saved_variants();
revoke all on function public.clear_deleted_customer_saved_variants() from public,anon,authenticated;

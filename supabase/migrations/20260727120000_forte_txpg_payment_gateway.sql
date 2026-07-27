-- ForteBank TXPG returns a per-order password used by both the hosted payment
-- page and subsequent server-to-server operations. Only an AES-GCM envelope is
-- stored; the plaintext password is never persisted.
alter table public.kaspi_orders
  add column if not exists provider_auth_ciphertext text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kaspi_orders_provider_auth_ciphertext_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_provider_auth_ciphertext_check
      check (
        provider_auth_ciphertext is null
        or (
          char_length(provider_auth_ciphertext) between 40 and 2000
          and provider_auth_ciphertext like 'v1.%'
        )
      );
  end if;
end
$$;

comment on column public.kaspi_orders.provider_auth_ciphertext is
  'AES-256-GCM envelope of the ForteBank per-order password; plaintext is never stored';

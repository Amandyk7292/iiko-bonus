-- Forte E-commerce Widget v2 and customer-consented card token storage.
-- PAN/CVV are never accepted or stored by Bulka. Provider tokens are encrypted
-- by the application before they reach PostgreSQL.

alter table public.kaspi_orders
  add column if not exists provider_checkout_token_ciphertext text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kaspi_orders_provider_checkout_token_ciphertext_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_provider_checkout_token_ciphertext_check
      check (
        provider_checkout_token_ciphertext is null
        or (
          char_length(provider_checkout_token_ciphertext) between 40 and 2000
          and provider_checkout_token_ciphertext like 'v1.%'
        )
      );
  end if;
end
$$;

comment on column public.kaspi_orders.provider_checkout_token_ciphertext is
  'AES-256-GCM envelope of a short-lived Forte checkout token; never plaintext';

create table if not exists public.customer_payment_methods (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  provider varchar(32) not null,
  token_ciphertext text,
  token_fingerprint char(64) not null,
  brand varchar(30) not null default 'card',
  last_four char(4) not null,
  exp_month smallint,
  exp_year smallint,
  status varchar(16) not null default 'active',
  is_default boolean not null default false,
  consented_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_payment_methods_provider_check
    check (provider in ('forte_widget')),
  constraint customer_payment_methods_token_ciphertext_check
    check (
      (status = 'active' and token_ciphertext is not null
        and char_length(token_ciphertext) between 40 and 2000
        and token_ciphertext like 'v1.%')
      or
      (status <> 'active' and token_ciphertext is null)
    ),
  constraint customer_payment_methods_token_fingerprint_check
    check (token_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint customer_payment_methods_last_four_check
    check (last_four ~ '^[0-9]{4}$'),
  constraint customer_payment_methods_expiry_check
    check (
      (exp_month is null and exp_year is null)
      or (exp_month between 1 and 12 and exp_year between 2020 and 2200)
    ),
  constraint customer_payment_methods_status_check
    check (status in ('active', 'revoked', 'expired'))
);

create unique index if not exists customer_payment_methods_token_idx
  on public.customer_payment_methods(customer_id, provider, token_fingerprint);

create unique index if not exists customer_payment_methods_default_idx
  on public.customer_payment_methods(customer_id, provider)
  where is_default and status = 'active';

create index if not exists customer_payment_methods_customer_idx
  on public.customer_payment_methods(customer_id, status, created_at);

drop trigger if exists customer_payment_methods_set_updated_at
  on public.customer_payment_methods;
create trigger customer_payment_methods_set_updated_at
before update on public.customer_payment_methods
for each row execute function public.set_updated_at();

alter table public.customer_payment_methods enable row level security;
drop policy if exists service_role_all_customer_payment_methods
  on public.customer_payment_methods;
create policy service_role_all_customer_payment_methods
  on public.customer_payment_methods for all to service_role
  using (true) with check (true);

revoke all on table public.customer_payment_methods from public, anon, authenticated;
grant all on table public.customer_payment_methods to service_role;

comment on table public.customer_payment_methods is
  'Customer-consented provider tokens and display-only card metadata; no PAN or CVV';

create or replace function public.set_customer_payment_method_default(
  p_customer_id uuid,
  p_method_id uuid
)
returns public.customer_payment_methods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_method public.customer_payment_methods;
begin
  select *
  into v_method
  from public.customer_payment_methods
  where id = p_method_id
    and customer_id = p_customer_id
    and provider = 'forte_widget'
    and status = 'active'
  for update;

  if v_method.id is null then
    raise exception 'payment method not found';
  end if;

  update public.customer_payment_methods
  set is_default = false
  where customer_id = p_customer_id
    and provider = 'forte_widget'
    and status = 'active'
    and is_default;

  update public.customer_payment_methods
  set is_default = true
  where id = p_method_id
  returning * into v_method;

  return v_method;
end;
$$;

revoke all on function public.set_customer_payment_method_default(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.set_customer_payment_method_default(uuid, uuid)
  to service_role;

create table if not exists public.customer_payment_method_setups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  provider varchar(32) not null default 'forte_widget',
  checkout_token_ciphertext text,
  status varchar(16) not null default 'pending',
  provider_status varchar(60),
  provider_transaction_id varchar(100),
  payment_test boolean not null default false,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_payment_method_setups_provider_check
    check (provider = 'forte_widget'),
  constraint customer_payment_method_setups_token_check
    check (
      (
        status = 'pending'
        and char_length(checkout_token_ciphertext) between 40 and 2000
        and checkout_token_ciphertext like 'v1.%'
      )
      or (status <> 'pending' and checkout_token_ciphertext is null)
    ),
  constraint customer_payment_method_setups_status_check
    check (status in ('pending', 'paid', 'failed', 'expired'))
);

create index if not exists customer_payment_method_setups_customer_idx
  on public.customer_payment_method_setups(customer_id, created_at desc);

drop trigger if exists customer_payment_method_setups_set_updated_at
  on public.customer_payment_method_setups;
create trigger customer_payment_method_setups_set_updated_at
before update on public.customer_payment_method_setups
for each row execute function public.set_updated_at();

alter table public.customer_payment_method_setups enable row level security;
drop policy if exists service_role_all_customer_payment_method_setups
  on public.customer_payment_method_setups;
create policy service_role_all_customer_payment_method_setups
  on public.customer_payment_method_setups for all to service_role
  using (true) with check (true);

revoke all on table public.customer_payment_method_setups from public, anon, authenticated;
grant all on table public.customer_payment_method_setups to service_role;

comment on table public.customer_payment_method_setups is
  'Short-lived zero-amount Forte card-binding operations; checkout tokens are AES-GCM encrypted';

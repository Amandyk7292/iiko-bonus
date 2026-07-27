alter table public.kaspi_orders
  add column if not exists provider_transaction_id varchar(100),
  add column if not exists provider_status varchar(40),
  add column if not exists provider_redirect_url varchar(1000),
  add column if not exists provider_payment_system varchar(40),
  add column if not exists provider_card_first_six varchar(6),
  add column if not exists provider_card_last_four varchar(4),
  add column if not exists provider_authorization_code varchar(100),
  add column if not exists provider_settled_at timestamptz,
  add column if not exists payment_reconciled_at timestamptz,
  add column if not exists payment_test boolean,
  add column if not exists refund_request_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kaspi_orders_provider_card_first_six_check'
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_provider_card_first_six_check
      check (
        provider_card_first_six is null
        or provider_card_first_six ~ '^[0-9]{6}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'kaspi_orders_provider_card_last_four_check'
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_provider_card_last_four_check
      check (
        provider_card_last_four is null
        or provider_card_last_four ~ '^[0-9]{4}$'
      );
  end if;
end
$$;

create unique index if not exists kaspi_orders_forte_transaction_uid_idx
  on public.kaspi_orders(provider_transaction_id)
  where payment_method = 'forte_card' and provider_transaction_id is not null;

create index if not exists kaspi_orders_forte_reconciliation_idx
  on public.kaspi_orders(status, created_at)
  where payment_method = 'forte_card';

alter table public.payment_receipts
  add column if not exists language char(2) not null default 'ru';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payment_receipts_language_check'
  ) then
    alter table public.payment_receipts
      add constraint payment_receipts_language_check
      check (language in ('ru', 'kk', 'en'));
  end if;
end
$$;

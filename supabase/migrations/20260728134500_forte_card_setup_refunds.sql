-- Forte processing rejects zero-value oneclick setup payments for this shop.
-- Persist the 30 KZT verification payment and its immediate idempotent refund.

alter table public.customer_payment_method_setups
  add column if not exists amount numeric(12, 2) not null default 0,
  add column if not exists refund_status varchar(24) not null default 'not_required',
  add column if not exists refund_request_id uuid,
  add column if not exists refund_transaction_id varchar(100),
  add column if not exists refund_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_payment_method_setups_amount_check'
      and conrelid = 'public.customer_payment_method_setups'::regclass
  ) then
    alter table public.customer_payment_method_setups
      add constraint customer_payment_method_setups_amount_check
      check (amount >= 0 and amount <= 1000);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_payment_method_setups_refund_status_check'
      and conrelid = 'public.customer_payment_method_setups'::regclass
  ) then
    alter table public.customer_payment_method_setups
      add constraint customer_payment_method_setups_refund_status_check
      check (
        refund_status in (
          'not_required',
          'pending',
          'processing',
          'succeeded',
          'unknown',
          'failed'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_payment_method_setups_refund_transaction_check'
      and conrelid = 'public.customer_payment_method_setups'::regclass
  ) then
    alter table public.customer_payment_method_setups
      add constraint customer_payment_method_setups_refund_transaction_check
      check (
        refund_transaction_id is null
        or char_length(refund_transaction_id) between 8 and 100
      );
  end if;
end
$$;

create unique index if not exists customer_payment_method_setups_refund_request_idx
  on public.customer_payment_method_setups(refund_request_id)
  where refund_request_id is not null;

create index if not exists customer_payment_method_setups_refund_pending_idx
  on public.customer_payment_method_setups(created_at)
  where status = 'pending'
    and refund_status in ('pending', 'processing', 'unknown', 'failed');

comment on table public.customer_payment_method_setups is
  'Short-lived Forte card-binding payments with encrypted checkout tokens and auditable refunds';

comment on column public.customer_payment_method_setups.amount is
  'Verification payment amount in KZT; refunded immediately after successful card tokenization';

comment on column public.customer_payment_method_setups.refund_request_id is
  'Unique Forte RequestID used to make verification-payment refunds idempotent';

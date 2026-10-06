-- Closing a card-binding form revokes its reuse without asserting bank failure.
-- Pending/late bank outcomes still use the private encrypted token for reconciliation.
-- migration-safety: allow-destructive reason=replace-token-check-with-expanded-encrypted-reconciliation-rule-no-data-deletion
alter table public.customer_payment_method_setups
  add column if not exists cancel_requested_at timestamptz;

comment on column public.customer_payment_method_setups.cancel_requested_at is
  'Customer closed the binding form: never resume it; reconcile late bank/card/refund outcomes';

create index if not exists customer_payment_method_setups_closed_pending_idx
  on public.customer_payment_method_setups(created_at, id)
  where status = 'pending' and cancel_requested_at is not null;

alter table public.customer_payment_method_setups
  drop constraint if exists customer_payment_method_setups_token_check;
alter table public.customer_payment_method_setups
  add constraint customer_payment_method_setups_token_check
  check (
    (
      status <> 'paid'
      and checkout_token_ciphertext is not null
      and char_length(checkout_token_ciphertext) between 40 and 2000
      and (
        checkout_token_ciphertext like 'v1.%'
        or checkout_token_ciphertext like 'v2.%'
      )
    )
    or (status <> 'pending' and checkout_token_ciphertext is null)
  );

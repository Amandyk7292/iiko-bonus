-- Replace legacy Forte oneclick cards with customer-initiated card-on-file
-- tokens. oneclick deliberately asks for CVC/CVV on every purchase, while
-- recurring + card_on_file permits subsequent token payments without storing
-- or resubmitting CVC/CVV.

alter table public.customer_payment_methods
  add column if not exists token_contract varchar(32) not null default 'oneclick';

alter table public.customer_payment_methods
  drop constraint if exists customer_payment_methods_token_contract_check;
alter table public.customer_payment_methods
  add constraint customer_payment_methods_token_contract_check
  check (token_contract in ('oneclick', 'recurring_card_on_file'));

comment on column public.customer_payment_methods.token_contract is
  'Forte token usage contract. Only recurring_card_on_file tokens may be used for CVV-free repeat checkout.';

-- Keep the selected method on an order so a legacy oneclick token can be
-- replaced in place after the customer reconfirms the card once. Existing
-- cards remain visible and no encrypted token is discarded by this migration.
alter table public.kaspi_orders
  add column if not exists saved_payment_method_id uuid
  references public.customer_payment_methods(id) on delete set null;

create index if not exists kaspi_orders_saved_payment_method_idx
  on public.kaspi_orders(saved_payment_method_id)
  where saved_payment_method_id is not null;

comment on column public.kaspi_orders.saved_payment_method_id is
  'Saved Forte method selected by the customer; used to upgrade legacy oneclick tokens in place.';

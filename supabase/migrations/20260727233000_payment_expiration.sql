alter table public.kaspi_orders
  add column if not exists payment_expires_at timestamptz;

update public.kaspi_orders
set payment_expires_at = created_at + interval '30 minutes'
where provider_payment_system = 'forte_widget'
  and status = 'pending'
  and payment_expires_at is null;

create index if not exists kaspi_orders_pending_payment_expiration_idx
  on public.kaspi_orders(payment_expires_at)
  where status = 'pending' and payment_expires_at is not null;

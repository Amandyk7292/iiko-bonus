-- A cancelled fulfillment is not proof that reservation cleanup succeeded.
alter table public.kaspi_orders add column if not exists payment_cleanup_completed_at timestamptz;
create index if not exists kaspi_orders_unpaid_cleanup_idx on public.kaspi_orders(updated_at)
  where status in ('failed','expired') and fulfillment_status in ('pending','new','cancelled')
    and payment_cleanup_completed_at is null;

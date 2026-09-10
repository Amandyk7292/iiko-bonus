alter table public.kaspi_orders
  add column acceptance_timeout_at timestamptz,
  add column acceptance_timeout_retry_at timestamptz;
create index kaspi_orders_acceptance_timeout_due
  on public.kaspi_orders(staff_acceptance_requested_at)
  where status='paid' and fulfillment_status='new' and refund_status is null;
create index kaspi_orders_acceptance_timeout_retry
  on public.kaspi_orders(acceptance_timeout_retry_at)
  where status='paid' and acceptance_timeout_at is not null and refund_status='failed';

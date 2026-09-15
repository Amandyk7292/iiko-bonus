-- Bank confirmation must survive failures in the following independent,
-- idempotent gift-certificate, loyalty and inventory operations.
alter table public.kaspi_orders
  add column refund_followup_pending boolean not null default false;
create index kaspi_orders_refund_followup_pending_idx on public.kaspi_orders(updated_at)
  where status='refunded' and refund_status='succeeded' and refund_followup_pending;

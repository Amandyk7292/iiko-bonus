-- Persist the one-tap pickup arrival signal so kitchen/admin clients can
-- recover it after reconnecting instead of relying on a transient event.
alter table public.kaspi_orders
  add column if not exists customer_arrived_at timestamptz;

create index if not exists kaspi_orders_customer_arrived_idx
  on public.kaspi_orders (branch_id, customer_arrived_at desc)
  where customer_arrived_at is not null
    and fulfillment_status not in ('completed', 'cancelled');

comment on column public.kaspi_orders.customer_arrived_at is
  'When the authenticated customer tapped I have arrived for a ready pickup order.';

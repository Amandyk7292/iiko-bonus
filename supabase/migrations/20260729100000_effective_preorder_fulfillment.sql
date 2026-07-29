-- Preserve how a scheduled preorder will actually be handed to the customer.
-- `fulfillment_type` remains `preorder` for scheduling semantics, while this
-- column drives delivery/pickup capacity, ETA, courier dispatch and customer UI.

alter table public.kaspi_orders
  add column if not exists preorder_fulfillment_type varchar(16);

update public.kaspi_orders
set preorder_fulfillment_type = case
  when delivery_address is not null
    or delivery_latitude is not null
    or delivery_longitude is not null
    then 'delivery'
  else 'pickup'
end
where fulfillment_type = 'preorder'
  and preorder_fulfillment_type is null;

update public.fulfillment_slot_reservations slot
set
  fulfillment_type = order_row.preorder_fulfillment_type,
  updated_at = now()
from public.kaspi_orders order_row
where slot.order_id = order_row.id
  and order_row.fulfillment_type = 'preorder'
  and slot.fulfillment_type = 'preorder'
  and slot.status in ('active', 'committed');

alter table public.kaspi_orders
  drop constraint if exists kaspi_orders_preorder_fulfillment_type_check;

alter table public.kaspi_orders
  add constraint kaspi_orders_preorder_fulfillment_type_check
  check (
    (fulfillment_type = 'preorder' and preorder_fulfillment_type in ('pickup', 'delivery'))
    or (fulfillment_type <> 'preorder' and preorder_fulfillment_type is null)
  );

create index if not exists kaspi_orders_preorder_delivery_dispatch_idx
  on public.kaspi_orders(branch_id, scheduled_at)
  where fulfillment_type = 'preorder'
    and preorder_fulfillment_type = 'delivery'
    and fulfillment_status not in ('completed', 'cancelled');

comment on column public.kaspi_orders.preorder_fulfillment_type is
  'Actual handoff for a scheduled preorder: pickup or delivery.';

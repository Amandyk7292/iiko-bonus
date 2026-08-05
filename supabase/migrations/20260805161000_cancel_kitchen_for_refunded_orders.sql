begin;

update public.kaspi_orders
set
  fulfillment_status = 'cancelled',
  kitchen_status = 'cancelled',
  fulfilled_at = null,
  updated_at = now()
where status = 'refunded'
  and refund_status = 'succeeded'
  and (
    fulfillment_status is distinct from 'cancelled'
    or kitchen_status is distinct from 'cancelled'
    or fulfilled_at is not null
  );

commit;

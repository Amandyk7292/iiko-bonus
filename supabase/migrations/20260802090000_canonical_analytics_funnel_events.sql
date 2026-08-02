-- Canonical funnel names are used by the admin UI and all new event writes.
-- Legacy mobile clients are normalized by the API before insertion.
begin;

alter table public.customer_app_events
  drop constraint if exists customer_app_events_type_check;

update public.customer_app_events
set event_type = 'checkout_started'
where event_type = 'checkout_start';

update public.customer_app_events
set event_type = 'payment_started'
where event_type = 'payment_created';

alter table public.customer_app_events
  add constraint customer_app_events_type_check check (
    event_type in (
      'app_open', 'catalog_view', 'product_view', 'add_to_cart', 'remove_from_cart',
      'checkout_started', 'checkout_quote', 'payment_started', 'payment_paid',
      'payment_failed', 'payment_cancelled',
      'search', 'promotion_view'
    )
  );

create unique index if not exists customer_app_events_order_milestone_v2_idx
  on public.customer_app_events(event_type, order_id)
  where order_id is not null and event_type in ('payment_started', 'payment_paid');

commit;

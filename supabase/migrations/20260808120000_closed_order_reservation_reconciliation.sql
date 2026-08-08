-- Recover inventory and fulfillment capacity when an application process stops
-- after closing an order but before its best-effort reservation release finishes.

create index if not exists inventory_reservations_open_order_reconcile_idx
  on public.inventory_reservations(updated_at, order_id)
  where order_id is not null and status in ('active', 'committed');

create index if not exists fulfillment_slot_reservations_open_order_reconcile_idx
  on public.fulfillment_slot_reservations(updated_at, order_id)
  where order_id is not null and status in ('active', 'committed');

create or replace function public.reconcile_closed_order_reservations(
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate record;
  safe_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  payment_status text;
  fulfillment_status text;
  cancellation_reason text;
  order_updated_at timestamptz;
  inventory_released integer := 0;
  slots_released integer := 0;
  total_inventory_released integer := 0;
  total_slots_released integer := 0;
  released_in_order integer := 0;
  candidates_checked integer := 0;
  orders_released integer := 0;
begin
  for candidate in
    select held.order_id, min(held.updated_at) as oldest_updated_at
    from (
      select order_id, updated_at
      from public.inventory_reservations
      where order_id is not null and status in ('active', 'committed')

      union all

      select order_id, updated_at
      from public.fulfillment_slot_reservations
      where order_id is not null and status in ('active', 'committed')
    ) as held
    inner join public.kaspi_orders as orders on orders.id = held.order_id
    where
      orders.fulfillment_status = 'completed'
      or orders.status in ('refunded', 'failed', 'expired')
      or (
        orders.fulfillment_status = 'cancelled'
        and not (
          coalesce(orders.status, '') = 'paid'
          and coalesce(orders.cancellation_reason, '') in ('Срок оплаты истёк', 'Оплата не прошла')
          and coalesce(orders.updated_at, '-infinity'::timestamptz)
            > now() - interval '5 minutes'
        )
      )
    group by held.order_id
    order by min(held.updated_at), held.order_id
    limit safe_limit
  loop
    -- commit_order_reservations uses the same lock. This prevents a cleanup
    -- from racing a late payment that is reacquiring released capacity.
    perform pg_advisory_xact_lock(hashtextextended(candidate.order_id::text, 0));

    select
      orders.status,
      orders.fulfillment_status,
      orders.cancellation_reason,
      orders.updated_at
    into payment_status, fulfillment_status, cancellation_reason, order_updated_at
    from public.kaspi_orders as orders
    where orders.id = candidate.order_id
    for update;

    if not found then
      continue;
    end if;

    -- Re-check after locking because the order may have reopened after the
    -- candidate scan. Paid late-payment cleanup rows are intentionally not
    -- terminal while recordPaidOrder may still reacquire and reopen them. If
    -- that process stops after reacquiring, the short grace expires and the
    -- next worker run releases the abandoned capacity.
    if (
      fulfillment_status = 'completed'
      or payment_status in ('refunded', 'failed', 'expired')
      or (
        fulfillment_status = 'cancelled'
        and not (
          coalesce(payment_status, '') = 'paid'
          and coalesce(cancellation_reason, '') in ('Срок оплаты истёк', 'Оплата не прошла')
          and coalesce(order_updated_at, '-infinity'::timestamptz)
            > now() - interval '5 minutes'
        )
      )
    ) is not true then
      continue;
    end if;

    candidates_checked := candidates_checked + 1;
    released_in_order := 0;

    update public.inventory_reservations
    set status = 'released', updated_at = now()
    where order_id = candidate.order_id and status in ('active', 'committed');
    get diagnostics inventory_released = row_count;
    total_inventory_released := total_inventory_released + inventory_released;
    released_in_order := released_in_order + inventory_released;

    update public.fulfillment_slot_reservations
    set status = 'released', updated_at = now()
    where order_id = candidate.order_id and status in ('active', 'committed');
    get diagnostics slots_released = row_count;
    total_slots_released := total_slots_released + slots_released;
    released_in_order := released_in_order + slots_released;

    if released_in_order > 0 then
      orders_released := orders_released + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'candidates', candidates_checked,
    'ordersReleased', orders_released,
    'inventoryReservationsReleased', total_inventory_released,
    'slotReservationsReleased', total_slots_released
  );
end;
$$;

revoke all on function public.reconcile_closed_order_reservations(integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_closed_order_reservations(integer) to service_role;

comment on function public.reconcile_closed_order_reservations(integer) is
  'Idempotently releases active or committed capacity held by terminal orders.';

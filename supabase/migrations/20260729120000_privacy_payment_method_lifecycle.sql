-- Extend privacy deletion to data introduced after the original lifecycle RPC.
-- The wrapper keeps the whole anonymisation and token deletion in one database
-- transaction: any failure rolls every step back.

create or replace function public.ensure_order_customer_is_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_at timestamptz;
begin
  if new.customer_id is null then return new; end if;

  select deleted_at
  into v_deleted_at
  from public.customers
  where id = new.customer_id
  for key share;

  if not found or v_deleted_at is not null then
    raise exception 'customer account is unavailable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists kaspi_orders_active_customer_insert on public.kaspi_orders;
create trigger kaspi_orders_active_customer_insert
before insert on public.kaspi_orders
for each row execute function public.ensure_order_customer_is_active();

drop trigger if exists kaspi_orders_active_customer_update on public.kaspi_orders;
create trigger kaspi_orders_active_customer_update
before update of customer_id on public.kaspi_orders
for each row
when (new.customer_id is distinct from old.customer_id)
execute function public.ensure_order_customer_is_active();

create or replace function public.delete_customer_personal_data_complete(
  p_customer_id uuid,
  p_deleted_phone text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- Serialise privacy deletion with the order trigger above. If checkout
  -- inserted first, the active-order check sees it; if deletion locked first,
  -- checkout waits and then rejects the anonymised customer.
  perform 1
  from public.customers
  where id = p_customer_id
  for update;

  if exists (
    select 1
    from public.kaspi_orders
    where customer_id = p_customer_id
      and (
        status = 'pending'
        or (
          status = 'paid'
          and coalesce(fulfillment_status, 'pending') not in ('completed', 'cancelled')
        )
        or coalesce(refund_status, '') in ('processing', 'unknown')
      )
  ) then
    raise exception 'customer has active orders or unsettled refunds'
      using errcode = 'P0001';
  end if;

  v_result := public.delete_customer_personal_data(
    p_customer_id,
    p_deleted_phone,
    p_request_id
  );

  delete from public.customer_payment_method_setups
  where customer_id = p_customer_id;

  delete from public.customer_payment_methods
  where customer_id = p_customer_id;

  delete from public.promotion_reservations
  where customer_id = p_customer_id;

  return v_result;
end;
$$;

revoke all on function public.delete_customer_personal_data_complete(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.ensure_order_customer_is_active()
  from public, anon, authenticated;
grant execute on function public.delete_customer_personal_data_complete(uuid, text, uuid)
  to service_role;

comment on function public.delete_customer_personal_data_complete(uuid, text, uuid) is
  'Atomically anonymises the customer and removes encrypted Forte tokens and active promo reservations.';

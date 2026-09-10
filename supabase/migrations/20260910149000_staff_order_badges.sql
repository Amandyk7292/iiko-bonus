-- Aggregate over all paid active orders, independently of kitchen page size.
create index if not exists kaspi_orders_staff_badges_idx
  on public.kaspi_orders(branch_id,fulfillment_status,kitchen_status,fulfillment_type)
  where status='paid' and fulfillment_status in ('new','accepted','preparing');
create function public.staff_order_counts(p_branches uuid[] default null)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'newOrders', count(*) filter(where fulfillment_status='new' and kitchen_status='queued'),
    'preparing', count(*) filter(where fulfillment_status in ('accepted','preparing') and kitchen_status in ('queued','preparing')),
    'preorders', count(*) filter(where fulfillment_status='new' and kitchen_status='queued' and fulfillment_type='preorder')
  ) from kaspi_orders
  where status='paid' and fulfillment_status in ('new','accepted','preparing')
    and coalesce(refund_status,'') not in ('processing','unknown','succeeded')
    and (p_branches is null or branch_id=any(p_branches));
$$;
revoke all on function public.staff_order_counts(uuid[]) from public,anon,authenticated;
grant execute on function public.staff_order_counts(uuid[]) to service_role;

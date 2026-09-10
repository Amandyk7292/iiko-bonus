-- A new order must alert even when another order was accepted between polls
-- and the pending count and oldest order have stayed the same.
create or replace function public.poll_front_order_board(p_branch uuid, p_terminal uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inbox jsonb; v_revision text; v_newest bigint;
begin
  v_inbox := public.poll_front_order_inbox(p_branch, p_terminal);
  select md5(coalesce(string_agg(
    o.id::text || ':' || coalesce(o.updated_at::text, '') || ':' ||
    coalesce(o.fulfillment_status, '') || ':' || coalesce(o.kitchen_status, '') || ':' || o.pos_receipt_due::text || ':' ||
    coalesce(j.changed::text, ''), ',' order by o.id), '')),
    coalesce(max(o.order_number) filter (where o.fulfillment_status='new'),0)
    into v_revision, v_newest
  from public.kaspi_orders o
  left join lateral (
    select max(d.updated_at) as changed from public.delivery_jobs d where d.order_id=o.id
  ) j on true
  where o.branch_id=p_branch and o.status='paid' and o.refund_status is null
    and ((o.fulfillment_status in ('new','preparing','ready') and o.kitchen_status is distinct from 'handed_over')
      or coalesce(o.handed_to_courier_at,o.fulfilled_at)>=now()-interval '24 hours'
      or o.pos_receipt_due);
  return v_inbox || jsonb_build_object('revision',v_revision,'newestOrderNumber',v_newest);
end;
$$;
revoke all on function public.poll_front_order_board(uuid,uuid) from public, anon, authenticated;
grant execute on function public.poll_front_order_board(uuid,uuid) to service_role;

-- A register must always see its own claimed jobs during the final pre-print
-- state check, independently of the bounded page of waiting photos.
create or replace function public.list_pickup_photo_print_jobs(p_branch uuid,p_terminal uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare jobs jsonb;
begin
  if not exists(select 1 from pos_devices where branch_id=p_branch and terminal_id=p_terminal and active) then
    return jsonb_build_object('error','terminal_unavailable'); end if;
  with eligible as (
    select p.order_id,p.status,p.terminal_id,p.updated_at,o.order_number,o.pickup_photo_id
    from pickup_photo_print_jobs p join kaspi_orders o on o.id=p.order_id join pickup_photo_uploads f on f.id=o.pickup_photo_id
    where p.branch_id=p_branch and p.status in('pending','printing','uncertain')
      and (p.terminal_id=p_terminal or (p.status='pending' and p.terminal_id is null))
      and o.status='paid' and o.fulfillment_type in('pickup','preorder') and o.kitchen_status in('preparing','ready')
      and (o.fulfillment_type<>'preorder' or coalesce(o.preorder_fulfillment_type,'pickup')='pickup')
      and coalesce(o.refund_status,'') in('','partial','failed') and o.fulfillment_status not in('cancelled','rejected')
      and (p.status in('printing','uncertain') or (f.deleted_at is null and f.image_base64 is not null and f.expires_at>now()))
  ), selected as (
    select * from eligible
    -- Keep the existing plugin's20-row protocol. Its most recent printing
    -- claim must survive a pending backlog and older uncertain local journals.
    order by case status when 'printing' then 0 when 'pending' then 1 else 2 end,
      case when status='printing' then updated_at end desc,updated_at,order_id limit 20
  )
  select coalesce(jsonb_agg(jsonb_build_object('orderId',order_id,'number',order_number,
    'status',status,'photoId',pickup_photo_id) order by case status when 'printing' then 0 when 'pending' then 1 else 2 end,
      case when status='printing' then updated_at end desc,updated_at,order_id),'[]'::jsonb)
    into jobs from selected;
  return jsonb_build_object('jobs',jobs);
end; $$;

-- New photo printing must start while the pickup order is still in preparation.
-- Keep acknowledgements separate: a physically printed strip may be confirmed
-- after handover without exposing its image or allowing another print.
create or replace function public.pickup_photo_print_image(p_branch uuid,p_terminal uuid,p_order uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target kaspi_orders%rowtype; job pickup_photo_print_jobs%rowtype; photo pickup_photo_uploads%rowtype;
begin
  if not exists(select 1 from pos_devices where branch_id=p_branch and terminal_id=p_terminal and active) then return jsonb_build_object('error','terminal_unavailable'); end if;
  select * into target from kaspi_orders where id=p_order and branch_id=p_branch;
  select * into job from pickup_photo_print_jobs where order_id=p_order and branch_id=p_branch;
  if target.status is distinct from 'paid' or target.fulfillment_type not in('pickup','preorder')
    or (target.fulfillment_type='preorder' and coalesce(target.preorder_fulfillment_type,'pickup')<>'pickup')
    or coalesce(target.refund_status,'') not in('','partial','failed') or target.fulfillment_status in('cancelled','rejected')
    or coalesce(target.kitchen_status,'') not in('preparing','ready')
    or job.terminal_id is distinct from p_terminal or job.status<>'printing' then return jsonb_build_object('error','job_unavailable'); end if;
  select * into photo from pickup_photo_uploads where id=target.pickup_photo_id and customer_id=target.customer_id;
  if photo.image_base64 is null or photo.deleted_at is not null or photo.expires_at<=now() then return jsonb_build_object('error','photo_unavailable'); end if;
  return jsonb_build_object('image',photo.image_base64,'number',target.order_number);
end;
$$;
revoke all on function public.pickup_photo_print_image(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pickup_photo_print_image(uuid,uuid,uuid) to service_role;

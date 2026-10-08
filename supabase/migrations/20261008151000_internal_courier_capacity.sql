-- Manual and automatic assignments consume the same globally counted capacity.
-- Serialize on courier first, then re-read the order under its row lock. Existing
-- provider/receipt triggers still guard the final order update.
create function public.assign_internal_courier(
  p_order uuid,p_courier uuid,p_eta timestamptz,p_pin text,p_branch_ids uuid[] default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.couriers%rowtype; o public.kaspi_orders%rowtype; workload integer;
begin
  select * into c from public.couriers where id=p_courier for update;
  if c.id is null or not coalesce(c.active,false) or c.transport_type is distinct from 'car'
    or coalesce(c.availability_status,'offline')<>'available' then
    raise exception 'COURIER_UNAVAILABLE' using errcode='P0001';
  end if;
  select * into o from public.kaspi_orders where id=p_order for update;
  if o.id is null or (coalesce(cardinality(p_branch_ids),0)>0 and not coalesce(o.branch_id=any(p_branch_ids),false))
    or o.status is distinct from 'paid' or o.fulfillment_type is distinct from 'delivery'
    or coalesce(o.fulfillment_status,'') in ('completed','cancelled')
    or o.courier_id is not null or o.delivery_status is distinct from 'unassigned'
    or o.courier_dispatch_status='awaiting_receipt'
    or (o.courier_dispatch_requested_at is null and coalesce(o.kitchen_status,'queued') not in ('preparing','ready','handed_over'))
    or (o.courier_dispatch_provider='yandex' and coalesce(o.courier_dispatch_status,'') not in ('pending','retrying','awaiting_confirmation','failed')) then
    return null;
  end if;
  select count(*) into workload from public.kaspi_orders
    where courier_id=p_courier and status='paid' and fulfillment_type='delivery'
      and coalesce(delivery_status,'unassigned') not in ('delivered','cancelled')
      and coalesce(fulfillment_status,'') not in ('completed','cancelled');
  if workload>=coalesce(c.max_active_orders,3) then
    raise exception 'COURIER_CAPACITY_REACHED' using errcode='P0001';
  end if;
  update public.kaspi_orders set courier_id=p_courier,delivery_status='assigned',delivery_pin=p_pin,
    delivery_confirmed_at=null,courier_assigned_at=now(),estimated_delivery_at=p_eta,updated_at=now()
    where id=p_order returning * into o;
  update public.couriers set last_assigned_at=now() where id=p_courier;
  return to_jsonb(o)||jsonb_build_object('couriers',jsonb_build_object(
    'id',c.id,'name',c.name,'phone',c.phone,'vehicle',c.vehicle,'transport_type',c.transport_type,
    'current_latitude',c.current_latitude,'current_longitude',c.current_longitude,'location_updated_at',c.location_updated_at));
end; $$;
revoke all on function public.assign_internal_courier(uuid,uuid,timestamptz,text,uuid[]) from public,anon,authenticated;
grant execute on function public.assign_internal_courier(uuid,uuid,timestamptz,text,uuid[]) to service_role;

-- Preorders are branch pickup only. No historical orders are rewritten.
alter table public.kaspi_orders add constraint kaspi_orders_preorder_pickup_only
  check (fulfillment_type <> 'preorder' or coalesce(preorder_fulfillment_type, 'pickup') = 'pickup');

-- migration-safety: allow-destructive reason=expand dispatch status check with a non-error waiting-for-receipt state; preserve all existing statuses and orders
alter table public.kaspi_orders drop constraint if exists kaspi_orders_courier_dispatch_status_check;
alter table public.kaspi_orders add constraint kaspi_orders_courier_dispatch_status_check
  check (courier_dispatch_status is null or courier_dispatch_status in
    ('pending','processing','retrying','awaiting_confirmation','awaiting_receipt','succeeded','failed'));

create function public.front_delivery_receipt_ready(p_branch uuid, p_order uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from front_stock_policies where branch_id=p_branch and enabled)
    or exists(select 1 from front_stock_sales where branch_id=p_branch and online_order_id=p_order and status='closed');
$$;

create function public.hold_delivery_until_receipt() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare ready boolean;
begin
  if new.fulfillment_type='preorder' then
    if new.courier_id is not null or new.courier_dispatch_requested_at is not null then
      raise exception 'Предзаказ можно забрать только в выбранном филиале' using errcode='P0001';
    end if;
    return new;
  end if;
  if new.fulfillment_type<>'delivery' then return new; end if;
  ready := public.front_delivery_receipt_ready(new.branch_id,new.id);
  if not ready and new.courier_id is not null and (tg_op='INSERT' or new.courier_id is distinct from old.courier_id) then
    raise exception 'Вызов курьера ожидает подтверждения кассового чека' using errcode='P0001';
  end if;
  if not ready and new.status='paid' and new.fulfillment_status not in ('cancelled','completed')
    and new.courier_id is null and new.courier_dispatch_completed_at is null
    and new.courier_dispatch_requested_at is not null
    and new.courier_dispatch_status in ('pending','processing','retrying','awaiting_confirmation','awaiting_receipt') then
    new.courier_dispatch_status := 'awaiting_receipt';
    new.courier_dispatch_next_attempt_at := null;
    new.courier_dispatch_error := null;
  end if;
  return new;
end;
$$;
create trigger hold_delivery_until_receipt before insert or update on public.kaspi_orders
  for each row execute function public.hold_delivery_until_receipt();

create function public.dispatch_after_front_receipt() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='closed' and old.status is distinct from new.status and new.online_order_id is not null then
    update public.kaspi_orders set courier_dispatch_status='pending',
      courier_dispatch_next_attempt_at=now(),courier_dispatch_error=null,updated_at=now()
    where id=new.online_order_id and branch_id=new.branch_id and fulfillment_type='delivery'
      and status='paid' and fulfillment_status in ('preparing','ready')
      and refund_status is null and courier_id is null
      and courier_dispatch_status='awaiting_receipt' and courier_dispatch_completed_at is null;
  end if;
  return new;
end;
$$;
create trigger dispatch_after_front_receipt after update on public.front_stock_sales
  for each row execute function public.dispatch_after_front_receipt();

-- Both provider adapters persist a job before making an external request.
-- Reject direct/manual dispatch too; quotes during customer checkout use no job.
create function public.protect_delivery_job_receipt() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare payment_order public.kaspi_orders%rowtype;
begin
  select * into payment_order from public.kaspi_orders where id=new.order_id for update;
  if payment_order.fulfillment_type='preorder' then
    raise exception 'Предзаказ можно забрать только в выбранном филиале' using errcode='P0001';
  end if;
  if not public.front_delivery_receipt_ready(payment_order.branch_id,payment_order.id) then
    raise exception 'Вызов курьера ожидает подтверждения кассового чека' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger protect_delivery_job_receipt before insert or update of order_id on public.delivery_jobs
  for each row execute function public.protect_delivery_job_receipt();

revoke all on function public.front_delivery_receipt_ready(uuid,uuid),public.hold_delivery_until_receipt(),
  public.dispatch_after_front_receipt(),public.protect_delivery_job_receipt() from public,anon,authenticated;
grant execute on function public.front_delivery_receipt_ready(uuid,uuid) to service_role;

-- One durable receipt owner per online order. Ownership never expires after a
-- register starts creating a receipt: a lost response must not create a second sale.
create table public.front_receipt_jobs (
  order_id uuid primary key references public.kaspi_orders(id),
  branch_id uuid not null references public.bulka_locations(id),
  terminal_id uuid, receipt_id uuid, expected_items jsonb, expected_total numeric,
  status text not null default 'pending' check(status in ('pending','assigned','completed')),
  last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(branch_id,receipt_id)
);
alter table public.front_receipt_jobs enable row level security;
revoke all on public.front_receipt_jobs from public,anon,authenticated;
grant all on public.front_receipt_jobs to service_role;
create index front_receipt_jobs_pending on public.front_receipt_jobs(branch_id,created_at) where status<>'completed';

-- In strict stock mode an assembled paid order can be handed over before its
-- automatic receipt closes. Settlement keeps the original goods reservation
-- accounted for, including when a tablet is used while a register is down.
create function public.settle_automatic_front_order() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='paid' and new.refund_status is null and new.kitchen_status='ready'
    and old.kitchen_status is distinct from new.kitchen_status
    and exists(select 1 from pos_devices where branch_id=new.branch_id and active)
    and exists(select 1 from front_stock_policies where branch_id=new.branch_id and enabled and not paused and control_mode='front')
    and not exists(select 1 from front_stock_sales where online_order_id=new.id and status='closed') then
    perform settle_front_online_stock(new.id,'front',coalesce(current_setting('bulka.staff_actor',true),'staff'));
    new.pos_receipt_due:=true;
  end if;
  return new;
end;
$$;
create trigger ab_settle_automatic_front_order before update on public.kaspi_orders
  for each row execute function public.settle_automatic_front_order();
create or replace function public.front_delivery_receipt_ready(p_branch uuid,p_order uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from front_stock_policies where branch_id=p_branch and enabled)
    or exists(select 1 from front_stock_sales where branch_id=p_branch and online_order_id=p_order and status='closed')
    or exists(select 1 from front_online_stock_settlements where branch_id=p_branch and order_id=p_order);
$$;

create function public.queue_front_receipt() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare linked front_stock_sales%rowtype; expected jsonb;
begin
  if new.status='paid' and new.refund_status is null
    and (new.kitchen_status='handed_over' and old.kitchen_status is distinct from new.kitchen_status
      or new.fulfillment_status='completed' and old.fulfillment_status is distinct from new.fulfillment_status)
    and exists(select 1 from pos_devices where branch_id=new.branch_id and active) then
    select * into linked from front_stock_sales where online_order_id=new.id and status<>'voided';
    if linked.status='closed' then return new; end if;
    select jsonb_object_agg(product_id,q) into expected from (
      select product_id,sum(quantity)::numeric q from inventory_reservations where order_id=new.id group by product_id
    ) x;
    insert into front_receipt_jobs(order_id,branch_id,terminal_id,receipt_id,expected_items,expected_total,status)
      values(new.id,new.branch_id,linked.terminal_id,linked.receipt_id,expected,
        greatest(0,new.subtotal-coalesce(new.discount_amount,0)-coalesce(new.bonus_spent,0)),
        case when linked.receipt_id is null then 'pending' else 'assigned' end)
      on conflict(order_id) do nothing;
    new.pos_receipt_due:=true;
  end if;
  return new;
end;
$$;
create trigger zz_queue_front_receipt before update on public.kaspi_orders
  for each row execute function public.queue_front_receipt();

create function public.front_receipt_job_action(p_branch uuid,p_terminal uuid,p_order uuid,p_action text,
  p_receipt uuid default null,p_items jsonb default null,p_total numeric default null,p_error text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job front_receipt_jobs%rowtype; target kaspi_orders%rowtype; expected jsonb; result jsonb;
begin
  perform id from bulka_locations where id=p_branch and active for update;
  if not found or not exists(select 1 from pos_devices where branch_id=p_branch and terminal_id=p_terminal and active) then
    raise exception 'Касса не привязана к филиалу' using errcode='P0001';
  end if;
  select * into target from kaspi_orders where id=p_order and branch_id=p_branch for update;
  select * into job from front_receipt_jobs where order_id=p_order and branch_id=p_branch for update;
  if job.order_id is null then raise exception 'Нет задания на кассовый чек' using errcode='P0001'; end if;
  if job.terminal_id is not null and job.terminal_id<>p_terminal then
    raise exception 'Этот чек уже выполняется другой кассой' using errcode='P0001';
  end if;
  if p_action='problem' and (job.terminal_id=p_terminal or job.terminal_id is null) then
    update front_receipt_jobs set last_error=left(p_error,400),updated_at=now() where order_id=p_order and status<>'completed';
    return jsonb_build_object('status',job.status);
  end if;
  if p_action='return' then
    if job.status<>'completed' or job.receipt_id is distinct from p_receipt or target.refund_status is distinct from 'succeeded' then
      raise exception 'Сначала оформите и завершите возврат в Bulka' using errcode='P0001';
    end if;
    if job.expected_items is null or job.expected_items is distinct from p_items or job.expected_total is distinct from p_total then
      raise exception 'Состав или сумма возврата не совпадает с исходным чеком Bulka' using errcode='P0001';
    end if;
    return jsonb_build_object('status','refunded','number',target.order_number);
  end if;
  if target.status<>'paid' or target.refund_status is not null or coalesce(target.partially_refunded_amount,0)>0 then
    raise exception 'Оплата заказа не подтверждена либо выполняется возврат' using errcode='P0001';
  end if;
  if p_action='claim' then
    update front_receipt_jobs set terminal_id=p_terminal,status=case when status='completed' then status else 'assigned' end,
      updated_at=now() where order_id=p_order returning * into job;
    return jsonb_build_object('status',job.status,'receiptId',job.receipt_id,'number',target.order_number);
  end if;
  if job.terminal_id is distinct from p_terminal or p_receipt is null then
    raise exception 'Сначала закрепите чек за кассой' using errcode='P0001';
  end if;
  if p_action='bind' then
    if job.receipt_id is not null and job.receipt_id<>p_receipt then
      raise exception 'Заказ уже связан с другим чеком' using errcode='P0001';
    end if;
    if exists(select 1 from front_stock_sales where online_order_id=p_order and status<>'voided' and receipt_id<>p_receipt) then
      raise exception 'Онлайн-заказ уже пробивается в другом чеке' using errcode='P0001';
    end if;
    update front_receipt_jobs set receipt_id=p_receipt,updated_at=now() where order_id=p_order;
    return jsonb_build_object('status',job.status,'receiptId',p_receipt);
  end if;
  if job.receipt_id is distinct from p_receipt then raise exception 'Чек не связан с заказом' using errcode='P0001'; end if;
  expected:=job.expected_items;
  if expected is null or expected is distinct from p_items
    or p_total is distinct from job.expected_total
    or p_total is distinct from greatest(0,target.subtotal-coalesce(target.discount_amount,0)-coalesce(target.bonus_spent,0)) then
    raise exception 'Состав или сумма чека не совпадает с оплаченным заказом Bulka' using errcode='P0001';
  end if;
  if p_action='verify' then
    if job.status='completed' then raise exception 'Чек уже закрыт. Повторная оплата запрещена' using errcode='P0001'; end if;
    return jsonb_build_object('status','verified','number',target.order_number);
  elsif p_action='complete' then
    update front_receipt_jobs set status='completed',last_error=null,updated_at=now() where order_id=p_order;
    update kaspi_orders set pos_receipt_due=false where id=p_order;
    return jsonb_build_object('status','completed','number',target.order_number);
  end if;
  raise exception 'Неизвестное действие чека' using errcode='22023';
end;
$$;

-- Also prevent the older manual linking flow from claiming a receipt already
-- owned by the new automatic flow on another register.
create function public.protect_automatic_front_receipt() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.online_order_id is not null and exists(select 1 from front_receipt_jobs where order_id=new.online_order_id
    and (receipt_id is distinct from new.receipt_id or terminal_id is distinct from new.terminal_id)) then
    raise exception 'Онлайн-заказ уже закреплён для автоматического чека' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger protect_automatic_front_receipt before insert or update on public.front_stock_sales
  for each row execute function public.protect_automatic_front_receipt();
create function public.refresh_front_receipt_card() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.last_error is distinct from old.last_error or new.status is distinct from old.status
    or new.receipt_id is distinct from old.receipt_id then
    update kaspi_orders set updated_at=now() where id=new.order_id;
  end if;
  return new;
end;
$$;
create trigger refresh_front_receipt_card after update on public.front_receipt_jobs
  for each row execute function public.refresh_front_receipt_card();
revoke all on function public.queue_front_receipt(),public.settle_automatic_front_order(),public.protect_automatic_front_receipt(),
  public.refresh_front_receipt_card(),public.front_receipt_job_action(uuid,uuid,uuid,text,uuid,jsonb,numeric,text) from public,anon,authenticated;
grant execute on function public.front_receipt_job_action(uuid,uuid,uuid,text,uuid,jsonb,numeric,text) to service_role;

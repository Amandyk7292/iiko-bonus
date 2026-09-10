-- A tablet in the explicitly selected fallback mode may assemble and hand over
-- paid goods. The POS receipt remains due; assembly consumes stock exactly once.
alter table public.kaspi_orders add column tablet_ready_at timestamptz,
  add column tablet_ready_by text, add column pos_receipt_due boolean not null default false;
create index kaspi_orders_receipts_due on public.kaspi_orders(branch_id,created_at) where pos_receipt_due;
create table public.front_online_stock_settlements(
  order_id uuid primary key references kaspi_orders(id), branch_id uuid not null references bulka_locations(id),
  items jsonb not null, origin text not null check(origin in ('front','tablet')),
  actor text not null, created_at timestamptz not null default now()
);
alter table public.front_online_stock_settlements enable row level security;
revoke all on public.front_online_stock_settlements from public,anon,authenticated;
grant all on public.front_online_stock_settlements to service_role;

create or replace function public.finish_front_stock_sale(p_branch uuid,p_terminal uuid,p_receipt uuid,p_state text,p_items jsonb,p_total numeric)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare sale front_stock_sales%rowtype;
begin
  perform id from bulka_locations where id=p_branch for update;
  select * into sale from front_stock_sales where branch_id=p_branch and receipt_id=p_receipt;
  if sale.online_order_id is not null then perform id from kaspi_orders where id=sale.online_order_id for update; end if;
  if sale.receipt_id is null or sale.terminal_id<>p_terminal or p_state not in ('closed','voided')
    or p_state is null or p_items is distinct from sale.items or p_total is distinct from sale.receipt_total then
    raise exception 'Состояние или состав чека не совпадает с резервом' using errcode='P0001';
  end if;
  if sale.status=p_state then return jsonb_build_object('status',p_state,'duplicate',true); end if;
  if sale.status<>'reserved' then raise exception 'Итог чека уже зафиксирован. Требуется сверка.' using errcode='P0001'; end if;
  if sale.online_order_id is not null and p_state='closed' then
    perform settle_front_online_stock(sale.online_order_id,'front','iikofront:'||p_terminal);
  end if;
  -- A voided online receipt leaves its original goods reservation intact.
  -- A later corrected receipt can use it without deducting the goods twice.
  update front_stock_sales set status=p_state,updated_at=now() where branch_id=p_branch and receipt_id=p_receipt;
  if sale.online_order_id is not null and p_state='closed' then
    update kaspi_orders set pos_receipt_due=false where id=sale.online_order_id;
  end if;
  return jsonb_build_object('status',p_state,'duplicate',false);
end;
$$;

create function public.settle_front_online_stock(p_order uuid,p_origin text,p_actor text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare target kaspi_orders%rowtype; expected jsonb; product text; qty numeric;
begin
  select * into target from kaspi_orders where id=p_order;
  perform id from bulka_locations where id=target.branch_id for update;
  perform id from kaspi_orders where id=p_order for update;
  if exists(select 1 from front_online_stock_settlements where order_id=p_order) then return; end if;
  if exists(select 1 from front_stock_sales where online_order_id=p_order and status='closed') then return; end if;
  select jsonb_object_agg(product_id,q) into expected from (
    select product_id,sum(quantity) q from inventory_reservations
    where order_id=p_order and status='committed' group by product_id
  ) x;
  if expected is null or exists(select 1 from inventory_reservations where order_id=p_order and status<>'committed') then
    raise exception 'Дождитесь подтверждения полного резерва заказа' using errcode='P0001';
  end if;
  perform set_config('bulka.front_guard_write','true',true);
  perform set_config('bulka.stock_follow_iiko','true',true);
  for product,qty in select key,value::numeric from jsonb_each_text(expected) order by key loop
    update branch_product_inventory set source_quantity=source_quantity-qty,updated_at=now()
      where branch_id=target.branch_id and product_id=product and source_quantity>=qty;
    if not found then raise exception 'Количество собранного товара требует сверки' using errcode='P0001'; end if;
  end loop;
  insert into front_online_stock_settlements(order_id,branch_id,items,origin,actor)
    values(p_order,target.branch_id,expected,p_origin,coalesce(p_actor,'staff'));
  update inventory_reservations set status='released',updated_at=now()
    where order_id=p_order and status='committed';
end;
$$;

create function public.authorize_tablet_fulfillment() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.kitchen_status='ready' and old.kitchen_status is distinct from new.kitchen_status
    and new.status='paid' and new.refund_status is null
    and exists(select 1 from front_stock_policies where branch_id=new.branch_id and enabled and control_mode='tablet' and not paused)
    and not exists(select 1 from front_stock_sales where online_order_id=new.id and status='closed') then
    perform settle_front_online_stock(new.id,'tablet',coalesce(current_setting('bulka.staff_actor',true),new.staff_accepted_by,'staff'));
    new.tablet_ready_at:=now();
    new.tablet_ready_by:=coalesce(current_setting('bulka.staff_actor',true),new.staff_accepted_by,'staff');
    new.pos_receipt_due:=true;
    if new.fulfillment_type='delivery' and new.courier_id is null and new.courier_dispatch_completed_at is null then
      new.courier_dispatch_requested_at:=coalesce(new.courier_dispatch_requested_at,now());
      new.courier_dispatch_status:='pending';
      new.courier_dispatch_next_attempt_at:=now();
      new.courier_dispatch_error:=null;
    end if;
  end if;
  return new;
end;
$$;
create trigger aa_authorize_tablet_fulfillment before update on public.kaspi_orders
  for each row execute function public.authorize_tablet_fulfillment();

create or replace function public.front_delivery_receipt_ready(p_branch uuid,p_order uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from front_stock_policies where branch_id=p_branch and enabled)
    or exists(select 1 from front_stock_sales where branch_id=p_branch and online_order_id=p_order and status='closed')
    or exists(select 1 from front_online_stock_settlements where branch_id=p_branch and order_id=p_order and origin='tablet');
$$;

-- Lock branch before order, as the stock/receipt RPCs do. Only server-validated
-- staff transitions use this internal function; customer payloads cannot set audits.
create function public.apply_staff_order_transition(p_order uuid,p_kitchen text,p_fulfillment text,p_changes jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target kaspi_orders%rowtype; changed kaspi_orders%rowtype; branch uuid;
begin
  select branch_id into branch from kaspi_orders where id=p_order;
  perform id from bulka_locations where id=branch for update;
  select * into target from kaspi_orders where id=p_order for update;
  if not found or target.status<>'paid' or target.kitchen_status is distinct from p_kitchen
    or target.fulfillment_status is distinct from p_fulfillment
    or target.refund_status in ('processing','unknown','succeeded') then return null; end if;
  if p_changes is null or jsonb_typeof(p_changes)<>'object' or exists(select 1 from jsonb_object_keys(p_changes) key
    where key not in ('kitchen_status','fulfillment_status','updated_at','preparation_minutes','promised_ready_at',
      'kitchen_started_at','staff_accepted_at','staff_accepted_by','staff_accepted_session_jti_hash','staff_accepted_installation_id',
      'courier_dispatch_requested_at','courier_dispatch_status','courier_dispatch_next_attempt_at','courier_dispatch_error',
      'courier_dispatch_provider','courier_dispatch_attempts','kitchen_ready_at','handed_to_courier_at','delivery_status','fulfilled_at',
      'cancellation_reason','last_error')) then raise exception 'Некорректное изменение заказа' using errcode='22023'; end if;
  changed:=jsonb_populate_record(target,p_changes);
  perform set_config('bulka.staff_actor',coalesce(p_actor,'staff'),true);
  update kaspi_orders set kitchen_status=changed.kitchen_status,fulfillment_status=changed.fulfillment_status,
    updated_at=changed.updated_at,preparation_minutes=changed.preparation_minutes,promised_ready_at=changed.promised_ready_at,
    kitchen_started_at=changed.kitchen_started_at,staff_accepted_at=changed.staff_accepted_at,staff_accepted_by=changed.staff_accepted_by,
    staff_accepted_session_jti_hash=changed.staff_accepted_session_jti_hash,staff_accepted_installation_id=changed.staff_accepted_installation_id,
    courier_dispatch_requested_at=changed.courier_dispatch_requested_at,courier_dispatch_status=changed.courier_dispatch_status,
    courier_dispatch_next_attempt_at=changed.courier_dispatch_next_attempt_at,courier_dispatch_error=changed.courier_dispatch_error,
    courier_dispatch_provider=changed.courier_dispatch_provider,courier_dispatch_attempts=changed.courier_dispatch_attempts,
    kitchen_ready_at=changed.kitchen_ready_at,handed_to_courier_at=changed.handed_to_courier_at,delivery_status=changed.delivery_status,
    fulfilled_at=changed.fulfilled_at,cancellation_reason=changed.cancellation_reason,last_error=changed.last_error
    where id=p_order returning * into changed;
  return to_jsonb(changed);
end;
$$;
revoke all on function public.settle_front_online_stock(uuid,text,text),public.authorize_tablet_fulfillment(),
  public.apply_staff_order_transition(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_staff_order_transition(uuid,text,text,jsonb,text) to service_role;

create or replace function public.authorize_front_stock_sale(p_branch uuid,p_terminal uuid,p_receipt uuid,p_items jsonb,
  p_total numeric,p_loyalty_key text,p_online_number bigint default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sale front_stock_sales%rowtype; online kaspi_orders%rowtype; policy front_stock_policies%rowtype;
  product text; qty numeric; available numeric; held numeric; expected jsonb;
begin
  perform assert_front_stock_ready(p_branch);
  select * into policy from front_stock_policies where branch_id=p_branch;
  if not found or not policy.enabled then raise exception 'Общий учёт ещё не включён на филиале' using errcode='P0001'; end if;
  if p_terminal is null or not p_terminal=any(policy.terminal_ids) or p_receipt is null
    or p_total is null or p_total<0 or p_total<>round(p_total,2) or p_total>10000000
    or p_loyalty_key is null or p_loyalty_key !~ '^bp1:[0-9a-f-]{36}:[0-9a-f]{64}$'
    or p_items is null or jsonb_typeof(p_items)<>'object' or p_items='{}'::jsonb then
    raise exception 'Некорректный чек кассы' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each_text(p_items) x where length(x.key) not between 1 and 100
    or x.value !~ '^[0-9]{1,4}(\.[0-9]{1,3})?$' or x.value::numeric<=0 or x.value::numeric>9999) then
    raise exception 'Количество должно быть положительным, до трёх знаков после запятой' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each_text(p_items) x join branch_product_inventory i on i.branch_id=p_branch and i.product_id=x.key
    where mod(x.value::numeric,i.quantity_step)<>0) then
    raise exception 'Количество не соответствует единице измерения товара' using errcode='22023';
  end if;
  if p_online_number is not null then
    select * into online from kaspi_orders where branch_id=p_branch and order_number=p_online_number for update;
    if not found or online.status<>'paid' or (online.fulfillment_status not in ('preparing','ready') and not (online.fulfillment_status='completed' and online.pos_receipt_due))
      or online.refund_status is not null then
      raise exception 'Онлайн-заказ недоступен для пробития' using errcode='P0001';
    end if;
  end if;
  select * into sale from front_stock_sales where branch_id=p_branch and receipt_id=p_receipt for update;
  if found then
    if sale.terminal_id<>p_terminal or sale.items<>p_items or (sale.online_order_id is not null and sale.receipt_total<>p_total)
      or sale.online_order_id is distinct from online.id or sale.loyalty_order_key<>p_loyalty_key then
      raise exception 'Чек уже закреплён с другим составом или кассой. Требуется сверка.' using errcode='P0001';
    end if;
    if sale.status<>'reserved' then raise exception 'Чек уже завершён. Повторная продажа запрещена.' using errcode='P0001'; end if;
    update front_stock_sales set receipt_total=p_total,updated_at=now() where branch_id=p_branch and receipt_id=p_receipt;
    return jsonb_build_object('status','reserved','duplicate',true,'onlineOrderId',sale.online_order_id);
  end if;
  if online.id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_loyalty_key,0));
    perform pg_advisory_xact_lock(hashtextextended(p_receipt::text,0));
    select jsonb_object_agg(product_id,q) into expected from (
      select product_id,sum(quantity)::numeric q from inventory_reservations where order_id=online.id and status='committed' group by product_id
    ) x;
    select coalesce((select items from front_online_stock_settlements where order_id=online.id),expected) into expected;
    if expected is distinct from p_items then raise exception 'Состав чека не совпадает с онлайн-заказом' using errcode='P0001'; end if;
    if p_total<>greatest(0,online.subtotal-coalesce(online.discount_amount,0)-coalesce(online.bonus_spent,0)) then
      raise exception 'Сумма товаров в чеке не совпадает с онлайн-заказом. Ожидается: %',
        greatest(0,online.subtotal-coalesce(online.discount_amount,0)-coalesce(online.bonus_spent,0)) using errcode='P0001';
    end if;
    if not exists(select 1 from front_online_stock_settlements where order_id=online.id) and exists(select 1 from jsonb_each_text(p_items) x where not exists(select 1 from branch_product_inventory
      where branch_id=p_branch and product_id=x.key and source_quantity>=x.value::numeric)) then
      raise exception 'Остаток онлайн-заказа требует сверки' using errcode='P0001';
    end if;
    if exists(select 1 from loyalty_reservations where order_id in (p_loyalty_key,p_receipt::text)
      and status in ('active','committed')) then
      raise exception 'Уберите отдельную бонусную операцию: онлайн-заказ уже учтён' using errcode='P0001';
    end if;
    if exists(select 1 from gift_card_pos_reservations where branch_id=p_branch and iiko_order_id=p_receipt::text and status in ('active','committed')) then
      raise exception 'Уберите отдельную оплату сертификатом: онлайн-заказ уже оплачен' using errcode='P0001';
    end if;
  else
    for product,qty in select key,value::numeric from jsonb_each_text(p_items) order by key loop
      select source_quantity into available from branch_product_inventory
        where branch_id=p_branch and product_id=product and not manual_stop for update;
      if not found or available is null then raise exception 'Нет подтверждённого остатка товара %',product using errcode='P0001'; end if;
      select coalesce(sum(quantity),0)::numeric into held from inventory_reservations
        where branch_id=p_branch and product_id=product and (status='committed' or (status='active' and expires_at>now()));
      if available-held<qty then raise exception 'Товар уже зарезервирован. Доступно: %',greatest(0,available-held) using errcode='P0001'; end if;
      perform set_config('bulka.front_guard_write','true',true);
      perform set_config('bulka.stock_follow_iiko','true',true);
      update branch_product_inventory set source_quantity=source_quantity-qty,updated_at=now()
        where branch_id=p_branch and product_id=product;
    end loop;
  end if;
  insert into front_stock_sales(branch_id,receipt_id,terminal_id,online_order_id,loyalty_order_key,items,receipt_total,status)
    values(p_branch,p_receipt,p_terminal,online.id,p_loyalty_key,p_items,p_total,'reserved');
  return jsonb_build_object('status','reserved','duplicate',false,'onlineOrderId',online.id);
end;
$$;

create or replace function public.protect_front_linked_order() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists(select 1 from front_stock_policies where branch_id=new.branch_id and enabled) then return new; end if;
  if new.fulfillment_status in ('preparing','ready') and new.fulfillment_status is distinct from old.fulfillment_status
    and not exists(select 1 from front_stock_sales where online_order_id=old.id and status='closed')
    and not exists(select 1 from front_online_stock_settlements where order_id=old.id)
    and (not exists(select 1 from inventory_reservations where order_id=old.id and status='committed')
      or exists(select 1 from inventory_reservations where order_id=old.id and status<>'committed')) then
    raise exception 'Дождитесь подтверждения резерва оплаченного заказа' using errcode='P0001';
  end if;
  if exists(select 1 from front_stock_sales where online_order_id=old.id and status='reserved')
    and ((new.refund_status is distinct from old.refund_status and new.refund_status is not null)
      or new.status is distinct from old.status or new.cart_items is distinct from old.cart_items
      or new.fulfillment_status='cancelled' or new.kitchen_status='cancelled') then
    raise exception 'Сначала завершите или отмените связанный чек на кассе' using errcode='P0001';
  end if;
  if (new.fulfillment_status='completed' or new.kitchen_status='handed_over')
    and not exists(select 1 from front_stock_sales where online_order_id=old.id and status='closed')
    and not exists(select 1 from front_online_stock_settlements where order_id=old.id) then
    raise exception 'Сначала пробейте связанный чек iikoFront' using errcode='P0001';
  end if;
  return new;
end;
$$;

create or replace function public.consume_completed_manual_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare refunded_quantity numeric;
begin
  if exists(select 1 from front_online_stock_settlements where order_id=old.order_id) then return new; end if;
  if old.status = 'committed' and new.status = 'released' and old.order_id is not null
    and exists(select 1 from public.kaspi_orders where id = old.order_id
      and (fulfillment_status = 'completed' or kitchen_status = 'handed_over')) then
    select coalesce(sum(items.quantity), 0)::numeric into refunded_quantity
      from public.order_partial_refund_items items
      join public.order_partial_refunds refunds on refunds.id = items.refund_id
      where refunds.order_id = old.order_id and refunds.status = 'succeeded'
        and items.product_id = old.product_id;
    update public.branch_product_inventory
      set source_quantity = greatest(0, source_quantity - greatest(0, old.quantity - refunded_quantity)), updated_at = now()
      where branch_id = old.branch_id and product_id = old.product_id
        and source = 'admin' and source_quantity is not null;
  end if;
  return new;
end;
$$;

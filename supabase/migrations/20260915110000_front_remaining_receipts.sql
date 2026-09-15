-- A financial refund does not cancel the remaining physical order. Derive one
-- authoritative remaining receipt for the API, register guard and stock ledger.
create function public.front_remaining_receipt(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare target kaspi_orders%rowtype; item jsonb; position bigint; v_line_key text;
  original_qty numeric; refunded_qty numeric; qty numeric; gross numeric; total_gross numeric:=0;
  delivery_refund numeric:=0; delivery_remaining numeric; total numeric; reductions numeric;
  restored_bonus numeric:=0; remaining_bonus numeric; cart jsonb:='[]'; quantities jsonb:='{}'; product text;
begin
  select * into target from kaspi_orders where id=p_order;
  if not found then raise exception 'Заказ не найден' using errcode='P0001'; end if;
  if exists(select 1 from order_substitution_requests where order_id=p_order and status='processing') then
    return jsonb_build_object('ready',false,'reason','Дождитесь завершения замены товара');
  end if;
  for item,position in select value,ordinality-1 from jsonb_array_elements(coalesce(target.cart_items,'[]')) with ordinality loop
    v_line_key:=coalesce(nullif(item->>'lineKey',''),coalesce(nullif(item->>'id',''),nullif(item->>'productId',''),'item')||':'||position);
    original_qty:=(item->>'quantity')::numeric;
    select coalesce(sum(i.quantity),0) into refunded_qty from order_partial_refund_items i
      join order_partial_refunds r on r.id=i.refund_id
      where r.order_id=p_order and r.status='succeeded' and i.line_key=v_line_key
        and not exists(select 1 from order_substitution_requests s where s.order_id=p_order and s.refund_id=r.id and s.status='completed');
    if original_qty is null or original_qty<=0 or refunded_qty>original_qty then
      raise exception 'Количество оставшихся товаров требует сверки' using errcode='P0001';
    end if;
    qty:=original_qty-refunded_qty;
    if qty=0 then continue; end if;
    gross:=coalesce((item->>'lineTotal')::numeric,round((item->>'price')::numeric*original_qty));
    gross:=gross-round(gross*refunded_qty/original_qty);
    product:=coalesce(nullif(item->>'id',''),nullif(item->>'productId',''),nullif(item->>'iikoProductId',''));
    if product is null or gross<=0 then raise exception 'Состав чека требует сверки' using errcode='P0001'; end if;
    cart:=cart||jsonb_build_array(item||jsonb_build_object('lineKey',v_line_key,'quantity',qty,'lineTotal',gross));
    quantities:=quantities||jsonb_build_object(product,coalesce((quantities->>product)::numeric,0)+qty);
    total_gross:=total_gross+gross;
  end loop;
  select coalesce(sum(i.refund_amount),0) into delivery_refund from order_partial_refund_items i
    join order_partial_refunds r on r.id=i.refund_id where r.order_id=p_order and r.status='succeeded' and i.line_key='__delivery_fee__';
  delivery_remaining:=greatest(0,coalesce(target.delivery_fee,0)-delivery_refund);
  total:=case when coalesce(target.partially_refunded_amount,0)>0
    then target.amount-target.partially_refunded_amount-delivery_remaining
    else target.subtotal-coalesce(target.discount_amount,0)-coalesce(target.bonus_spent,0) end;
  if total is null or total<0 or total>total_gross then
    raise exception 'Сумма оставшихся товаров требует сверки' using errcode='P0001';
  end if;
  select coalesce(sum(spent_bonus_restored),0) into restored_bonus from order_partial_refund_adjustments where order_id=p_order;
  reductions:=total_gross-total;
  remaining_bonus:=least(reductions,greatest(0,coalesce(target.bonus_spent,0)-restored_bonus));
  return jsonb_build_object('ready',target.status='paid' and coalesce(target.refund_status,'') in ('','partial','failed'),
    'cartItems',cart,'items',quantities,'total',total,'subtotal',total_gross,
    'discount',reductions-remaining_bonus,'bonusSpent',remaining_bonus,'deliveryFee',delivery_remaining,
    'amount',total+delivery_remaining);
end;
$$;
revoke all on function public.front_remaining_receipt(uuid) from public,anon,authenticated;
grant execute on function public.front_remaining_receipt(uuid) to service_role;

create function public.front_remaining_receipts(p_orders uuid[])
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_object_agg(id,front_remaining_receipt(id)),'{}') from
    (select distinct unnest(p_orders[1:100]) id) orders;
$$;
revoke all on function public.front_remaining_receipts(uuid[]) from public,anon,authenticated;
grant execute on function public.front_remaining_receipts(uuid[]) to service_role;

create function public.assert_front_partial_refund(p_order uuid,p_amount numeric)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare target kaspi_orders%rowtype;
begin
  select * into target from kaspi_orders where id=p_order;
  if exists(select 1 from front_receipt_jobs where order_id=p_order and status='assigned' and receipt_id is not null)
    or exists(select 1 from front_stock_sales where online_order_id=p_order and status='reserved') then
    raise exception 'Сначала завершите связанный чек на кассе, затем оформите возврат' using errcode='P0001';
  end if;
  if p_amount < target.amount-coalesce(target.partially_refunded_amount,0)
    and (exists(select 1 from front_receipt_jobs where order_id=p_order and status='completed')
      or exists(select 1 from front_stock_sales where online_order_id=p_order and status='closed')) then
    raise exception 'Чек уже пробит. Автоматический частичный возврат закрытого чека недоступен. Обратитесь к администратору для сверки возврата и чека.' using errcode='P0001';
  end if;
end;
$$;
revoke all on function public.assert_front_partial_refund(uuid,numeric) from public,anon,authenticated;
grant execute on function public.assert_front_partial_refund(uuid,numeric) to service_role;


create or replace function public.authorize_front_stock_sale(p_branch uuid,p_terminal uuid,p_receipt uuid,p_items jsonb,
  p_total numeric,p_loyalty_key text,p_online_number bigint default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sale front_stock_sales%rowtype; online kaspi_orders%rowtype; policy front_stock_policies%rowtype;
  product text; qty numeric; available numeric; held numeric; expected jsonb; receipt jsonb;
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
      or coalesce(online.refund_status,'') not in ('','partial','failed') then
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
    receipt:=front_remaining_receipt(online.id);
    if not coalesce((receipt->>'ready')::boolean,false) then raise exception 'Дождитесь завершения возврата или замены' using errcode='P0001'; end if;
    expected:=receipt->'items';
    if expected is distinct from p_items then raise exception 'Состав чека не совпадает с онлайн-заказом' using errcode='P0001'; end if;
    if p_total<>(receipt->>'total')::numeric then
      raise exception 'Сумма товаров в чеке не совпадает с онлайн-заказом. Ожидается: %',
        (receipt->>'total')::numeric using errcode='P0001';
    end if;
    if not exists(select 1 from front_online_stock_settlements where order_id=online.id) and exists(select 1 from inventory_reservations where order_id=online.id and allocation_kind='display') and exists(select 1 from jsonb_each_text(p_items) x where not exists(select 1 from branch_product_inventory
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
        where branch_id=p_branch and product_id=product and allocation_kind='display' and (status='committed' or (status='active' and expires_at>now()));
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

create or replace function public.settle_front_online_stock(p_order uuid,p_origin text,p_actor text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare target kaspi_orders%rowtype; expected jsonb; product text; qty numeric; receipt jsonb;
begin
  select * into target from kaspi_orders where id=p_order;
  perform id from bulka_locations where id=target.branch_id for update;
  perform id from kaspi_orders where id=p_order for update;
  if exists(select 1 from front_online_stock_settlements where order_id=p_order) then return; end if;
  if exists(select 1 from front_stock_sales where online_order_id=p_order and status='closed') then return; end if;
  receipt:=front_remaining_receipt(p_order);
  expected:=receipt->'items';
  if not coalesce((receipt->>'ready')::boolean,false) or expected='{}'::jsonb or exists(
    select 1 from jsonb_each_text(expected) e where e.value::numeric > coalesce(
      (select sum(quantity) from inventory_reservations where order_id=p_order and status='committed' and product_id=e.key),0)) then
    raise exception 'Дождитесь подтверждения полного резерва заказа' using errcode='P0001';
  end if;
  perform set_config('bulka.front_guard_write','true',true);
  perform set_config('bulka.stock_follow_iiko','true',true);
  for product,qty in select e.key,e.value::numeric from jsonb_each_text(expected) e where exists(select 1 from inventory_reservations r where r.order_id=p_order and r.product_id=e.key and r.status='committed' and r.allocation_kind='display') order by e.key loop
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

create or replace function public.authorize_tablet_fulfillment() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.kitchen_status='ready' and old.kitchen_status is distinct from new.kitchen_status
    and new.status='paid' and coalesce(new.refund_status,'') in ('','partial','failed')
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

create or replace function public.settle_automatic_front_order() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='paid' and coalesce(new.refund_status,'') in ('','partial','failed') and new.kitchen_status='ready'
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

create or replace function public.queue_front_receipt() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare linked front_stock_sales%rowtype; expected jsonb; receipt jsonb;
begin
  if new.status='paid' and coalesce(new.refund_status,'') in ('','partial','failed')
    and (new.kitchen_status='handed_over' and old.kitchen_status is distinct from new.kitchen_status
      or new.fulfillment_status='completed' and old.fulfillment_status is distinct from new.fulfillment_status)
    and exists(select 1 from pos_devices where branch_id=new.branch_id and active) then
    select * into linked from front_stock_sales where online_order_id=new.id and status<>'voided';
    if linked.status='closed' then return new; end if;
    receipt:=front_remaining_receipt(new.id);
    if not coalesce((receipt->>'ready')::boolean,false) then raise exception 'Дождитесь завершения возврата или замены' using errcode='P0001'; end if;
    expected:=receipt->'items';
    insert into front_receipt_jobs(order_id,branch_id,terminal_id,receipt_id,expected_items,expected_total,status)
      values(new.id,new.branch_id,linked.terminal_id,linked.receipt_id,expected,
        (receipt->>'total')::numeric,
        case when linked.receipt_id is null then 'pending' else 'assigned' end)
      on conflict(order_id) do nothing;
    new.pos_receipt_due:=true;
  end if;
  return new;
end;
$$;

create or replace function public.front_receipt_job_action(p_branch uuid,p_terminal uuid,p_order uuid,p_action text,
  p_receipt uuid default null,p_items jsonb default null,p_total numeric default null,p_error text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job front_receipt_jobs%rowtype; target kaspi_orders%rowtype; expected jsonb; result jsonb; receipt jsonb;
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
  receipt:=front_remaining_receipt(p_order);
  if not coalesce((receipt->>'ready')::boolean,false) then
    raise exception 'Оплата заказа не подтверждена либо выполняется возврат' using errcode='P0001';
  end if;
  if p_action='claim' then
    if job.receipt_id is null then
      update front_receipt_jobs set expected_items=receipt->'items',expected_total=(receipt->>'total')::numeric where order_id=p_order;
    end if;
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
  if expected is null or expected is distinct from p_items or expected is distinct from receipt->'items'
    or p_total is distinct from job.expected_total
    or p_total is distinct from (receipt->>'total')::numeric then
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

create or replace function public.protect_front_linked_order() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- A bound automatic draft is owned by a physical register even when its
  -- branch stock policy has subsequently been disabled. Freeze its basket
  -- before any refund claim can reach the payment provider.
  if exists(select 1 from front_receipt_jobs where order_id=old.id and status='assigned' and receipt_id is not null)
    and ((new.refund_status is distinct from old.refund_status and new.refund_status is not null)
      or new.status is distinct from old.status or new.cart_items is distinct from old.cart_items
      or new.fulfillment_status='cancelled' or new.kitchen_status='cancelled') then
    raise exception 'Сначала завершите связанный чек на кассе, затем оформите возврат' using errcode='P0001';
  end if;
  if not exists(select 1 from front_stock_policies where branch_id=new.branch_id and enabled) then return new; end if;
  if new.fulfillment_status in ('preparing','ready') and new.fulfillment_status is distinct from old.fulfillment_status
    and not exists(select 1 from front_stock_sales where online_order_id=old.id and status='closed')
    and not exists(select 1 from front_online_stock_settlements where order_id=old.id)
    and (not exists(select 1 from inventory_reservations where order_id=old.id and status='committed')
      or exists(select 1 from jsonb_each_text(front_remaining_receipt(old.id)->'items') e where e.value::numeric > coalesce((select sum(quantity) from inventory_reservations r where r.order_id=old.id and r.product_id=e.key and r.status='committed'),0))) then
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

create or replace function public.poll_front_order_inbox(p_branch uuid, p_terminal uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer; v_first jsonb;
begin
  if p_terminal is null or not exists(select 1 from public.bulka_locations where id=p_branch and active) then
    raise exception 'Филиал не активен';
  end if;
  insert into public.front_order_inbox_terminals(branch_id,terminal_id,last_seen_at)
    values(p_branch,p_terminal,now())
    on conflict(branch_id,terminal_id) do update set last_seen_at=excluded.last_seen_at
      where front_order_inbox_terminals.last_seen_at<now()-interval '10 seconds';
  select count(*) into v_count from public.kaspi_orders
    where branch_id=p_branch and status='paid' and fulfillment_status='new' and coalesce(refund_status,'') in ('','partial','failed');
  select jsonb_build_array(jsonb_build_object('id',id,'number',order_number)) into v_first
    from public.kaspi_orders where branch_id=p_branch and status='paid' and fulfillment_status='new'
      and coalesce(refund_status,'') in ('','partial','failed') order by created_at,id limit 1;
  return jsonb_build_object('total',v_count,'page',1,'orders',coalesce(v_first,'[]'::jsonb));
end;
$$;

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
  where o.branch_id=p_branch and o.status='paid' and coalesce(o.refund_status,'') in ('','partial','failed')
    and ((o.fulfillment_status in ('new','preparing','ready') and o.kitchen_status is distinct from 'handed_over')
      or coalesce(o.handed_to_courier_at,o.fulfilled_at)>=now()-interval '24 hours'
      or o.pos_receipt_due);
  return v_inbox || jsonb_build_object('revision',v_revision,'newestOrderNumber',v_newest);
end;
$$;


create or replace function public.claim_partial_refund(
  p_order_id uuid,
  p_idempotency_key uuid,
  p_processor_token uuid,
  p_amount numeric,
  p_reason text,
  p_requested_by text,
  p_items jsonb
)
returns public.order_partial_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.kaspi_orders%rowtype;
  v_refund public.order_partial_refunds%rowtype;
  v_item jsonb;
  v_line_key text;
  v_quantity numeric;
  v_original_quantity numeric;
  v_claimed_quantity numeric;
  v_items_amount numeric(12,2) := 0;
begin
  if p_order_id is null or p_idempotency_key is null or p_processor_token is null then
    raise exception 'order, idempotency key and processor token are required';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid refund amount'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid refund items';
  end if;

  perform pg_advisory_xact_lock(hashtext('partial-refund-claim:' || p_order_id::text));

  select * into v_refund
  from public.order_partial_refunds
  where order_id = p_order_id and idempotency_key = p_idempotency_key;
  if v_refund.id is not null then return v_refund; end if;

  select * into v_order from public.kaspi_orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'order not found'; end if;
  perform public.assert_front_partial_refund(p_order_id,p_amount);
  if v_order.status <> 'paid' then raise exception 'order is not paid'; end if;
  if coalesce(v_order.refund_status, '') in ('processing', 'unknown') then
    raise exception 'another refund is already being processed';
  end if;
  if coalesce(v_order.partially_refunded_amount, 0) + p_amount > v_order.amount then
    raise exception 'refund exceeds order amount';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line_key := nullif(btrim(v_item->>'line_key'), '');
    v_quantity := coalesce((v_item->>'quantity')::numeric, 0);
    v_original_quantity := coalesce((v_item->>'original_quantity')::numeric, 0);
    if v_line_key is null or v_quantity < 0.001 or v_quantity<>round(v_quantity,3) or v_original_quantity < v_quantity then
      raise exception 'invalid refund line';
    end if;

    select coalesce(sum(items.quantity), 0)::numeric into v_claimed_quantity
    from public.order_partial_refund_items items
    join public.order_partial_refunds refunds on refunds.id = items.refund_id
    where refunds.order_id = p_order_id
      and refunds.status in ('processing', 'succeeded')
      and items.line_key = v_line_key;
    if v_claimed_quantity + v_quantity > v_original_quantity then
      raise exception 'refund quantity already claimed for line %', v_line_key;
    end if;
    v_items_amount := v_items_amount + coalesce((v_item->>'refund_amount')::numeric, 0);
  end loop;

  if round(v_items_amount, 2) <> round(p_amount, 2) then
    raise exception 'refund amount does not match items';
  end if;

  insert into public.order_partial_refunds(
    order_id, idempotency_key, processor_token, amount, reason, status, requested_by
  ) values (
    p_order_id,
    p_idempotency_key,
    p_processor_token,
    p_amount,
    nullif(btrim(p_reason), ''),
    'processing',
    left(coalesce(nullif(btrim(p_requested_by), ''), 'admin'), 160)
  ) returning * into v_refund;

  insert into public.order_partial_refund_items(
    refund_id, line_key, product_id, product_name, quantity, unit_amount, refund_amount
  )
  select
    v_refund.id,
    item->>'line_key',
    coalesce(item->>'product_id', ''),
    left(coalesce(item->>'product_name', 'Товар'), 200),
    (item->>'quantity')::numeric,
    coalesce((item->>'unit_amount')::numeric, 0),
    coalesce((item->>'refund_amount')::numeric, 0)
  from jsonb_array_elements(p_items) item;

  -- The order itself is the cross-flow mutex. A full cancellation and another
  -- partial refund must not reach Kaspi while this request is in flight.
  update public.kaspi_orders
  set refund_status = 'processing',
      refund_requested_at = now(),
      refund_error = null,
      updated_at = now()
  where id = p_order_id;

  return v_refund;
end;
$$;

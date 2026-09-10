-- Opt-in per branch after installing the guard on EVERY register and counting stock.
-- In this mode source_quantity is an allocation ledger. Front snapshots remain
-- observations; they cannot resurrect goods whose fiscal/payment outcome is unknown.
create table public.front_stock_policies (
  branch_id uuid primary key references public.bulka_locations(id),
  enabled boolean not null default false,
  terminal_ids uuid[] not null check (cardinality(terminal_ids) between 1 and 8),
  updated_at timestamptz not null default now()
);
create table public.front_stock_terminals (
  branch_id uuid not null references public.bulka_locations(id),
  terminal_id uuid not null,
  last_seen_at timestamptz not null default now(),
  connected boolean not null,
  protocol integer not null check (protocol = 1),
  primary key (branch_id, terminal_id)
);
create table public.front_stock_sales (
  branch_id uuid not null references public.bulka_locations(id),
  receipt_id uuid not null,
  terminal_id uuid not null,
  online_order_id uuid references public.kaspi_orders(id),
  loyalty_order_key text not null unique,
  items jsonb not null check (jsonb_typeof(items) = 'object'),
  receipt_total numeric(12,2) not null check (receipt_total >= 0),
  status text not null check (status in ('reserved','closed','voided')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (branch_id, receipt_id)
);
create index front_stock_sales_pending on public.front_stock_sales(branch_id) where status = 'reserved';
create unique index front_stock_sales_one_online_receipt on public.front_stock_sales(online_order_id) where status<>'voided';
alter table public.front_stock_policies enable row level security;
alter table public.front_stock_terminals enable row level security;
alter table public.front_stock_sales enable row level security;
revoke all on public.front_stock_policies, public.front_stock_terminals, public.front_stock_sales from public,anon,authenticated;
grant all on public.front_stock_policies, public.front_stock_terminals, public.front_stock_sales to service_role;

create function public.front_stock_ready(p_branch uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists(select 1 from front_stock_policies p where p.branch_id=p_branch and p.enabled
    and exists(select 1 from unnest(p.terminal_ids) t(id) where not exists (
      select 1 from front_stock_terminals s where s.branch_id=p_branch and s.terminal_id=t.id
        and s.connected and s.protocol=1 and s.last_seen_at > now()-interval '45 seconds')));
$$;

create function public.front_stock_heartbeat(p_branch uuid,p_terminal uuid,p_connected boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare policy front_stock_policies%rowtype;
begin
  if p_terminal is null or p_connected is null or not exists(select 1 from bulka_locations where id=p_branch and active) then
    raise exception 'Некорректная касса' using errcode='22023';
  end if;
  insert into front_stock_terminals values(p_branch,p_terminal,now(),p_connected,1)
    on conflict(branch_id,terminal_id) do update set last_seen_at=now(),connected=excluded.connected,protocol=1;
  select * into policy from front_stock_policies where branch_id=p_branch;
  return jsonb_build_object('enabled',coalesce(policy.enabled,false),
    'registered',coalesce(p_terminal=any(policy.terminal_ids),false),'ready',front_stock_ready(p_branch));
end;
$$;

create function public.assert_front_stock_ready(p_branch uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Shared lock order: branch, online order (if any), products in sorted order.
  perform id from bulka_locations where id=p_branch and active for update;
  if not found then raise exception 'Филиал недоступен' using errcode='P0001'; end if;
  if not front_stock_ready(p_branch) then
    raise exception 'Продажи временно приостановлены: нет связи с одной из касс' using errcode='P0001';
  end if;
end;
$$;

alter function public.reserve_order_inventory(uuid,uuid,uuid,jsonb,integer,timestamptz) rename to reserve_order_inventory_before_front_guard;
create function public.reserve_order_inventory(p_customer_id uuid,p_request_id uuid,p_branch_id uuid,p_items jsonb,
  p_ttl_minutes integer default 20,p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform id from bulka_locations where id=p_branch_id for update;
  if exists(select 1 from front_stock_policies where branch_id=p_branch_id and enabled) then
    perform assert_front_stock_ready(p_branch_id);
    if exists(select 1 from jsonb_array_elements(p_items) x where not exists(
      select 1 from branch_product_inventory i where i.branch_id=p_branch_id and i.product_id=x->>'id' and i.source_quantity is not null)) then
      raise exception 'Количество товара не подтверждено кассиром' using errcode='P0001';
    end if;
  end if;
  return reserve_order_inventory_before_front_guard(p_customer_id,p_request_id,p_branch_id,p_items,p_ttl_minutes,p_expires_at);
end;
$$;

create function public.authorize_front_stock_sale(p_branch uuid,p_terminal uuid,p_receipt uuid,p_items jsonb,
  p_total numeric,p_loyalty_key text,p_online_number bigint default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sale front_stock_sales%rowtype; online kaspi_orders%rowtype; policy front_stock_policies%rowtype;
  product text; qty integer; available integer; held integer; expected jsonb;
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
    or x.value !~ '^[1-9][0-9]{0,3}$') then
    raise exception 'Поддерживаются только целые количества товаров' using errcode='22023';
  end if;
  if p_online_number is not null then
    select * into online from kaspi_orders where branch_id=p_branch and order_number=p_online_number for update;
    if not found or online.status<>'paid' or online.fulfillment_status not in ('preparing','ready')
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
      select product_id,sum(quantity)::integer q from inventory_reservations where order_id=online.id and status='committed' group by product_id
    ) x;
    if expected is distinct from p_items then raise exception 'Состав чека не совпадает с онлайн-заказом' using errcode='P0001'; end if;
    if p_total<>greatest(0,online.subtotal-coalesce(online.discount_amount,0)-coalesce(online.bonus_spent,0)) then
      raise exception 'Сумма товаров в чеке не совпадает с онлайн-заказом. Ожидается: %',
        greatest(0,online.subtotal-coalesce(online.discount_amount,0)-coalesce(online.bonus_spent,0)) using errcode='P0001';
    end if;
    if exists(select 1 from jsonb_each_text(p_items) x where not exists(select 1 from branch_product_inventory
      where branch_id=p_branch and product_id=x.key and source_quantity>=x.value::integer)) then
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
    for product,qty in select key,value::integer from jsonb_each_text(p_items) order by key loop
      select source_quantity into available from branch_product_inventory
        where branch_id=p_branch and product_id=product and not manual_stop for update;
      if not found or available is null then raise exception 'Нет подтверждённого остатка товара %',product using errcode='P0001'; end if;
      select coalesce(sum(quantity),0)::integer into held from inventory_reservations
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

create function public.finish_front_stock_sale(p_branch uuid,p_terminal uuid,p_receipt uuid,p_state text,p_items jsonb,p_total numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sale front_stock_sales%rowtype; product text; qty integer;
begin
  -- Completion is accepted even after a heartbeat outage; it is reconciliation,
  -- never permission for a new sale. No timeout automatically releases a POS debit.
  perform id from bulka_locations where id=p_branch for update;
  select * into sale from front_stock_sales where branch_id=p_branch and receipt_id=p_receipt;
  if sale.online_order_id is not null then perform id from kaspi_orders where id=sale.online_order_id for update; end if;
  if sale.receipt_id is null or sale.terminal_id<>p_terminal or p_state not in ('closed','voided')
    or p_state is null or p_items is distinct from sale.items or p_total is distinct from sale.receipt_total then
    raise exception 'Состояние или состав чека не совпадает с резервом' using errcode='P0001';
  end if;
  if sale.status=p_state then return jsonb_build_object('status',p_state,'duplicate',true); end if;
  if sale.status<>'reserved' then raise exception 'Итог чека уже зафиксирован. Требуется сверка.' using errcode='P0001'; end if;
  if sale.online_order_id is not null then
    perform set_config('bulka.front_guard_write','true',true);
    perform set_config('bulka.stock_follow_iiko','true',true);
    for product,qty in select key,value::integer from jsonb_each_text(sale.items) order by key loop
      update branch_product_inventory set source_quantity=source_quantity-qty,updated_at=now()
        where branch_id=p_branch and product_id=product and source_quantity>=qty;
      if not found then raise exception 'Остаток связанного заказа требует сверки' using errcode='P0001'; end if;
    end loop;
    if p_state='closed' then
      update inventory_reservations set status='released',updated_at=now() where order_id=sale.online_order_id and status='committed';
    end if;
  end if;
  -- Voiding proves no cheque will be paid again. It does NOT prove that products
  -- were returned to the display (printed items may have been wasted).
  update front_stock_sales set status=p_state,updated_at=now() where branch_id=p_branch and receipt_id=p_receipt;
  return jsonb_build_object('status',p_state,'duplicate',false);
end;
$$;

create function public.protect_front_stock_ledger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists(select 1 from front_stock_policies where branch_id=new.branch_id and enabled)
    and current_setting('bulka.front_guard_write',true) is distinct from 'true' then
    if current_setting('bulka.front_snapshot',true)='true' then
      new.source_quantity:=old.source_quantity;
      new.source:=old.source;
    elsif new.source_quantity is distinct from old.source_quantity then
      raise exception 'Общий учёт включён. Используйте сверку остатков при остановленных кассах.' using errcode='P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger zz_protect_front_stock_ledger before update on public.branch_product_inventory
  for each row execute function public.protect_front_stock_ledger();

create function public.protect_front_linked_order() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists(select 1 from front_stock_policies where branch_id=new.branch_id and enabled) then return new; end if;
  if new.fulfillment_status in ('preparing','ready') and new.fulfillment_status is distinct from old.fulfillment_status
    and not exists(select 1 from front_stock_sales where online_order_id=old.id and status='closed')
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
    and not exists(select 1 from front_stock_sales where online_order_id=old.id and status='closed') then
    raise exception 'Сначала пробейте связанный чек iikoFront' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger protect_front_linked_order before update on public.kaspi_orders
  for each row execute function public.protect_front_linked_order();

create function public.protect_front_online_loyalty() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.order_id,0));
  if exists(select 1 from front_stock_sales where online_order_id is not null
    and (loyalty_order_key=new.order_id or receipt_id::text=new.order_id)) then
    raise exception 'Бонусы онлайн-заказа уже учтены в Bulka' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger protect_front_online_loyalty before insert or update on public.loyalty_reservations
  for each row execute function public.protect_front_online_loyalty();

create function public.protect_front_online_gift() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.iiko_order_id,0));
  if exists(select 1 from front_stock_sales where branch_id=new.branch_id and online_order_id is not null and receipt_id::text=new.iiko_order_id) then
    raise exception 'Онлайн-заказ уже оплачен в Bulka' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger protect_front_online_gift before insert or update on public.gift_card_pos_reservations
  for each row execute function public.protect_front_online_gift();

create function public.check_front_shared_reservation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare available integer; held integer; already_held boolean := false; buffer_units integer := 1;
begin
  if new.status not in ('active','committed') or not exists(select 1 from front_stock_policies where branch_id=new.branch_id and enabled) then return new; end if;
  perform id from bulka_locations where id=new.branch_id for update;
  if tg_op='UPDATE' then
    already_held := new.branch_id=old.branch_id and new.product_id=old.product_id
      and new.customer_id=old.customer_id and new.client_request_id=old.client_request_id
      and new.quantity<=old.quantity
      and (old.status='committed' or (old.status='active' and old.expires_at>now()));
  end if;
  if already_held then buffer_units:=0; else perform assert_front_stock_ready(new.branch_id); end if;
  select source_quantity into available from branch_product_inventory where branch_id=new.branch_id and product_id=new.product_id for update;
  select coalesce(sum(quantity),0)::integer into held from inventory_reservations where branch_id=new.branch_id
    and product_id=new.product_id and id<>new.id and (status='committed' or (status='active' and expires_at>now()));
  if available is null or available-held-buffer_units<new.quantity then
    raise exception 'Количество товара не подтверждено или уже занято' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger check_front_shared_reservation before insert or update on public.inventory_reservations
  for each row execute function public.check_front_shared_reservation();

revoke all on function public.reserve_order_inventory_before_front_guard(uuid,uuid,uuid,jsonb,integer,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.front_stock_ready(uuid),public.front_stock_heartbeat(uuid,uuid,boolean),public.assert_front_stock_ready(uuid),
  public.reserve_order_inventory(uuid,uuid,uuid,jsonb,integer,timestamptz),
  public.authorize_front_stock_sale(uuid,uuid,uuid,jsonb,numeric,text,bigint),
  public.finish_front_stock_sale(uuid,uuid,uuid,text,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.front_stock_ready(uuid),public.front_stock_heartbeat(uuid,uuid,boolean),
  public.reserve_order_inventory(uuid,uuid,uuid,jsonb,integer,timestamptz),
  public.authorize_front_stock_sale(uuid,uuid,uuid,jsonb,numeric,text,bigint),
  public.finish_front_stock_sale(uuid,uuid,uuid,text,jsonb,numeric) to service_role;

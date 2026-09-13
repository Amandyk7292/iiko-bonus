-- Null service hours inherit the branch schedule. Existing branches retain two-day preorders.
alter table public.bulka_locations
  add column if not exists pickup_hours jsonb,
  add column if not exists preorder_hours jsonb,
  add column if not exists delivery_hours jsonb,
  add column if not exists preorder_days smallint not null default 2 check (preorder_days in (2,3));
create or replace function public.reserve_preorder_inventory(p_customer_id uuid,p_request_id uuid,p_branch_id uuid,p_items jsonb,
  p_scheduled_at timestamptz,p_ttl_minutes integer default 20,p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item record; saved inventory_reservations%rowtype; stock branch_product_inventory%rowtype;
  expires timestamptz; requested jsonb; horizon integer;
begin
  select preorder_days into horizon from bulka_locations where id=p_branch_id and active for update;
  if not found or p_customer_id is null or p_request_id is null or p_scheduled_at is null
    or (p_scheduled_at at time zone 'Asia/Aqtau')::date - (now() at time zone 'Asia/Aqtau')::date not between 1 and horizon
    or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Дата предзаказа выходит за разрешённый период филиала' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where length(coalesce(x->>'id','')) not between 1 and 100
    or coalesce(x->>'quantity','') !~ '^[0-9]{1,2}(\.[0-9]{1,3})?$' or (x->>'quantity')::numeric<=0) then
    raise exception 'Некорректное количество' using errcode='22023';
  end if;
  select jsonb_object_agg(id,qty) into requested from (
    select x->>'id' id,sum((x->>'quantity')::numeric) qty from jsonb_array_elements(p_items) x group by x->>'id'
  ) items;
  expires:=coalesce(p_expires_at,now()+make_interval(mins=>greatest(5,least(p_ttl_minutes,1445))));
  if expires<=now() or expires>now()+interval '24 hours 5 minutes' then raise exception 'Некорректный срок оплаты' using errcode='22023'; end if;
  if exists(select 1 from inventory_reservations where client_request_id=p_request_id
    and (customer_id<>p_customer_id or branch_id<>p_branch_id or allocation_kind<>'preorder'
      or preorder_for is distinct from p_scheduled_at or not requested ? product_id)) then
    raise exception 'Конфликт идентификатора оформления' using errcode='P0001';
  end if;
  for item in select key id,value::numeric qty from jsonb_each_text(requested) order by key loop
    insert into branch_product_inventory(branch_id,product_id,source)
      values(p_branch_id,item.id,'admin') on conflict(branch_id,product_id) do nothing;
    select * into stock from branch_product_inventory where branch_id=p_branch_id and product_id=item.id for update;
    if stock.preorder_stop or item.qty>99 or mod(item.qty,stock.quantity_step)<>0 then
      raise exception 'Предзаказ товара временно недоступен' using errcode='P0001';
    end if;
    select * into saved from inventory_reservations where client_request_id=p_request_id and product_id=item.id for update;
    if found and saved.quantity<>item.qty then raise exception 'Состав оформления уже закреплён' using errcode='P0001'; end if;
    if saved.status='committed' then continue; end if;
    if saved.id is null then
      insert into inventory_reservations(customer_id,client_request_id,branch_id,product_id,allocation_kind,preorder_for,quantity,status,expires_at)
        values(p_customer_id,p_request_id,p_branch_id,item.id,'preorder',p_scheduled_at,item.qty,'active',expires);
    else
      update inventory_reservations set status='active',expires_at=expires,updated_at=now() where id=saved.id;
    end if;
  end loop;
  return jsonb_build_object('status','reserved','count',(select count(*) from jsonb_object_keys(requested)),'expiresAt',expires);
end;
$$;


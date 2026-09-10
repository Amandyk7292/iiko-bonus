-- Absolute manual counts include sales before that count. Delayed receipt
-- delivery may reduce only a newer count, and every receipt is applied once.
alter table public.branch_product_inventory add column manual_counted_at timestamptz not null default now();
create table public.front_offline_receipts (
  branch_id uuid not null references public.bulka_locations(id), receipt_id uuid not null,
  terminal_id uuid not null, closed_at timestamptz not null, items jsonb not null,
  receipt_total numeric not null, result jsonb not null, created_at timestamptz not null default now(),
  primary key(branch_id,receipt_id)
);
alter table public.front_offline_receipts enable row level security;
revoke all on public.front_offline_receipts from public,anon,authenticated;
grant all on public.front_offline_receipts to service_role;

alter function public.update_cashier_inventory(uuid,text,text,bigint,jsonb) rename to update_cashier_inventory_before_receipts;
create function public.update_cashier_inventory(p_branch_id uuid,p_product_id text,p_product_name text,
  p_expected_revision bigint,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  result:=update_cashier_inventory_before_receipts(p_branch_id,p_product_id,p_product_name,p_expected_revision,p_changes);
  if p_changes ? 'sourceQuantity' then
    update branch_product_inventory set manual_counted_at=now() where branch_id=p_branch_id and product_id=p_product_id;
  end if;
  return result;
end;
$$;
alter function public.update_admin_inventory(jsonb) rename to update_admin_inventory_before_receipts;
create function public.update_admin_inventory(p_stock jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  result:=update_admin_inventory_before_receipts(p_stock);
  update branch_product_inventory set manual_counted_at=now()
    where branch_id=(p_stock->>'branch_id')::uuid and product_id=p_stock->>'product_id';
  return result;
end;
$$;

create function public.record_front_offline_receipt(p_branch uuid,p_terminal uuid,p_receipt uuid,
  p_closed_at timestamptz,p_items jsonb,p_total numeric)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous front_offline_receipts%rowtype; item record; stock branch_product_inventory%rowtype;
  changed integer:=0; shortage boolean:=false; held numeric; result jsonb;
begin
  perform id from bulka_locations where id=p_branch and active for update;
  if not found or not exists(select 1 from pos_devices where branch_id=p_branch and terminal_id=p_terminal and active) then
    raise exception 'Касса не привязана к филиалу' using errcode='P0001';
  end if;
  if p_receipt is null or p_closed_at is null or p_closed_at>now()+interval '1 minute'
    or p_total is null or p_total<0 or p_total<>round(p_total,2) or p_total>10000000
    or p_items is null or jsonb_typeof(p_items)<>'object' or p_items='{}'::jsonb
    or exists(select 1 from jsonb_each_text(p_items) x where length(x.key) not between 1 and 100
      or x.value !~ '^[0-9]{1,4}(\.[0-9]{1,3})?$' or x.value::numeric<=0 or x.value::numeric>9999) then
    raise exception 'Некорректный закрытый чек или время кассы' using errcode='22023';
  end if;
  select * into previous from front_offline_receipts where branch_id=p_branch and receipt_id=p_receipt;
  if found then
    if previous.items<>p_items or previous.receipt_total<>p_total then
      raise exception 'Ранее переданный закрытый чек изменился. Требуется сверка.' using errcode='P0001';
    end if;
    return previous.result || jsonb_build_object('duplicate',true);
  end if;
  if exists(select 1 from front_stock_sales where branch_id=p_branch and receipt_id=p_receipt)
    or exists(select 1 from front_receipt_jobs where branch_id=p_branch and receipt_id=p_receipt) then
    result:=jsonb_build_object('status','recorded','changed',false,'reason','already_accounted');
  else
    for item in select key,value::numeric quantity from jsonb_each_text(p_items) order by key loop
      select * into stock from branch_product_inventory where branch_id=p_branch and product_id=item.key for update;
      -- iiko-managed quantities arrive as absolute snapshots. Never subtract the
      -- same sale again from those snapshots, nor invent a quantity for unknown goods.
      if stock.source_quantity is null or stock.source not in ('admin','custom') or p_closed_at<=stock.manual_counted_at then continue; end if;
      select coalesce(sum(quantity),0) into held from inventory_reservations where branch_id=p_branch and product_id=item.key
        and allocation_kind='display' and (status='committed' or status='active' and expires_at>now());
      shortage:=shortage or stock.source_quantity-item.quantity<held;
      perform set_config('bulka.front_guard_write','true',true);
      perform set_config('bulka.stock_follow_iiko','true',true);
      update branch_product_inventory set source_quantity=greatest(0,source_quantity-item.quantity),updated_at=now()
        where branch_id=p_branch and product_id=item.key;
      changed:=changed+1;
    end loop;
    result:=jsonb_build_object('status','recorded','changed',changed>0,'shortage',shortage);
  end if;
  insert into front_offline_receipts(branch_id,receipt_id,terminal_id,closed_at,items,receipt_total,result)
    values(p_branch,p_receipt,p_terminal,p_closed_at,p_items,p_total,result);
  return result;
end;
$$;
revoke all on function public.update_cashier_inventory_before_receipts(uuid,text,text,bigint,jsonb),
  public.update_admin_inventory_before_receipts(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.update_cashier_inventory(uuid,text,text,bigint,jsonb),public.update_admin_inventory(jsonb),
  public.record_front_offline_receipt(uuid,uuid,uuid,timestamptz,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.update_cashier_inventory(uuid,text,text,bigint,jsonb),public.update_admin_inventory(jsonb),
  public.record_front_offline_receipt(uuid,uuid,uuid,timestamptz,jsonb,numeric) to service_role;

-- One product unit across all branches. Ambiguous legacy stock is left intact
-- until an administrator resolves it; no stock or report quantity is converted.
create table public.product_inventory_units (
  product_id text primary key check(length(product_id) between 1 and 100),
  unit text check(unit in ('шт','кг')),
  configured boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  check(not configured or unit is not null)
);
alter table public.product_inventory_units enable row level security;
revoke all on public.product_inventory_units from public,anon,authenticated,service_role;
grant select on public.product_inventory_units to service_role;
insert into public.product_inventory_units(product_id,unit)
  select product_id,case when count(distinct unit)=1 and min(unit) in ('шт','кг')
    and bool_and(quantity_step=case when unit='кг' then 0.001 else 1 end) then min(unit) end
  from public.branch_product_inventory group by product_id;
-- A released/expired reservation may be reactivated by late payment recovery.
-- Its original quantity must never acquire the product's later unit.
create table public.inventory_reservation_units (
  reservation_id uuid primary key references public.inventory_reservations(id) on delete cascade,
  unit text not null,
  created_at timestamptz not null default now()
);
alter table public.inventory_reservation_units enable row level security;
revoke all on public.inventory_reservation_units from public,anon,authenticated,service_role;
grant select on public.inventory_reservation_units to service_role;
-- INSERT snapshot metadata separately: UPDATE of business reservations would
-- invoke their existing stock guards, including for expired legacy rows.
insert into public.inventory_reservation_units(reservation_id,unit)
  select r.id,coalesce(i.unit,u.unit,'шт') from public.inventory_reservations r
  left join public.branch_product_inventory i on i.branch_id=r.branch_id and i.product_id=r.product_id
  left join public.product_inventory_units u on u.product_id=r.product_id;

create function public.ensure_product_inventory_unit(p_product text) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen text;
begin
  if p_product is null or length(p_product) not between 1 and 100 then
    raise exception 'Не указан товар' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('product-inventory-unit:'||p_product,0));
  insert into public.product_inventory_units(product_id,unit) values(p_product,'шт')
    on conflict(product_id) do nothing;
  select unit into chosen from public.product_inventory_units where product_id=p_product;
  return chosen;
end;
$$;

create function public.get_product_inventory_unit(p_product text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select jsonb_build_object('unit',unit,'configured',configured)
    from public.product_inventory_units where product_id=p_product),
    jsonb_build_object('unit','шт','configured',false));
$$;

create function public.set_product_inventory_unit(p_product text,p_unit text,p_actor text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous text; stock public.branch_product_inventory%rowtype;
begin
  if p_unit is null or p_unit not in ('шт','кг') or nullif(trim(p_actor),'') is null then
    raise exception 'Выберите единицу: шт или кг' using errcode='22023';
  end if;
  previous:=public.ensure_product_inventory_unit(p_product);
  -- Lock every existing branch row before checking live balances. Writers and
  -- new reservations also hold the same product advisory lock in their triggers.
  for stock in select * from public.branch_product_inventory
    where product_id=p_product order by branch_id for update nowait loop
    if (stock.unit is distinct from p_unit or stock.quantity_step is distinct from case when p_unit='кг' then 0.001 else 1 end) and
      (coalesce(stock.source_quantity,0)<>0 or coalesce(stock.front_quantity,0)<>0) then
      raise exception 'Сначала обнулите остатки товара в филиалах с другой единицей. Количество не пересчитывается.'
        using errcode='P0001';
    end if;
  end loop;
  if exists(select 1 from public.inventory_reservations r
    left join public.branch_product_inventory i on i.branch_id=r.branch_id and i.product_id=r.product_id
    left join public.inventory_reservation_units u on u.reservation_id=r.id
    where r.product_id=p_product and (r.status='committed' or r.status='active' and r.expires_at>now())
      and (i.unit is distinct from p_unit or u.unit is distinct from p_unit or previous is not null and previous<>p_unit))
    or exists(select 1 from public.front_stock_sales s
      where s.status='reserved' and s.items ? p_product
        and (previous is distinct from p_unit or exists(select 1 from public.branch_product_inventory i
          where i.branch_id=s.branch_id and i.product_id=p_product and i.unit is distinct from p_unit))) then
    raise exception 'Нельзя менять единицу товара, пока есть активные заказы или незавершённые чеки'
      using errcode='P0001';
  end if;
  update public.product_inventory_units set unit=p_unit,configured=true,
    updated_by=left(p_actor,160),updated_at=now() where product_id=p_product;
  -- Only empty incompatible rows change their label/step. Advancing revision
  -- rejects stale counts; advancing the count watermark rejects old offline sales.
  update public.branch_product_inventory set unit=p_unit,
    quantity_step=case when p_unit='кг' then 0.001 else 1 end,
    stock_revision=stock_revision+1,manual_counted_at=now(),updated_at=now()
    where product_id=p_product and
      (unit is distinct from p_unit or quantity_step is distinct from case when p_unit='кг' then 0.001 else 1 end);
  return public.get_product_inventory_unit(p_product);
end;
$$;

-- Omitted INSERT metadata must be distinguishable from explicitly supplied
-- metadata. BEFORE triggers fill the canonical value before NOT NULL checks.
alter table public.branch_product_inventory alter column unit drop default,
  alter column quantity_step drop default;
create function public.enforce_product_inventory_unit() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen text; expected_step numeric;
begin
  chosen:=public.ensure_product_inventory_unit(new.product_id);
  if chosen is null then
    -- Legacy disagreement can be cleared in its existing unit, but never relabelled.
    if tg_op='INSERT' then
      select unit,quantity_step into new.unit,new.quantity_step from public.branch_product_inventory
        where branch_id=new.branch_id and product_id=new.product_id;
      if not found then
        raise exception 'Администратор должен выбрать общую единицу товара' using errcode='P0001';
      end if;
    elsif new.unit is distinct from old.unit or new.quantity_step is distinct from old.quantity_step then
      raise exception 'Единицу товара для всех филиалов задаёт администратор' using errcode='P0001';
    end if;
    return new;
  end if;
  expected_step:=case when chosen='кг' then 0.001 else 1 end;
  if new.unit is not null and new.unit<>chosen
    or new.quantity_step is not null and new.quantity_step<>expected_step then
    raise exception 'Единицу товара для всех филиалов задаёт администратор. Обновите каталог.' using errcode='P0001';
  end if;
  new.unit:=chosen;
  new.quantity_step:=expected_step;
  if new.source_quantity is not null and mod(new.source_quantity,expected_step)<>0
    or new.front_quantity is not null and mod(new.front_quantity,expected_step)<>0 then
    raise exception 'Количество не соответствует общей единице товара' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger aa_product_inventory_unit before insert or update on public.branch_product_inventory
  for each row execute function public.enforce_product_inventory_unit();

create function public.lock_reservation_product_inventory_unit() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen text; original text;
begin
  if new.status='committed' or new.status='active' and new.expires_at>now() then
    chosen:=public.ensure_product_inventory_unit(new.product_id);
    if chosen is null then
      raise exception 'Администратор должен выбрать общую единицу товара' using errcode='P0001';
    end if;
    if tg_op='UPDATE' then
      select unit into original from public.inventory_reservation_units where reservation_id=old.id;
      if original is distinct from chosen then
        raise exception 'Единица товара изменилась после создания резерва. Требуется проверка заказа.' using errcode='P0001';
      end if;
    end if;
    if mod(new.quantity,case when chosen='кг' then 0.001 else 1 end)<>0 then
      raise exception 'Количество не соответствует общей единице товара' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger aa_reservation_product_inventory_unit before insert or update on public.inventory_reservations
  for each row execute function public.lock_reservation_product_inventory_unit();
create function public.record_reservation_inventory_unit() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen text;
begin
  chosen:=public.ensure_product_inventory_unit(new.product_id);
  if chosen is null then
    select unit into chosen from public.branch_product_inventory
      where branch_id=new.branch_id and product_id=new.product_id;
  end if;
  insert into public.inventory_reservation_units(reservation_id,unit)
    values(new.id,coalesce(chosen,'шт'));
  return new;
end;
$$;
create trigger record_reservation_inventory_unit after insert on public.inventory_reservations
  for each row execute function public.record_reservation_inventory_unit();

-- Wrap the current receipt/idempotency implementation instead of replacing it.
alter function public.update_cashier_inventory(uuid,text,text,bigint,jsonb)
  rename to update_cashier_inventory_before_global_unit;
create function public.update_cashier_inventory(p_branch_id uuid,p_product_id text,p_product_name text,
  p_expected_revision bigint,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen text; existing text; prior public.cashier_inventory_mutations%rowtype;
begin
  chosen:=public.ensure_product_inventory_unit(p_product_id);
  -- A retry of an already committed arrival is not a unit change. Preserve
  -- the original operation identity even if an administrator changed the unit
  -- after the stock was subsequently cleared. The old RPC validates all fields
  -- and returns current stock without adding the arrival a second time.
  if p_changes ? 'operationId' then
    begin
      select * into prior from public.cashier_inventory_mutations
        where operation_id=(p_changes->>'operationId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Некорректный номер операции' using errcode='22023';
    end;
    if prior.operation_id is not null and prior.branch_id=p_branch_id and prior.product_id=p_product_id then
      return public.update_cashier_inventory_before_global_unit(p_branch_id,p_product_id,p_product_name,
        p_expected_revision,case when p_changes ? 'unit' then p_changes
          else p_changes||jsonb_build_object('unit',prior.requested_unit) end);
    end if;
  end if;
  select unit into existing from public.branch_product_inventory
    where branch_id=p_branch_id and product_id=p_product_id;
  if chosen is null then
    chosen:=existing;
    if chosen is null or p_changes ? 'sourceQuantity' and
      not (p_changes->>'stockReason'='correction' and p_changes->>'sourceQuantity'='0') then
      raise exception 'В филиалах разные единицы. Администратор должен выбрать общую единицу товара'
        using errcode='P0001';
    end if;
  end if;
  if p_changes ? 'unit' and p_changes->>'unit' is distinct from chosen then
    raise exception 'Единицу товара для всех филиалов задаёт администратор. Обновите каталог.' using errcode='P0001';
  end if;
  -- Omitting unit remains supported; insert paths and receipts use the global value.
  if p_changes ? 'sourceQuantity' then
    p_changes:=p_changes||jsonb_build_object('unit',chosen);
  end if;
  return public.update_cashier_inventory_before_global_unit(
    p_branch_id,p_product_id,p_product_name,p_expected_revision,p_changes);
end;
$$;

alter function public.apply_front_inventory_snapshot(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb)
  rename to apply_front_inventory_snapshot_before_global_unit;
create function public.apply_front_inventory_snapshot(p_branch_id uuid,p_terminal_id uuid,
  p_terminal_group_id uuid,p_session_id uuid,p_sequence bigint,p_captured_at timestamptz,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; chosen text; step numeric; clean jsonb:='[]';
begin
  if p_items is null or jsonb_typeof(p_items)<>'array' then
    raise exception 'Некорректные данные остатков' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_items) order by value->>'productId' loop
    chosen:=public.ensure_product_inventory_unit(item->>'productId');
    if chosen is null then
      select unit into chosen from public.branch_product_inventory
        where branch_id=p_branch_id and product_id=item->>'productId';
    end if;
    step:=case when chosen='кг' then 0.001 else 1 end;
    if chosen is null or item ? 'unit' and item->>'unit' is distinct from chosen
      or item ? 'quantityStep' and (item->>'quantityStep')::numeric is distinct from step then
      raise exception 'Единица iiko не совпадает с общей единицей товара. Требуется проверка администратора.'
        using errcode='P0001';
    end if;
    clean:=clean||jsonb_build_array(item||jsonb_build_object('unit',chosen,'quantityStep',step));
  end loop;
  return public.apply_front_inventory_snapshot_before_global_unit(
    p_branch_id,p_terminal_id,p_terminal_group_id,p_session_id,p_sequence,p_captured_at,clean);
end;
$$;

alter function public.update_admin_inventory(jsonb) rename to update_admin_inventory_before_global_unit;
create function public.update_admin_inventory(p_stock jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen text; step numeric; branch uuid:=(p_stock->>'branch_id')::uuid;
begin
  chosen:=public.ensure_product_inventory_unit(p_stock->>'product_id');
  if chosen is null then
    select unit into chosen from public.branch_product_inventory
      where branch_id=branch and product_id=p_stock->>'product_id';
  end if;
  step:=case when chosen='кг' then 0.001 else 1 end;
  if chosen is null or p_stock ? 'unit' and p_stock->>'unit' is distinct from chosen
    or p_stock ? 'quantity_step' and (p_stock->>'quantity_step')::numeric is distinct from step then
    raise exception 'Единицу товара для всех филиалов задаёт администратор' using errcode='P0001';
  end if;
  perform id from public.bulka_locations where id=branch and active for update;
  if not found then raise exception 'Филиал больше недоступен' using errcode='P0001'; end if;
  insert into public.branch_product_inventory(branch_id,product_id,product_name,source,unit,quantity_step)
    values(branch,p_stock->>'product_id',left(p_stock->>'product_name',160),'admin',chosen,step)
    on conflict(branch_id,product_id) do nothing;
  return public.update_admin_inventory_before_global_unit(p_stock);
end;
$$;

-- Service-only internals cannot be used as alternate unit-changing endpoints.
revoke all on function public.ensure_product_inventory_unit(text),
  public.enforce_product_inventory_unit(),public.lock_reservation_product_inventory_unit(),
  public.record_reservation_inventory_unit(),
  public.update_cashier_inventory_before_global_unit(uuid,text,text,bigint,jsonb),
  public.update_admin_inventory_before_global_unit(jsonb),
  public.apply_front_inventory_snapshot_before_global_unit(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.get_product_inventory_unit(text),public.set_product_inventory_unit(text,text,text),
  public.update_cashier_inventory(uuid,text,text,bigint,jsonb),
  public.update_admin_inventory(jsonb),
  public.apply_front_inventory_snapshot(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb)
  from public,anon,authenticated;
grant execute on function public.get_product_inventory_unit(text),public.set_product_inventory_unit(text,text,text),
  public.update_cashier_inventory(uuid,text,text,bigint,jsonb),
  public.update_admin_inventory(jsonb),
  public.apply_front_inventory_snapshot(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb) to service_role;

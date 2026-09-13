-- Cashier receipts are increments, while corrections are absolute physical counts.
-- A client operation id makes a retry safe after a lost or timed-out response.
create table public.cashier_inventory_mutations (
  operation_id uuid primary key,
  branch_id uuid not null references public.bulka_locations(id),
  product_id text not null,
  reason text not null check(reason in ('receipt','correction')),
  requested_quantity numeric(14,3) not null,
  requested_unit text not null check(requested_unit in ('шт','кг')),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index cashier_inventory_mutations_branch_date
  on public.cashier_inventory_mutations(branch_id,created_at,operation_id);
alter table public.cashier_inventory_mutations enable row level security;
revoke all on public.cashier_inventory_mutations from public,anon,authenticated;
grant select,insert on public.cashier_inventory_mutations to service_role;

alter function public.update_cashier_inventory(uuid,text,text,bigint,jsonb)
  rename to update_cashier_inventory_before_delta;

create function public.update_cashier_inventory(
  p_branch_id uuid,
  p_product_id text,
  p_product_name text,
  p_expected_revision bigint,
  p_changes jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  previous_mutation public.cashier_inventory_mutations%rowtype;
  stock public.branch_product_inventory%rowtype;
  result jsonb;
  clean_changes jsonb;
  requested_reason text;
  requested_quantity numeric;
  requested_unit text;
  requested_step numeric;
  previous_quantity numeric;
  target_quantity numeric;
  effective_revision bigint;
  requested_operation_id uuid;
  operation_key text;
  unit_changed boolean:=false;
  stock_exists boolean:=false;
  stock_was_missing boolean:=false;
begin
  if p_changes is null or jsonb_typeof(p_changes)<>'object' then
    raise exception 'Некорректные данные остатка' using errcode='22023';
  end if;
  if not p_changes ? 'sourceQuantity' then
    if p_changes ? 'stockReason' or p_changes ? 'operationId' or p_changes ? 'unit' then
      raise exception 'Причина, единица и номер операции указываются только с количеством'
        using errcode='22023';
    end if;
    return public.update_cashier_inventory_before_report(
      p_branch_id,p_product_id,p_product_name,p_expected_revision,p_changes
    );
  end if;

  requested_reason:=p_changes->>'stockReason';
  if requested_reason is null or requested_reason not in ('receipt','correction') then
    raise exception 'Выберите причину изменения остатка' using errcode='22023';
  end if;
  if jsonb_typeof(p_changes->'sourceQuantity') is distinct from 'number'
    or (p_changes->>'sourceQuantity') !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$' then
    raise exception 'Введите корректное количество' using errcode='22023';
  end if;
  requested_quantity:=(p_changes->>'sourceQuantity')::numeric;

  if p_changes ? 'operationId' then
    if jsonb_typeof(p_changes->'operationId')<>'string' then
      raise exception 'Некорректный номер операции' using errcode='22023';
    end if;
    begin
      requested_operation_id:=(p_changes->>'operationId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Некорректный номер операции' using errcode='22023';
    end;
    perform pg_advisory_xact_lock(
      hashtextextended('cashier-stock:'||requested_operation_id::text,0)
    );
  end if;

  perform id from public.bulka_locations where id=p_branch_id and active for update;
  if not found then
    raise exception 'Филиал больше недоступен' using errcode='P0001';
  end if;
  select * into stock from public.branch_product_inventory
    where branch_id=p_branch_id and product_id=p_product_id for update;
  stock_exists:=found;
  stock_was_missing:=not stock_exists;
  previous_quantity:=stock.source_quantity;
  requested_unit:=coalesce(nullif(p_changes->>'unit',''),nullif(stock.unit,''),'шт');
  if requested_unit not in ('шт','кг') then
    raise exception 'Выберите единицу: шт или кг' using errcode='22023';
  end if;
  requested_step:=case when requested_unit='кг' then 0.001 else 1 end;
  if mod(requested_quantity,requested_step)<>0 then
    raise exception using errcode='22023', message=case when requested_unit='шт'
      then 'Количество в штуках должно быть целым'
      else 'Вес указывается с точностью до 0,001 кг' end;
  end if;

  if requested_operation_id is not null then
    select * into previous_mutation from public.cashier_inventory_mutations
      where operation_id=requested_operation_id;
    if found then
      if previous_mutation.branch_id is distinct from p_branch_id
        or previous_mutation.product_id is distinct from p_product_id
        or previous_mutation.reason is distinct from requested_reason
        or previous_mutation.requested_quantity is distinct from requested_quantity
        or previous_mutation.requested_unit is distinct from requested_unit then
        raise exception 'Номер операции уже использован для другого изменения'
          using errcode='P0001';
      end if;
      select * into stock from public.branch_product_inventory
        where branch_id=p_branch_id and product_id=p_product_id;
      return previous_mutation.result||coalesce(to_jsonb(stock),'{}'::jsonb)
        || jsonb_build_object('duplicate',true,'operationId',requested_operation_id);
    end if;
  end if;

  if not stock_exists then
    insert into public.branch_product_inventory(
      branch_id,product_id,product_name,source_quantity,source,quantity_step,unit
    ) values(
      p_branch_id,p_product_id,left(p_product_name,160),null,
      case when exists(
        select 1 from public.custom_products where id::text=p_product_id
      ) then 'admin' else 'iiko' end,
      requested_step,requested_unit
    )
    on conflict(branch_id,product_id) do nothing;
    select * into stock from public.branch_product_inventory
      where branch_id=p_branch_id and product_id=p_product_id for update;
    if not found then
      raise exception 'Не удалось создать остаток товара' using errcode='P0001';
    end if;
    stock_exists:=true;
    if stock.source_quantity is not null then
      stock_was_missing:=false;
      previous_quantity:=stock.source_quantity;
    end if;
  end if;

  unit_changed:=not stock_was_missing and stock.unit is distinct from requested_unit;
  if unit_changed and requested_reason='receipt' then
    raise exception 'При смене единицы укажите фактический остаток через «Исправили»'
      using errcode='P0001';
  end if;
  if unit_changed and exists(
    select 1 from public.inventory_reservations
      where branch_id=p_branch_id and product_id=p_product_id
        and (status='committed' or status='active' and expires_at>now())
  ) then
    raise exception 'Нельзя менять единицу товара, пока по нему есть активные заказы'
      using errcode='P0001';
  end if;

  if requested_reason='receipt' then
    if requested_quantity<=0 then
      raise exception 'Укажите, сколько товара добавили' using errcode='22023';
    end if;
    target_quantity:=coalesce(previous_quantity,0)+requested_quantity;
    -- New clients identify the operation, so concurrent additions can safely
    -- apply to the latest locked balance. Legacy clients retain revision
    -- protection so retrying an uncertain request cannot add twice.
    if requested_operation_id is null then
      effective_revision:=p_expected_revision;
      if stock_exists and stock.stock_revision is distinct from p_expected_revision then
        raise exception 'Остаток уже изменился. Проверьте новые данные и повторите сохранение.'
          using errcode='40001';
      end if;
    else
      effective_revision:=coalesce(stock.stock_revision,p_expected_revision,0);
    end if;
  else
    target_quantity:=requested_quantity;
    effective_revision:=p_expected_revision;
    if stock_exists and stock.stock_revision is distinct from p_expected_revision then
      raise exception 'Остаток уже изменился. Проверьте новые данные и повторите сохранение.'
        using errcode='40001';
    end if;
  end if;
  if target_quantity<0 or target_quantity>100000 then
    raise exception 'Итоговый остаток должен быть от 0 до 100000' using errcode='22023';
  end if;

  if stock_was_missing then
    effective_revision:=stock.stock_revision;
  elsif unit_changed then
    perform set_config('bulka.front_guard_write','true',true);
    update public.branch_product_inventory set
      unit=requested_unit,quantity_step=requested_step,updated_at=now()
      where branch_id=p_branch_id and product_id=p_product_id
      returning * into stock;
    effective_revision:=stock.stock_revision;
  end if;

  clean_changes:=jsonb_build_object('sourceQuantity',target_quantity);
  result:=public.update_cashier_inventory_before_report(
    p_branch_id,p_product_id,p_product_name,effective_revision,clean_changes
  );
  select * into stock from public.branch_product_inventory
    where branch_id=p_branch_id and product_id=p_product_id;

  operation_key:=case when requested_operation_id is not null
    then 'cashier:'||requested_operation_id::text
    else 'cashier-legacy:'||p_branch_id::text||':'||p_product_id||':'||p_expected_revision::text end;
  perform public.record_display_stock_change(
    p_branch_id,p_product_id,
    case
      when unit_changed then null
      when requested_reason='receipt' then coalesce(previous_quantity,0)
      else previous_quantity
    end,
    'cashier',operation_key,requested_reason
  );
  result:=to_jsonb(stock)||jsonb_build_object(
    'beforeQuantity',previous_quantity,
    'afterQuantity',stock.source_quantity,
    'addedQuantity',case when requested_reason='receipt' then requested_quantity else 0 end,
    'operationId',requested_operation_id,
    'duplicate',false
  );
  if requested_operation_id is not null then
    insert into public.cashier_inventory_mutations(
      operation_id,branch_id,product_id,reason,requested_quantity,requested_unit,result
    ) values(
      requested_operation_id,p_branch_id,p_product_id,requested_reason,requested_quantity,requested_unit,result
    );
  end if;
  return result;
end;
$$;

revoke all on function public.update_cashier_inventory_before_delta(uuid,text,text,bigint,jsonb),
  public.update_cashier_inventory(uuid,text,text,bigint,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.update_cashier_inventory(uuid,text,text,bigint,jsonb)
  to service_role;

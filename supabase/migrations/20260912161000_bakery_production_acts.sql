-- Production arrivals are idempotent, branch-bound and update customer stock in one transaction.
-- migration-safety: allow-destructive reason=replace the source check with the same values plus bakery; no rows or columns are removed
alter table public.display_stock_changes drop constraint if exists display_stock_changes_source_check;
alter table public.display_stock_changes add constraint display_stock_changes_source_check
  check(source in ('cashier','admin','recount','bakery'));

create table public.pos_production_acts (
  request_id uuid primary key,
  branch_id uuid not null references public.bulka_locations(id),
  terminal_id uuid not null references public.pos_devices(terminal_id),
  product_id varchar(100) not null,
  product_name varchar(160) not null,
  quantity numeric(12,3) not null check(quantity>0 and quantity<=100000),
  quantity_step numeric(4,3) not null check(quantity_step in (1,0.001)),
  unit text not null check(length(unit) between 1 and 16),
  before_quantity numeric(12,3) not null,
  after_quantity numeric(12,3) not null,
  created_at timestamptz not null default clock_timestamp()
);
create index pos_production_acts_branch_date
  on public.pos_production_acts(branch_id,created_at,request_id);
alter table public.pos_production_acts enable row level security;
revoke all on public.pos_production_acts from public,anon,authenticated;
grant select,insert on public.pos_production_acts to service_role;

create function public.record_pos_production(
  p_branch uuid,p_terminal uuid,p_request uuid,p_product text,p_product_name text,
  p_quantity numeric,p_quantity_step numeric,p_unit text
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous_act pos_production_acts%rowtype; stock branch_product_inventory%rowtype;
  before_amount numeric; after_amount numeric; created_time timestamptz;
begin
  if p_request is null or p_product is null or length(p_product) not between 1 and 100
    or p_product_name is null or length(trim(p_product_name)) not between 1 and 160
    or p_quantity is null or p_quantity<=0 or p_quantity>100000
    or p_quantity_step not in (1,0.001) or mod(p_quantity,p_quantity_step)<>0
    or p_unit is null or length(trim(p_unit)) not between 1 and 16 then
    raise exception 'Некорректный акт приготовления' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pos-production:'||p_request::text,0));
  select * into previous_act from pos_production_acts where request_id=p_request;
  if found then
    if previous_act.branch_id is distinct from p_branch
      or previous_act.terminal_id is distinct from p_terminal
      or previous_act.product_id is distinct from p_product
      or previous_act.quantity is distinct from p_quantity then
      raise exception 'Идентификатор акта уже использован для других данных' using errcode='P0001';
    end if;
    return jsonb_build_object(
      'requestId',previous_act.request_id,'productId',previous_act.product_id,
      'productName',previous_act.product_name,'quantity',previous_act.quantity,
      'quantityStep',previous_act.quantity_step,'unit',previous_act.unit,
      'beforeQuantity',previous_act.before_quantity,'afterQuantity',previous_act.after_quantity,
      'createdAt',previous_act.created_at,'duplicate',true
    );
  end if;
  perform 1 from bulka_locations where id=p_branch and active for update;
  if not found or not exists(
    select 1 from pos_devices where terminal_id=p_terminal and branch_id=p_branch
      and active and device_role='bakery'
  ) then
    raise exception 'Терминал пекарни не привязан к этому филиалу' using errcode='P0001';
  end if;
  update pos_devices set last_seen_at=now() where terminal_id=p_terminal;
  select * into stock from branch_product_inventory
    where branch_id=p_branch and product_id=p_product for update;
  if not found then
    insert into branch_product_inventory(
      branch_id,product_id,product_name,source_quantity,source,manual_stop,quantity_step,unit
    ) values(
      p_branch,p_product,left(trim(p_product_name),160),0,'admin',false,p_quantity_step,trim(p_unit)
    );
    select * into stock from branch_product_inventory
      where branch_id=p_branch and product_id=p_product for update;
  end if;
  if stock.quantity_step is distinct from p_quantity_step or mod(p_quantity,stock.quantity_step)<>0 then
    raise exception 'Количество не соответствует единице товара' using errcode='22023';
  end if;
  before_amount:=coalesce(stock.source_quantity,0);
  after_amount:=before_amount+p_quantity;
  if after_amount>100000 then
    raise exception 'Итоговый остаток превышает допустимый предел' using errcode='22023';
  end if;
  perform set_config('bulka.front_guard_write','true',true);
  update branch_product_inventory set source_quantity=after_amount,source='admin',manual_stop=false,
    product_name=left(trim(p_product_name),160),unit=trim(p_unit),updated_at=now()
    where branch_id=p_branch and product_id=p_product returning * into stock;
  perform record_display_stock_change(
    p_branch,p_product,before_amount,'bakery','production:'||p_request::text,'receipt'
  );
  insert into pos_production_acts(
    request_id,branch_id,terminal_id,product_id,product_name,quantity,quantity_step,unit,
    before_quantity,after_quantity
  ) values(
    p_request,p_branch,p_terminal,p_product,left(trim(p_product_name),160),p_quantity,
    p_quantity_step,trim(p_unit),before_amount,after_amount
  ) returning created_at into created_time;
  return jsonb_build_object(
    'requestId',p_request,'productId',p_product,'productName',left(trim(p_product_name),160),
    'quantity',p_quantity,'quantityStep',p_quantity_step,'unit',trim(p_unit),
    'beforeQuantity',before_amount,'afterQuantity',after_amount,
    'createdAt',created_time,'duplicate',false
  );
end;
$$;

revoke all on function public.record_pos_production(uuid,uuid,uuid,text,text,numeric,numeric,text)
  from public,anon,authenticated;
grant execute on function public.record_pos_production(uuid,uuid,uuid,text,text,numeric,numeric,text)
  to service_role;

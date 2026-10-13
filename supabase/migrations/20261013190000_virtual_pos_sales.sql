-- Only the authenticated backend may access POS snapshots and durable sale commands.
create table if not exists public.virtual_pos_terminals (
  branch_id uuid primary key references public.bulka_locations(id),
  terminal_id uuid not null references public.pos_devices(terminal_id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.virtual_pos_snapshots (
  terminal_id uuid primary key references public.pos_devices(terminal_id),
  branch_id uuid not null references public.bulka_locations(id),
  snapshot jsonb not null,
  received_at timestamptz not null default now()
);
create table if not exists public.virtual_pos_sales (
  id uuid primary key,
  request_id uuid not null,
  actor_id text not null check(length(actor_id) between 1 and 200),
  branch_id uuid not null references public.bulka_locations(id),
  terminal_id uuid not null references public.pos_devices(terminal_id),
  request_payload jsonb not null,
  snapshot_revision text not null,
  cash_shift_id uuid not null,
  payment_type_id uuid not null,
  items jsonb not null,
  total numeric(14,2) not null check(total > 0),
  status text not null default 'queued' check(status in (
    'queued','claimed','creating','created','payment_started','completed','rejected','needs_reconciliation'
  )),
  lease_token uuid,
  lease_expires_at timestamptz,
  front_order_id uuid,
  front_order_number text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(actor_id,request_id)
);
-- A definite preflight rejection permanently consumes its immutable request key.
-- Another browser tab cannot revive an old rejected intent after catalog recovery.
create table if not exists public.virtual_pos_rejected_requests (
  request_id uuid primary key,
  actor_id text not null check(length(actor_id) between 1 and 200),
  branch_id uuid not null references public.bulka_locations(id),
  request_payload jsonb not null,
  rejection jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists virtual_pos_sales_terminal_queue_idx
  on public.virtual_pos_sales(branch_id,terminal_id,created_at)
  where status not in ('completed','rejected');
alter table public.virtual_pos_terminals enable row level security;
alter table public.virtual_pos_snapshots enable row level security;
alter table public.virtual_pos_sales enable row level security;
alter table public.virtual_pos_rejected_requests enable row level security;
revoke all on public.virtual_pos_terminals,public.virtual_pos_snapshots,public.virtual_pos_sales,public.virtual_pos_rejected_requests from public,anon,authenticated;
grant select,insert,update,delete on public.virtual_pos_terminals,public.virtual_pos_snapshots,public.virtual_pos_sales,public.virtual_pos_rejected_requests to service_role;

create or replace function public.virtual_pos_sale_result(p_sale public.virtual_pos_sales)
returns jsonb language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_sale.id,'status',p_sale.status,'total',p_sale.total,
    'frontOrderId',p_sale.front_order_id,'frontOrderNumber',p_sale.front_order_number,
    'cashShiftId',p_sale.cash_shift_id,'error',p_sale.error)
$$;

create or replace function public.virtual_pos_terminal_allowed(p_branch uuid,p_terminal uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from virtual_pos_terminals c join pos_devices d on d.terminal_id=c.terminal_id
    join bulka_locations b on b.id=c.branch_id
    where c.branch_id=p_branch and c.terminal_id=p_terminal and c.enabled
      and d.branch_id=p_branch and d.active and d.device_role='register' and b.active)
$$;

create or replace function public.virtual_pos_record_rejection(p_branch uuid,p_actor text,p_request jsonb,p_rejection jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into virtual_pos_rejected_requests(request_id,actor_id,branch_id,request_payload,rejection)
    values((p_request->>'requestId')::uuid,p_actor,p_branch,p_request,p_rejection);
  return p_rejection;
end;
$$;

create or replace function public.publish_virtual_pos_snapshot(p_branch uuid,p_terminal uuid,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from virtual_pos_terminals where branch_id=p_branch for update;
  if not virtual_pos_terminal_allowed(p_branch,p_terminal) then
    return jsonb_build_object('error','VIRTUAL_POS_TERMINAL_FORBIDDEN','message','Касса не подключена к филиалу','status',403);
  end if;
  if p_snapshot->>'terminalId' <> p_terminal::text then
    return jsonb_build_object('error','VIRTUAL_POS_INVALID_SNAPSHOT','status',400);
  end if;
  insert into virtual_pos_snapshots(terminal_id,branch_id,snapshot,received_at)
    values(p_terminal,p_branch,p_snapshot,clock_timestamp())
    on conflict(terminal_id) do update set branch_id=excluded.branch_id,snapshot=excluded.snapshot,received_at=excluded.received_at;
  return jsonb_build_object('revision',p_snapshot->>'revision');
end;
$$;

create or replace function public.create_virtual_pos_sale(p_branch uuid,p_actor text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare existing virtual_pos_sales%rowtype; rejected virtual_pos_rejected_requests%rowtype; snap virtual_pos_snapshots%rowtype;
  terminal uuid:=(p_request->>'terminalId')::uuid; v_request_id uuid:=(p_request->>'requestId')::uuid;
  payment jsonb; product jsonb; item jsonb; lines jsonb:='[]';
  qty numeric; price numeric; step numeric; line_total numeric; amount numeric:=0;
begin
  -- Serialize identical UUID requests before reading the authoritative snapshot.
  perform pg_advisory_xact_lock(hashtextextended('virtual-pos-request:'||v_request_id::text,0));
  select * into existing from virtual_pos_sales where id=v_request_id;
  if found then
    if existing.actor_id is distinct from p_actor or existing.branch_id is distinct from p_branch
      or existing.request_payload is distinct from p_request then
      return jsonb_build_object('error','VIRTUAL_POS_IDEMPOTENCY_CONFLICT','message','Запрос уже использован для другой продажи','status',409);
    end if;
    return jsonb_build_object('sale',virtual_pos_sale_result(existing));
  end if;
  select * into rejected from virtual_pos_rejected_requests where request_id=v_request_id;
  if found then
    if rejected.actor_id is distinct from p_actor or rejected.branch_id is distinct from p_branch
      or rejected.request_payload is distinct from p_request then
      return jsonb_build_object('error','VIRTUAL_POS_IDEMPOTENCY_CONFLICT','message','Запрос уже использован для другой продажи','status',409);
    end if;
    return rejected.rejection;
  end if;
  perform 1 from virtual_pos_terminals where branch_id=p_branch for update;
  if not virtual_pos_terminal_allowed(p_branch,terminal) then
    return virtual_pos_record_rejection(p_branch,p_actor,p_request,jsonb_build_object('error','VIRTUAL_POS_TERMINAL_FORBIDDEN','message','Касса не подключена к филиалу','status',403,'safelyRejected',true));
  end if;
  select * into snap from virtual_pos_snapshots where terminal_id=terminal and branch_id=p_branch for update;
  if not found or snap.received_at<clock_timestamp()-interval '45 seconds' then
    return virtual_pos_record_rejection(p_branch,p_actor,p_request,jsonb_build_object('error','VIRTUAL_POS_OFFLINE','message','Нет свежего каталога кассы','safelyRejected',true));
  end if;
  if snap.snapshot->>'revision' is distinct from p_request->>'snapshotRevision' then
    return virtual_pos_record_rejection(p_branch,p_actor,p_request,jsonb_build_object('error','VIRTUAL_POS_STALE_CATALOG','message','Каталог изменился. Обновите корзину','safelyRejected',true));
  end if;
  if not coalesce((snap.snapshot#>>'{profile,nonFiscalNoPaperVerified}')::boolean,false) then
    return virtual_pos_record_rejection(p_branch,p_actor,p_request,jsonb_build_object('error','VIRTUAL_POS_PROFILE_UNVERIFIED','message','Режим без печати не подтверждён','safelyRejected',true));
  end if;
  if not coalesce((snap.snapshot#>>'{cashShift,isOpen}')::boolean,false)
    or snap.snapshot#>>'{cashShift,id}' is distinct from p_request->>'cashShiftId' then
    return virtual_pos_record_rejection(p_branch,p_actor,p_request,jsonb_build_object('error','VIRTUAL_POS_SHIFT_CHANGED','message','Кассовая смена закрыта или изменена','safelyRejected',true));
  end if;
  select value into payment from jsonb_array_elements(snap.snapshot->'paymentTypes') where value->>'id'=p_request->>'paymentTypeId';
  if payment is null or not coalesce((payment->>'selectable')::boolean,false) or coalesce((payment->>'isFiscal')::boolean,true) then
    return virtual_pos_record_rejection(p_branch,p_actor,p_request,jsonb_build_object('error','VIRTUAL_POS_PAYMENT_FORBIDDEN','message','Тип оплаты недоступен для нефискальной продажи','safelyRejected',true));
  end if;
  if jsonb_array_length(p_request->'items') not between 1 and 100 or
    (select count(distinct value->>'productId') from jsonb_array_elements(p_request->'items'))<>jsonb_array_length(p_request->'items') then
    return virtual_pos_record_rejection(p_branch,p_actor,p_request,jsonb_build_object('error','VIRTUAL_POS_INVALID_ITEMS','status',400,'safelyRejected',true));
  end if;
  for item in select value from jsonb_array_elements(p_request->'items') loop
    product:=null;
    select value into product from jsonb_array_elements(snap.snapshot->'products') where value->>'id'=item->>'productId';
    if product is null or not coalesce((product->>'available')::boolean,false)
      or not coalesce(product->'paymentTypeIds' ? (p_request->>'paymentTypeId'),false) then
      return virtual_pos_record_rejection(p_branch,p_actor,p_request,jsonb_build_object('error','VIRTUAL_POS_PRODUCT_UNAVAILABLE','message','Товар недоступен для выбранной оплаты','safelyRejected',true));
    end if;
    qty:=(item->>'quantity')::numeric; price:=(product->>'price')::numeric; step:=(product->>'quantityStep')::numeric;
    if qty<=0 or qty>9999 or qty<>round(qty,3) or step<=0 or mod(qty,step)<>0 or price<0 or price<>round(price,2) then
      return virtual_pos_record_rejection(p_branch,p_actor,p_request,jsonb_build_object('error','VIRTUAL_POS_QUANTITY_INVALID','message','Некорректное количество товара','status',400,'safelyRejected',true));
    end if;
    line_total:=round(price*qty,2); amount:=amount+line_total;
    lines:=lines||jsonb_build_array(jsonb_build_object('productId',item->>'productId','quantity',qty,
      'price',price,'name',product->>'name','lineTotal',line_total));
  end loop;
  if amount<=0 or amount>100000000 or amount is distinct from (p_request->>'expectedTotal')::numeric then
    return virtual_pos_record_rejection(p_branch,p_actor,p_request,jsonb_build_object('error','VIRTUAL_POS_TOTAL_CHANGED','message','Сумма изменилась. Обновите корзину','safelyRejected',true));
  end if;
  insert into virtual_pos_sales(id,request_id,actor_id,branch_id,terminal_id,request_payload,snapshot_revision,cash_shift_id,payment_type_id,items,total)
    values(v_request_id,v_request_id,p_actor,p_branch,terminal,p_request,p_request->>'snapshotRevision',
      (p_request->>'cashShiftId')::uuid,(p_request->>'paymentTypeId')::uuid,lines,amount) returning * into existing;
  return jsonb_build_object('sale',virtual_pos_sale_result(existing));
end;
$$;

create or replace function public.claim_virtual_pos_sale(p_branch uuid,p_terminal uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare sale virtual_pos_sales%rowtype; snap virtual_pos_snapshots%rowtype;
begin
  perform 1 from virtual_pos_terminals where branch_id=p_branch for update;
  if not virtual_pos_terminal_allowed(p_branch,p_terminal) then
    return jsonb_build_object('error','VIRTUAL_POS_TERMINAL_FORBIDDEN','status',403);
  end if;
  select * into sale from virtual_pos_sales where branch_id=p_branch and terminal_id=p_terminal
    and status not in ('completed','rejected') order by (status<>'queued') desc,created_at for update skip locked limit 1;
  if not found then return jsonb_build_object('command',null); end if;
  if sale.status='queued' then
    select * into snap from virtual_pos_snapshots where branch_id=p_branch and terminal_id=p_terminal;
    if not found or snap.received_at<clock_timestamp()-interval '45 seconds'
      or sale.created_at<clock_timestamp()-interval '2 minutes'
      or snap.snapshot->>'revision' is distinct from sale.snapshot_revision
      or snap.snapshot#>>'{cashShift,id}' is distinct from sale.cash_shift_id::text
      or not coalesce((snap.snapshot#>>'{cashShift,isOpen}')::boolean,false)
      or not coalesce((snap.snapshot#>>'{profile,nonFiscalNoPaperVerified}')::boolean,false) then
      update virtual_pos_sales set status='rejected',error='Касса или каталог изменились до начала продажи',updated_at=clock_timestamp() where id=sale.id;
      return jsonb_build_object('command',null);
    end if;
    update virtual_pos_sales set status='claimed',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()
      where id=sale.id returning * into sale;
  elsif sale.lease_expires_at<clock_timestamp() and sale.status in ('creating','created','payment_started') then
    update virtual_pos_sales set status='needs_reconciliation',error='Проверьте результат продажи в iikoFront',updated_at=clock_timestamp()
      where id=sale.id returning * into sale;
  end if;
  -- Never issue a new lease for a command that may have reached iikoFront.
  update virtual_pos_sales set lease_expires_at=clock_timestamp()+interval '60 seconds' where id=sale.id;
  return jsonb_build_object('command',jsonb_build_object('saleId',sale.id,'leaseToken',sale.lease_token,
    'terminalId',sale.terminal_id,'cashShiftId',sale.cash_shift_id,'paymentTypeId',sale.payment_type_id,
    'snapshotRevision',sale.snapshot_revision,'items',sale.items,'total',sale.total,'phase',sale.status));
end;
$$;

create or replace function public.advance_virtual_pos_sale(p_branch uuid,p_terminal uuid,p_action jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare sale virtual_pos_sales%rowtype; snap virtual_pos_snapshots%rowtype; target text:=p_action->>'action';
  phases text[]:=array['claimed','creating','created','payment_started','completed'];
begin
  perform 1 from virtual_pos_terminals where branch_id=p_branch for update;
  if not virtual_pos_terminal_allowed(p_branch,p_terminal) then
    return jsonb_build_object('error','VIRTUAL_POS_TERMINAL_FORBIDDEN','status',403);
  end if;
  select * into sale from virtual_pos_sales where id=(p_action->>'saleId')::uuid
    and branch_id=p_branch and terminal_id=p_terminal for update;
  if not found or sale.lease_token is distinct from (p_action->>'leaseToken')::uuid then
    return jsonb_build_object('error','VIRTUAL_POS_LEASE_FORBIDDEN','status',403);
  end if;
  if sale.front_order_id is not null and p_action->>'frontOrderId' is not null
    and sale.front_order_id<>(p_action->>'frontOrderId')::uuid then
    return jsonb_build_object('error','VIRTUAL_POS_ORDER_CONFLICT','status',409);
  end if;
  if sale.status=target or (array_position(phases,target)<array_position(phases,sale.status)) then
    return jsonb_build_object('sale',virtual_pos_sale_result(sale),'guardAccepted',false);
  end if;
  if not ((sale.status='claimed' and target in ('creating','rejected','needs_reconciliation'))
    or (sale.status='creating' and target in ('created','needs_reconciliation'))
    or (sale.status='created' and target in ('payment_started','needs_reconciliation'))
    or (sale.status='payment_started' and target in ('completed','needs_reconciliation'))
    or (sale.status='needs_reconciliation' and target='completed')) then
    return jsonb_build_object('error','VIRTUAL_POS_PHASE_CONFLICT','message','Порядок регистрации продажи нарушен','status',409);
  end if;
  if target in ('creating','payment_started') and sale.lease_expires_at<clock_timestamp() then
    return jsonb_build_object('error','VIRTUAL_POS_LEASE_EXPIRED','status',409);
  end if;
  if target in ('creating','payment_started') then
    select * into snap from virtual_pos_snapshots where branch_id=p_branch and terminal_id=p_terminal;
    if not found or snap.received_at<clock_timestamp()-interval '45 seconds'
      or snap.snapshot->>'revision' is distinct from sale.snapshot_revision
      or snap.snapshot#>>'{cashShift,id}' is distinct from sale.cash_shift_id::text
      or not coalesce((snap.snapshot#>>'{cashShift,isOpen}')::boolean,false)
      or not coalesce((snap.snapshot#>>'{profile,nonFiscalNoPaperVerified}')::boolean,false) then
      return jsonb_build_object('error','VIRTUAL_POS_SNAPSHOT_CHANGED','message','Касса или каталог изменились до начала операции','status',409);
    end if;
  end if;
  if target in ('created','payment_started','completed') and coalesce(sale.front_order_id,(p_action->>'frontOrderId')::uuid) is null then
    return jsonb_build_object('error','VIRTUAL_POS_ORDER_REQUIRED','status',400);
  end if;
  update virtual_pos_sales set status=target,
    front_order_id=coalesce(front_order_id,(p_action->>'frontOrderId')::uuid),
    front_order_number=coalesce(front_order_number,p_action->>'frontOrderNumber'),
    error=case when target='completed' then null else left(p_action->>'error',1000) end,
    lease_expires_at=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()
    where id=sale.id returning * into sale;
  return jsonb_build_object('sale',virtual_pos_sale_result(sale),'guardAccepted',true);
end;
$$;

revoke all on function public.virtual_pos_sale_result(public.virtual_pos_sales),
  public.virtual_pos_record_rejection(uuid,text,jsonb,jsonb),
  public.virtual_pos_terminal_allowed(uuid,uuid),public.publish_virtual_pos_snapshot(uuid,uuid,jsonb),
  public.create_virtual_pos_sale(uuid,text,jsonb),public.claim_virtual_pos_sale(uuid,uuid),
  public.advance_virtual_pos_sale(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.virtual_pos_sale_result(public.virtual_pos_sales),
  public.virtual_pos_record_rejection(uuid,text,jsonb,jsonb),
  public.virtual_pos_terminal_allowed(uuid,uuid),public.publish_virtual_pos_snapshot(uuid,uuid,jsonb),
  public.create_virtual_pos_sale(uuid,text,jsonb),public.claim_virtual_pos_sale(uuid,uuid),
  public.advance_virtual_pos_sale(uuid,uuid,jsonb) to service_role;

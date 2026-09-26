-- Durable polling cursor and invoice ledger. No network request holds a database transaction.
create table public.iiko_outgoing_sync (
  city text primary key check(city in ('aktau','astana')),
  started_at timestamptz not null default now(),
  scan_date date not null default (now() at time zone 'Asia/Aqtau')::date,
  lease_id uuid, lease_until timestamptz,
  last_success_at timestamptz
);
create table public.iiko_outgoing_stock_documents (
  city text not null references public.iiko_outgoing_sync(city),
  document_id uuid not null,
  payload jsonb not null,
  effects jsonb not null default '[]',
  result jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(city,document_id)
);
alter table public.iiko_outgoing_sync enable row level security;
alter table public.iiko_outgoing_stock_documents enable row level security;
revoke all on public.iiko_outgoing_sync,public.iiko_outgoing_stock_documents from public,anon,authenticated;
grant select on public.iiko_outgoing_sync,public.iiko_outgoing_stock_documents to service_role;

create function public.claim_iiko_outgoing_sync(p_city text,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare state iiko_outgoing_sync%rowtype;
begin
  if p_city not in ('aktau','astana') or p_city is null or p_lease is null then
    raise exception 'Invalid outgoing source' using errcode='22023';
  end if;
  insert into iiko_outgoing_sync(city) values(p_city) on conflict do nothing;
  select * into state from iiko_outgoing_sync where city=p_city for update;
  if state.lease_until>clock_timestamp() then return null; end if;
  update iiko_outgoing_sync set lease_id=p_lease,lease_until=clock_timestamp()+interval '10 minutes' where city=p_city;
  return to_jsonb(state)||jsonb_build_object('lease_id',p_lease);
end;
$$;

create function public.finish_iiko_outgoing_sync(p_city text,p_lease uuid,p_next_date date default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update iiko_outgoing_sync set lease_id=null,lease_until=null,
    scan_date=coalesce(p_next_date,scan_date),
    last_success_at=case when p_next_date is null then last_success_at else now() end
    where city=p_city and lease_id=p_lease;
end;
$$;

create function public.apply_iiko_outgoing_invoice(p_city text,p_lease uuid,p_document jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  state iiko_outgoing_sync%rowtype; previous iiko_outgoing_stock_documents%rowtype;
  stock branch_product_inventory%rowtype; row record; old_effect jsonb;
  invoice_id uuid; posted_at timestamptz; items jsonb; effects jsonb:='[]';
  old_quantity numeric; new_quantity numeric; delta numeric; actual numeric; applied numeric;
  held numeric; changed boolean:=false; shortage boolean:=false;
  branches jsonb:='[]'; result jsonb; watermark timestamptz;
begin
  -- Same city lock serializes replicas, including a lost response and lease takeover.
  select * into state from iiko_outgoing_sync where city=p_city for update;
  if not found or state.lease_id is distinct from p_lease or p_lease is null
    or state.lease_until<=clock_timestamp() then
    raise exception 'Outgoing sync lease expired' using errcode='40001';
  end if;
  invoice_id:=(p_document->>'id')::uuid;
  posted_at:=(p_document->>'postedAt')::timestamptz;
  items:=p_document->'items';
  if invoice_id is null or posted_at is null or posted_at>now()+interval '1 minute'
    or coalesce(p_document->>'status','') not in ('NEW','PROCESSED','DELETED')
    or items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items)>25000
    or (p_document->>'status'<>'PROCESSED' and items<>'[]') then
    raise exception 'Invalid outgoing invoice' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(items) x where
    x->>'branchId' is null or x->>'productId' is null or length(x->>'productId') not between 1 and 100
    or x->>'unit' is null or length(x->>'unit') not between 1 and 40
    or x->>'quantity' is null or x->>'quantity' !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$'
    or (x->>'quantity')::numeric<=0 or (x->>'quantity')::numeric>100000)
    or jsonb_array_length(items)<>(select count(distinct (x->>'branchId',x->>'productId')) from jsonb_array_elements(items) x) then
    raise exception 'Invalid outgoing invoice items' using errcode='22023';
  end if;
  select * into previous from iiko_outgoing_stock_documents d where d.city=p_city and d.document_id=invoice_id;
  if found and previous.payload=p_document then
    return previous.result||jsonb_build_object('duplicate',true,'changed',false);
  end if;
  -- Installing the worker must not subtract the whole pre-existing accounting history.
  if previous.document_id is null and posted_at<=state.started_at then
    return jsonb_build_object('changed',false,'reason','before_tracking');
  end if;
  -- Lock branches before stock rows, matching cashier/receipt/reservation mutations.
  perform id from bulka_locations where id in (
    select (x->>'branchId')::uuid from jsonb_array_elements(items||coalesce(previous.effects,'[]')) x
  ) order by id for update;
  for row in
    select x->>'branchId' branch_id,x->>'productId' product_id
    from jsonb_array_elements(items||coalesce(previous.effects,'[]')) x
    group by 1,2 order by 1,2
  loop
    select * into stock from branch_product_inventory where branch_id=row.branch_id::uuid and product_id=row.product_id for update;
    if not found or stock.source_quantity is null then continue; end if;
    -- Absolute iiko snapshots already contain their own movements. A shared Front
    -- ledger is different: its snapshots are guarded and need document deltas too.
    if stock.source not in ('admin','custom') and not exists(
      select 1 from front_stock_policies where branch_id=stock.branch_id and enabled
    ) then continue; end if;
    if not exists(select 1 from bulka_locations where id=stock.branch_id and active) then continue; end if;
    select x into old_effect from jsonb_array_elements(coalesce(previous.effects,'[]')) x
      where x->>'branchId'=row.branch_id and x->>'productId'=row.product_id;
    select coalesce(max((x->>'quantity')::numeric),0) into new_quantity from jsonb_array_elements(items) x
      where x->>'branchId'=row.branch_id and x->>'productId'=row.product_id;
    old_quantity:=coalesce((old_effect->>'quantity')::numeric,0);
    watermark:=stock.manual_counted_at;
    -- A completed Front recount is another physical-count boundary.
    select greatest(watermark,max(completed_at)) into watermark from front_stock_recounts where branch_id=stock.branch_id;
    if previous.document_id is not null
      and (((previous.payload->>'postedAt')::timestamptz>watermark) is distinct from (posted_at>watermark)) then
      raise exception 'Outgoing invoice date crossed a physical count; recount required' using errcode='22023';
    end if;
    applied:=case when (old_effect->>'watermark')::timestamptz=watermark
      then coalesce((old_effect->>'applied')::numeric,0) else 0 end;
    if posted_at>watermark then
      if exists(select 1 from jsonb_array_elements(items) x where x->>'branchId'=row.branch_id and x->>'productId'=row.product_id
        and (x->>'unit' is distinct from stock.unit or mod((x->>'quantity')::numeric,stock.quantity_step)<>0)) then
        raise exception 'Outgoing invoice and display stock units differ' using errcode='22023';
      end if;
      delta:=new_quantity-old_quantity;
      -- Reducing a previously short invoice first removes its unaccounted part.
      -- Example: 10 on hand, issued 12, edited to 11 must remain zero, not grow to 1.
      actual:=case when delta>=0 then least(delta,stock.source_quantity)
        else -least(-delta,greatest(0,applied-new_quantity)) end;
      if actual<>0 then
        perform set_config('bulka.front_guard_write','true',true);
        perform set_config('bulka.stock_follow_iiko','true',true);
        update branch_product_inventory set source_quantity=source_quantity-actual,updated_at=now()
          where branch_id=stock.branch_id and product_id=stock.product_id;
        changed:=true;
        if not branches ? row.branch_id then branches:=branches||jsonb_build_array(row.branch_id); end if;
      end if;
      applied:=applied+actual;
      select coalesce(sum(quantity),0) into held from inventory_reservations where branch_id=stock.branch_id and product_id=stock.product_id
        and allocation_kind='display' and (status='committed' or status='active' and expires_at>now());
      shortage:=shortage or new_quantity>applied or stock.source_quantity-actual<held;
    end if;
    effects:=effects||jsonb_build_array(jsonb_build_object('branchId',row.branch_id,'productId',row.product_id,
      'quantity',new_quantity,'applied',applied,'watermark',watermark));
  end loop;
  result:=jsonb_build_object('changed',changed,'branchIds',branches,'shortage',shortage,'duplicate',false);
  insert into iiko_outgoing_stock_documents as d(city,document_id,payload,effects,result)
    values(p_city,invoice_id,p_document,effects,result)
    on conflict on constraint iiko_outgoing_stock_documents_pkey do update
      set payload=excluded.payload,effects=excluded.effects,result=excluded.result,updated_at=now();
  return result;
end;
$$;
revoke all on function public.claim_iiko_outgoing_sync(text,uuid),public.finish_iiko_outgoing_sync(text,uuid,date),
  public.apply_iiko_outgoing_invoice(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_iiko_outgoing_sync(text,uuid),public.finish_iiko_outgoing_sync(text,uuid,date),
  public.apply_iiko_outgoing_invoice(text,uuid,jsonb) to service_role;

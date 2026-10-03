begin;
create table public.cashier_iiko_production_bindings (
 branch_id uuid primary key references public.bulka_locations(id),
 server_id text not null check(length(server_id) between 1 and 100),
 department_id uuid not null,source_store_id uuid not null,target_store_id uuid not null,
 enabled boolean not null default false,post_immediately boolean not null default false,
 updated_by text not null,updated_at timestamptz not null default now()
);
create table public.cashier_iiko_production_acts (
 id uuid primary key,branch_id uuid not null references public.bulka_locations(id),business_date date not null,
 actor text not null,server_id text not null,department_id uuid not null,source_store_id uuid not null,target_store_id uuid not null,
 document_id uuid not null unique,document_number text,status text not null default 'pending'
  check(status in ('pending','sending','unknown','created','failed')),
 manifest jsonb not null,verification jsonb,send_started_at timestamptz,error text,error_code text,created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index cashier_iiko_production_acts_branch_date on public.cashier_iiko_production_acts(branch_id,business_date,created_at);
create table public.cashier_iiko_production_allocations (
 event_id uuid primary key references public.display_stock_changes(id),
 act_id uuid not null references public.cashier_iiko_production_acts(id)
);
alter table public.cashier_iiko_production_bindings enable row level security;
alter table public.cashier_iiko_production_acts enable row level security;
alter table public.cashier_iiko_production_allocations enable row level security;
revoke all on public.cashier_iiko_production_bindings,public.cashier_iiko_production_acts,public.cashier_iiko_production_allocations from public,anon,authenticated;
grant select,insert,update on public.cashier_iiko_production_bindings to service_role;
grant select on public.cashier_iiko_production_acts,public.cashier_iiko_production_allocations to service_role;

create function public.cashier_production_candidates(p_branch uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare start_at timestamptz;end_at timestamptz;visible_at timestamptz;b public.bulka_locations%rowtype;
begin
 if p_date is null or p_date<'2020-01-01' or p_date>(now() at time zone 'Asia/Aqtau')::date then
  raise exception 'IIKO_PRODUCTION_DATE_INVALID'; end if;
 select * into b from public.bulka_locations where id=p_branch and active;
 if not found then raise exception 'IIKO_PRODUCTION_BRANCH_UNAVAILABLE'; end if;
 start_at:=p_date::timestamp at time zone 'Asia/Aqtau';end_at:=(p_date+1)::timestamp at time zone 'Asia/Aqtau';
 select greatest(start_at,coalesce(reset_at,start_at)) into visible_at from public.display_stock_report_resets
  where branch_id=p_branch and business_date=p_date;
 visible_at:=coalesce(visible_at,start_at);
 return jsonb_build_object('date',p_date,'branch',jsonb_build_object('id',b.id,'name',b.name,'address',b.address),
  'products',coalesce((select jsonb_agg(g order by "productName","productId",unit) from (
   select e.product_id "productId",(array_agg(e.product_name order by e.created_at desc,e.id desc))[1] "productName",
    e.unit,sum(e.after_quantity-e.before_quantity) quantity,jsonb_agg(e.id order by e.id) "eventIds"
   from public.display_stock_changes e where e.branch_id=p_branch and e.created_at>=visible_at and e.created_at<end_at
    and e.reason='receipt' and e.before_quantity is not null and e.after_quantity>e.before_quantity
    and not exists(select 1 from public.cashier_iiko_production_allocations a where a.event_id=e.id)
   group by e.product_id,e.unit) g),'[]'::jsonb),
  'acts',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.cashier_iiko_production_acts a
   where a.branch_id=p_branch and a.business_date=p_date),'[]'::jsonb));
end;
$$;

create function public.claim_cashier_production_act(p_branch uuid,p_date date,p_request uuid,p_actor text,
 p_event_ids jsonb,p_products jsonb,p_binding_revision timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.cashier_iiko_production_bindings%rowtype;a public.cashier_iiko_production_acts%rowtype;
 ids uuid[];start_at timestamptz;end_at timestamptz;visible_at timestamptz;n integer;items jsonb;
begin
 if p_request is null or nullif(trim(p_actor),'') is null or length(p_actor)>160
  or jsonb_typeof(p_event_ids) is distinct from 'array' or jsonb_array_length(p_event_ids) not between 1 and 1000
  or jsonb_typeof(p_products) is distinct from 'array' then raise exception 'IIKO_PRODUCTION_INPUT_INVALID'; end if;
 select array_agg(value::uuid order by value::uuid),count(distinct value) into ids,n from jsonb_array_elements_text(p_event_ids);
 if n<>jsonb_array_length(p_event_ids) then raise exception 'IIKO_PRODUCTION_INPUT_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cashier-production:'||p_request::text,0));
 perform id from public.bulka_locations where id=p_branch and active for update;
 if not found then raise exception 'IIKO_PRODUCTION_BRANCH_UNAVAILABLE'; end if;
 select * into a from public.cashier_iiko_production_acts where id=p_request for update;
 if found then
  if a.branch_id is distinct from p_branch or a.business_date is distinct from p_date
   or a.manifest->'eventIds' is distinct from to_jsonb(ids) then raise exception 'IIKO_PRODUCTION_REQUEST_CONFLICT'; end if;
  return to_jsonb(a); end if;
 if p_date is null or p_date<'2020-01-01' or p_date>(now() at time zone 'Asia/Aqtau')::date then
  raise exception 'IIKO_PRODUCTION_DATE_INVALID'; end if;
 select * into b from public.cashier_iiko_production_bindings where branch_id=p_branch and enabled for update;
 if not found or b.updated_at is distinct from p_binding_revision then raise exception 'IIKO_PRODUCTION_BINDING_CHANGED'; end if;
 start_at:=p_date::timestamp at time zone 'Asia/Aqtau';end_at:=(p_date+1)::timestamp at time zone 'Asia/Aqtau';
 select greatest(start_at,coalesce(reset_at,start_at)) into visible_at from public.display_stock_report_resets
  where branch_id=p_branch and business_date=p_date;
 visible_at:=coalesce(visible_at,start_at);
 perform id from public.display_stock_changes where id=any(ids) order by id for update;
 select count(*) into n from public.display_stock_changes e where e.id=any(ids) and e.branch_id=p_branch
  and e.created_at>=visible_at and e.created_at<end_at and e.reason='receipt'
  and e.before_quantity is not null and e.after_quantity>e.before_quantity
  and not exists(select 1 from public.cashier_iiko_production_allocations x where x.event_id=e.id);
 if n<>cardinality(ids) then raise exception 'IIKO_PRODUCTION_EVENTS_CHANGED'; end if;
 with quantities as(select product_id,unit,sum(after_quantity-before_quantity) quantity,
  (array_agg(product_name order by created_at desc,id desc))[1] product_name
  from public.display_stock_changes where id=any(ids) group by product_id,unit)
 select jsonb_agg(jsonb_build_object('localProductId',q.product_id,'productId',p->>'productId',
  'productName',q.product_name,'unit',q.unit,'amountUnit',p->>'amountUnit','quantity',q.quantity) order by q.product_id,q.unit),count(*)
 into items,n from quantities q join jsonb_array_elements(p_products) p
  on p->>'localProductId'=q.product_id and p->>'unit'=q.unit
  where q.quantity>0 and q.quantity<=100000 and mod(q.quantity,0.001)=0
   and (p->>'productId')~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   and (p->>'amountUnit')~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
 if n<>(select count(*) from (select product_id,unit from public.display_stock_changes where id=any(ids) group by product_id,unit) g)
  or n<>jsonb_array_length(p_products) then raise exception 'IIKO_PRODUCTION_PRODUCTS_CHANGED'; end if;
 insert into public.cashier_iiko_production_acts(id,branch_id,business_date,actor,server_id,department_id,source_store_id,target_store_id,
  document_id,manifest) values(p_request,p_branch,p_date,p_actor,b.server_id,b.department_id,b.source_store_id,b.target_store_id,p_request,
   jsonb_build_object('eventIds',to_jsonb(ids),'items',items,'postImmediately',b.post_immediately)) returning * into a;
 insert into public.cashier_iiko_production_allocations(event_id,act_id) select unnest(ids),p_request;
 return to_jsonb(a);
end;
$$;

create function public.begin_cashier_production_send(p_branch uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.cashier_iiko_production_acts%rowtype;
begin
 update public.cashier_iiko_production_acts set status='sending',updated_at=clock_timestamp()
  where id=p_request and branch_id=p_branch and status='pending' returning * into a;
 if not found then return null; end if;return to_jsonb(a);
end;
$$;
create function public.finish_cashier_production_send(p_branch uuid,p_request uuid,p_status text,p_number text default null,
 p_error text default null,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.cashier_iiko_production_acts%rowtype;
begin
 if p_status not in ('created','unknown','failed') then raise exception 'IIKO_PRODUCTION_INPUT_INVALID'; end if;
 select * into a from public.cashier_iiko_production_acts where id=p_request and branch_id=p_branch for update;
 if not found then raise exception 'IIKO_PRODUCTION_REQUEST_CONFLICT'; end if;
 if a.status in ('created','failed') then return to_jsonb(a); end if;
 if a.status not in ('sending','unknown') then raise exception 'IIKO_PRODUCTION_REQUEST_CONFLICT'; end if;
 update public.cashier_iiko_production_acts set status=p_status,document_number=coalesce(p_number,document_number),
  error=left(p_error,500),error_code=left(p_error_code,100),updated_at=clock_timestamp() where id=p_request returning * into a;
 -- Only a conclusive not-created response may release source rows. Unknown keeps its allocation.
 if p_status='failed' then delete from public.cashier_iiko_production_allocations where act_id=p_request; end if;
 return to_jsonb(a);
end;
$$;
create function public.start_cashier_production_http(p_branch uuid,p_request uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.cashier_iiko_production_acts set send_started_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_request and branch_id=p_branch and status='sending' and send_started_at is null;
 return found;
end;
$$;
create function public.resolve_cashier_production_act(p_branch uuid,p_request uuid,p_action text,p_number text,
 p_confirmed boolean,p_actor text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.cashier_iiko_production_acts%rowtype;
begin
 if p_confirmed is distinct from true or p_action not in ('created','not_created') or nullif(trim(p_actor),'') is null
  or length(p_actor)>160 or (p_action='created' and (nullif(trim(p_number),'') is null or length(p_number)>100))
  or (p_action='not_created' and p_number is not null) then raise exception 'IIKO_PRODUCTION_INPUT_INVALID'; end if;
 perform id from public.bulka_locations where id=p_branch for update;
 if not found then raise exception 'IIKO_PRODUCTION_BRANCH_UNAVAILABLE'; end if;
 select * into a from public.cashier_iiko_production_acts where id=p_request and branch_id=p_branch for update;
 if not found then raise exception 'IIKO_PRODUCTION_REQUEST_CONFLICT'; end if;
 if a.verification is not null then
  if a.verification->>'action' is distinct from p_action or
   (p_action='created' and a.document_number is distinct from trim(p_number)) then raise exception 'IIKO_PRODUCTION_REQUEST_CONFLICT'; end if;
  return to_jsonb(a); end if;
 if a.status<>'unknown' then raise exception 'IIKO_PRODUCTION_REQUEST_CONFLICT'; end if;
 if p_action='not_created' and a.send_started_at>now()-interval '5 minutes'
  then raise exception 'IIKO_PRODUCTION_SEND_IN_PROGRESS'; end if;
 update public.cashier_iiko_production_acts set status=case when p_action='created' then 'created' else 'failed' end,
  document_number=case when p_action='created' then trim(p_number) else document_number end,
  verification=jsonb_build_object('action',p_action,'actor',p_actor,'verifiedAt',clock_timestamp()),
  error=case when p_action='not_created' then 'Администратор подтвердил, что акт не создан в iiko. Добавления можно отправить снова.' end,
  error_code=case when p_action='not_created' then 'IIKO_PRODUCTION_NOT_CREATED' end,updated_at=clock_timestamp()
  where id=p_request returning * into a;
 if p_action='not_created' then delete from public.cashier_iiko_production_allocations where act_id=p_request; end if;
 return to_jsonb(a);
end;
$$;
revoke all on function public.cashier_production_candidates(uuid,date),
 public.claim_cashier_production_act(uuid,date,uuid,text,jsonb,jsonb,timestamptz),
 public.begin_cashier_production_send(uuid,uuid),public.finish_cashier_production_send(uuid,uuid,text,text,text,text)
 ,public.start_cashier_production_http(uuid,uuid),public.resolve_cashier_production_act(uuid,uuid,text,text,boolean,text)
 from public,anon,authenticated;
grant execute on function public.cashier_production_candidates(uuid,date),
 public.claim_cashier_production_act(uuid,date,uuid,text,jsonb,jsonb,timestamptz),
 public.begin_cashier_production_send(uuid,uuid),public.finish_cashier_production_send(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.start_cashier_production_http(uuid,uuid),public.resolve_cashier_production_act(uuid,uuid,text,text,boolean,text) to service_role;
commit;

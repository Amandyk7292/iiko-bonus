-- Internal KZT budget, not a hold on the provider's corporate account.
alter table public.kaspi_orders add column if not exists delivery_budget_required boolean not null default false;
alter table public.delivery_jobs
  add column if not exists budget_final_cost numeric(14,2),
  add column if not exists budget_cancellation_cost numeric(14,2),
  add column if not exists budget_checked_at timestamptz;
alter table public.checkout_delivery_probes
  add column if not exists budget_final_cost numeric(14,2),
  add column if not exists budget_checked_at timestamptz;
create table if not exists public.delivery_budget_account (
  id boolean primary key default true check (id),
  balance numeric(14,2) not null default 0,
  buffer_percent integer not null default 50 check (buffer_percent between 0 and 200),
  revision bigint not null default 1,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_by text not null
);
-- Owner confirmed this opening amount on 2026-09-09. Never reset it on redeploy.
insert into public.delivery_budget_account(id,balance,updated_by)
values(true,5000,'owner-confirmation-2026-09-09') on conflict(id) do nothing;

create table if not exists public.delivery_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  request_id uuid not null,
  order_id uuid unique references public.kaspi_orders(id),
  estimate numeric(14,2) not null check (estimate > 0),
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'held' check (status in ('held','released')),
  payment_attempted_at timestamptz,
  expires_at timestamptz not null default (now()+interval '35 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id,request_id)
);
create index if not exists delivery_budget_held on public.delivery_budget_reservations(status) where status='held';

create table if not exists public.delivery_budget_entries (
  source_key text primary key,
  amount numeric(14,2) not null,
  order_id uuid references public.kaspi_orders(id),
  note text not null,
  actor text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- All admission, reconciliation and adjustment functions take the same lock.
create or replace function public.reconcile_delivery_budget()
returns void language plpgsql security definer set search_path=public as $$
declare v_changed integer; v_total integer := 0; v_since timestamptz;
begin
  select created_at into v_since from delivery_budget_account where id=true for update;
  update delivery_budget_reservations r set order_id=o.id,updated_at=now()
    from kaspi_orders o where r.order_id is null and r.customer_id=o.customer_id
    and r.request_id=o.client_request_id;
  get diagnostics v_changed=row_count; v_total:=v_total+v_changed;
  -- Unknown bank results are retained. A timeout is not proof of non-payment.
  update delivery_budget_reservations set status='released',updated_at=now()
    where status='held' and order_id is null and payment_attempted_at is null and expires_at<now();
  get diagnostics v_changed=row_count; v_total:=v_total+v_changed;
  update delivery_budget_reservations r set status='released',updated_at=now()
    from kaspi_orders o where r.order_id=o.id and r.status='held'
    and (o.status in ('failed','expired','refunded') or o.fulfillment_status in ('cancelled','completed'))
    and not exists (
      select 1 from delivery_jobs j where j.order_id=o.id and j.created_at>=v_since
      -- A settled expense is written only after a verified terminal result.
      and (j.provider_status not in ('cancelled','cancelled_with_payment','cancelled_by_taxi','cancelled_with_items_on_hands',
        'estimating_failed','performer_not_found','failed','delivered','delivered_finish','returned','returned_finish','complete','finished')
        or not exists(select 1 from delivery_budget_entries e where e.source_key='job:'||j.id::text))
    );
  get diagnostics v_changed=row_count; v_total:=v_total+v_changed;
  if v_total>0 then update delivery_budget_account set revision=revision+1,updated_at=now() where id=true; end if;
end $$;

create or replace function public.delivery_budget_snapshot()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a delivery_budget_account%rowtype; v_held numeric; v_attention integer;
begin
  perform reconcile_delivery_budget();
  select * into a from delivery_budget_account where id=true;
  select coalesce(sum(amount),0),count(*) filter(where order_id is null and payment_attempted_at is not null and expires_at<now())
    into v_held,v_attention from delivery_budget_reservations where status='held';
  return jsonb_build_object('balance',a.balance,'reserved',v_held,'available',greatest(0,a.balance-v_held),
    'bufferPercent',a.buffer_percent,'revision',a.revision,'confirmedAt',a.confirmed_at,'attentionCount',v_attention);
end $$;

create or replace function public.reserve_delivery_budget(
  p_customer_id uuid,p_request_id uuid,p_estimate numeric,p_order_id uuid default null,p_dispatch boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare a delivery_budget_account%rowtype; r delivery_budget_reservations%rowtype;
  v_required numeric; v_held numeric; v_order kaspi_orders%rowtype;
begin
  if p_customer_id is null or p_request_id is null or p_estimate is null or p_estimate<=0 or p_estimate>100000
    then raise exception 'invalid delivery budget reservation'; end if;
  select * into a from delivery_budget_account where id=true for update;
  perform reconcile_delivery_budget();
  if p_order_id is not null then
    select * into v_order from kaspi_orders where id=p_order_id and customer_id=p_customer_id;
    if v_order.id is null or v_order.status<>'paid' or v_order.fulfillment_status in ('cancelled','completed')
      then return jsonb_build_object('status','order_unavailable'); end if;
  end if;
  select * into r from delivery_budget_reservations
    where (customer_id=p_customer_id and request_id=p_request_id) or (p_order_id is not null and order_id=p_order_id);
  if r.id is not null and r.order_id is not null and r.order_id is distinct from p_order_id
    then return jsonb_build_object('status','existing_order'); end if;
  if r.id is not null and not p_dispatch and r.estimate<>p_estimate
    then return jsonb_build_object('status','quote_changed'); end if;
  v_required:=ceil(p_estimate*(100+a.buffer_percent)/100);
  -- At actual dispatch use the existing buffer before seeking extra funds.
  if p_dispatch and r.status='held' then v_required:=greatest(r.amount,ceil(p_estimate)); end if;
  select coalesce(sum(amount),0) into v_held from delivery_budget_reservations where status='held' and id is distinct from r.id;
  if a.balance-v_held<v_required then return jsonb_build_object('status','unavailable'); end if;
  if r.id is null then
    insert into delivery_budget_reservations(customer_id,request_id,order_id,estimate,amount)
      values(p_customer_id,p_request_id,p_order_id,p_estimate,v_required) returning * into r;
  else
    update delivery_budget_reservations set amount=v_required,status='held',order_id=coalesce(order_id,p_order_id),
      expires_at=case when status='released' then now()+interval '35 minutes' else expires_at end,updated_at=now()
      where id=r.id returning * into r;
  end if;
  update delivery_budget_account set revision=revision+1,updated_at=now() where id=true;
  return jsonb_build_object('status','reserved','id',r.id,'amount',r.amount,'estimate',r.estimate);
end $$;

create or replace function public.mark_delivery_budget_payment(p_reservation_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  perform 1 from delivery_budget_account where id=true for update;
  update delivery_budget_reservations set payment_attempted_at=coalesce(payment_attempted_at,now()),updated_at=now()
    where id=p_reservation_id and status='held' and (expires_at>now() or payment_attempted_at is not null)
    returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.release_unstarted_delivery_budget(p_customer_id uuid,p_request_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform 1 from delivery_budget_account where id=true for update;
  update delivery_budget_reservations set status='released',updated_at=now()
    where customer_id=p_customer_id and request_id=p_request_id and status='held'
    and payment_attempted_at is null and order_id is null;
  if found then update delivery_budget_account set revision=revision+1,updated_at=now() where id=true; end if;
end $$;

create or replace function public.record_delivery_budget_cost(p_source text,p_cost numeric,p_order_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_previous numeric := 0; v_since timestamptz; v_created timestamptz;
begin
  if p_source is null or p_source !~ '^(job|probe):[0-9a-f-]{36}$' or p_cost is null or p_cost<0 or p_cost>1000000
    then raise exception 'invalid delivery cost'; end if;
  select created_at into v_since from delivery_budget_account where id=true for update;
  if p_source like 'job:%' then
    select created_at into v_created from delivery_jobs where id=substring(p_source from 5)::uuid and order_id=p_order_id;
  else
    select created_at into v_created from checkout_delivery_probes where id=substring(p_source from 7)::uuid;
  end if;
  -- The confirmed opening balance already includes historical deliveries.
  if v_created is null or v_created<v_since then return; end if;
  select -amount into v_previous from delivery_budget_entries where source_key=p_source;
  if found and v_previous=p_cost then
    update delivery_budget_entries set updated_at=now() where source_key=p_source;
    return;
  end if;
  update delivery_budget_account set balance=balance+coalesce(v_previous,0)-p_cost,revision=revision+1,updated_at=now() where id=true;
  insert into delivery_budget_entries(source_key,amount,order_id,note,actor)
    values(p_source,-p_cost,p_order_id,'Подтверждённая стоимость курьера','yandex')
    on conflict(source_key) do update set amount=excluded.amount,updated_at=now();
  perform reconcile_delivery_budget();
end $$;

create or replace function public.adjust_delivery_budget(p_request_id uuid,p_revision bigint,p_amount numeric,p_mode text,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a delivery_budget_account%rowtype; v_delta numeric; v_key text;
begin
  if p_request_id is null or p_amount is null or p_amount<0 or p_amount>100000000 or p_mode is null or p_mode not in ('top_up','balance')
    or coalesce(length(trim(p_actor)),0)=0 then raise exception 'invalid budget adjustment'; end if;
  v_key:='adjustment:'||p_request_id::text;
  select * into a from delivery_budget_account where id=true for update;
  if exists(select 1 from delivery_budget_entries where source_key=v_key) then return delivery_budget_snapshot(); end if;
  if a.revision<>p_revision then return jsonb_build_object('status','stale'); end if;
  if p_mode='balance' and exists (
    select 1 from delivery_jobs j left join delivery_budget_entries e on e.source_key='job:'||j.id::text
    where j.created_at>=a.created_at and (e.source_key is null or j.updated_at>e.updated_at)
  ) then return jsonb_build_object('status','unsettled'); end if;
  v_delta:=case when p_mode='top_up' then p_amount else p_amount-a.balance end;
  update delivery_budget_account set balance=balance+v_delta,revision=revision+1,confirmed_at=now(),updated_at=now(),updated_by=p_actor where id=true;
  insert into delivery_budget_entries(source_key,amount,note,actor) values(v_key,v_delta,p_mode,p_actor);
  return delivery_budget_snapshot();
end $$;

create or replace function public.pending_delivery_budget_costs()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_jobs jsonb; v_probes jsonb; v_since timestamptz;
begin
  select created_at into v_since from delivery_budget_account where id=true;
  with candidates as (
    select j.id from delivery_jobs j left join delivery_budget_entries e on e.source_key='job:'||j.id::text
    where j.created_at>=v_since and (e.source_key is null or j.updated_at>e.updated_at)
      and j.provider_status in ('cancelled','cancelled_with_payment','cancelled_by_taxi','cancelled_with_items_on_hands',
        'estimating_failed','performer_not_found','failed','delivered','delivered_finish','returned','returned_finish','complete','finished')
    order by j.budget_checked_at nulls first,j.created_at limit 10
  ), marked as (
    update delivery_jobs j set budget_checked_at=now() from candidates c where j.id=c.id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(marked)),'[]'::jsonb) into v_jobs from marked;
  with candidates as (
    select p.id from checkout_delivery_probes p left join delivery_budget_entries e on e.source_key='probe:'||p.id::text
    where p.created_at>=v_since and e.source_key is null and p.state in ('complete','rejected')
      and p.provider_status in ('cancelled','cancelled_with_payment')
    order by p.budget_checked_at nulls first,p.created_at limit 10
  ), marked as (
    update checkout_delivery_probes p set budget_checked_at=now() from candidates c where p.id=c.id returning p.*
  ) select coalesce(jsonb_agg(to_jsonb(marked)),'[]'::jsonb) into v_probes from marked;
  return jsonb_build_object('jobs',v_jobs,'probes',v_probes);
end $$;

-- Attach in the same transaction that saves the order, including bank webhooks
-- which arrive before the initiating HTTP request has returned.
create or replace function public.attach_delivery_budget_order()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.client_request_id is null then return new; end if;
  if exists(select 1 from delivery_budget_reservations where customer_id=new.customer_id and request_id=new.client_request_id) then
    perform reconcile_delivery_budget();
  end if;
  return new;
end $$;
drop trigger if exists kaspi_order_delivery_budget on public.kaspi_orders;
create trigger kaspi_order_delivery_budget after insert or update of status,fulfillment_status on public.kaspi_orders
  for each row execute function public.attach_delivery_budget_order();

do $$ declare t text; f record; begin
  foreach t in array array['delivery_budget_account','delivery_budget_reservations','delivery_budget_entries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('drop policy if exists service_role_only on public.%I',t);
    execute format('create policy service_role_only on public.%I for all to service_role using(true) with check(true)',t);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('reconcile_delivery_budget','delivery_budget_snapshot','reserve_delivery_budget',
      'mark_delivery_budget_payment','release_unstarted_delivery_budget','record_delivery_budget_cost','adjust_delivery_budget','attach_delivery_budget_order',
      'pending_delivery_budget_costs') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

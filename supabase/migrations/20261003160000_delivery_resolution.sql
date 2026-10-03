begin;
alter table public.kaspi_orders add column delivery_resolution jsonb;
create index kaspi_orders_delivery_resolution_pending on public.kaspi_orders
 ((delivery_resolution->>'status')) where delivery_resolution is not null;

-- Stop unstarted historical automatic cancellations; preserve refunds already claimed.
update public.kaspi_orders set courier_timeout_at=null,courier_timeout_retry_at=null
 where courier_timeout_at is not null and refund_status is null and fulfillment_status<>'cancelled';
create or replace function public.claim_courier_timeout(p_order uuid,p_before timestamptz)
returns setof public.kaspi_orders language sql security definer set search_path=public,pg_temp as $$
 select * from public.kaspi_orders where false;
$$;

create or replace function public.delivery_resolution_unassigned(p_order uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select not exists(select 1 from public.delivery_jobs j where j.order_id=p_order and
  (j.internal_status in ('assigned','picked_up','en_route','delivered')
   or nullif(j.courier_name,'') is not null or nullif(j.courier_phone,'') is not null));
$$;
create or replace function public.delivery_resolution_delivery_closed(p_order uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select not exists(select 1 from public.delivery_jobs j where j.order_id=p_order and
  (coalesce(j.internal_status,'') not in ('cancelled','failed')
   or coalesce(j.provider_status,'') not in ('cancelled','cancelled_with_payment','cancelled_by_taxi',
    'cancelled_with_items','performer_not_found','estimating_failed','failed','cancelled_by_client',
    'canceled','cancelled_by_provider','cancelled_by_service')));
$$;

create or replace function public.delivery_resolution_fee_refunded(p_order uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select o.delivery_fee>0 and coalesce((select sum(i.refund_amount)
  from public.order_partial_refunds r join public.order_partial_refund_items i on i.refund_id=r.id
  where r.order_id=o.id and r.status='succeeded' and i.line_key='__delivery_fee__'),0)>=o.delivery_fee
  from public.kaspi_orders o where o.id=p_order),false);
$$;

create or replace function public.delivery_resolution_valid_pickup(p_branch uuid,p_at timestamptz,p_offset integer default 300)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.bulka_locations%rowtype; local_at timestamp; day_at timestamp; h jsonb; opening integer;
 closing integer; mins integer; step integer; day_offset integer; keys text[]:=array['sun','mon','tue','wed','thu','fri','sat'];
begin
 if p_at is null or p_at<now() or p_at>now()+interval '24 hours' or p_offset not between -840 and 840 then return false; end if;
 select * into b from public.bulka_locations where id=p_branch and active and pickup_enabled for update;
 if not found then return false; end if;
 local_at:=(p_at at time zone 'UTC')+make_interval(mins=>p_offset);
 step:=case when b.slot_minutes between 15 and 240 then b.slot_minutes else 60 end;
 if extract(second from local_at)<>0 or (extract(hour from local_at)::integer*60+extract(minute from local_at)::integer)%step<>0
  then return false; end if;
 if b.round_the_clock then return true; end if;
 for day_offset in -1..0 loop
  day_at:=date_trunc('day',local_at)+make_interval(days=>day_offset);
  h:=coalesce(b.hours->keys[extract(dow from day_at)::integer+1],b.hours->'daily');
  if h is null or coalesce((h->>'closed')::boolean,false) then continue; end if;
  if coalesce(h->>'open','')!~'^(2[0-3]|[01][0-9]):[0-5][0-9]$'
   or coalesce(h->>'close','')!~'^((2[0-3]|[01][0-9]):[0-5][0-9]|24:00)$' then continue; end if;
  opening:=split_part(h->>'open',':',1)::integer*60+split_part(h->>'open',':',2)::integer;
  closing:=split_part(h->>'close',':',1)::integer*60+split_part(h->>'close',':',2)::integer;
  if opening=closing then continue; end if;
  if closing<opening then closing:=closing+1440; end if;
  mins:=extract(epoch from (local_at-day_at))::integer/60;
  if mins>=opening and mins<closing then return true; end if;
 end loop;
 return false;
end;
$$;

create or replace function public.claim_delivery_resolutions(p_before timestamptz)
returns setof public.kaspi_orders language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return query update public.kaspi_orders o set delivery_resolution=jsonb_build_object(
  'id',gen_random_uuid(),'status','pending','reason','courier_not_found','requestedAt',now()),updated_at=now()
 where o.status='paid' and o.refund_status is null and o.fulfillment_type='delivery'
  and o.fulfillment_status='ready' and o.kitchen_ready_at is not null
  and o.courier_search_started_at is not null
  and greatest(o.kitchen_ready_at,o.courier_search_started_at)<=p_before
  and o.courier_id is null and o.courier_assigned_at is null
  and coalesce(o.delivery_status,'unassigned') in ('unassigned','cancelled')
  and o.delivery_resolution is null and public.delivery_resolution_unassigned(o.id) returning o.*;
end;
$$;

create or replace function public.choose_delivery_resolution(p_order uuid,p_customer uuid,
 p_action text,p_pickup timestamptz default null,p_offset integer default 300)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.kaspi_orders%rowtype; s text; rid uuid; branch uuid;
begin
 select branch_id into branch from public.kaspi_orders where id=p_order and customer_id=p_customer;
 perform id from public.bulka_locations where id=branch for update;
 select * into o from public.kaspi_orders where id=p_order and customer_id=p_customer for update;
 if not found then raise exception 'DELIVERY_RESOLUTION_NOT_FOUND'; end if;
 if o.branch_id is distinct from branch then raise exception 'DELIVERY_RESOLUTION_CONFLICT'; end if;
 s:=o.delivery_resolution->>'status'; rid:=(o.delivery_resolution->>'id')::uuid;
 if p_action not in ('pickup','cancel') then raise exception 'DELIVERY_RESOLUTION_INVALID_ACTION'; end if;
 if (p_action='pickup' and s in ('pickup_cancelling','pickup_pending_approval','pickup_accepted')
    and (o.delivery_resolution->>'pickupTime')::timestamptz=p_pickup)
   or (p_action='cancel' and s in ('cancel_cancelling','cancel_refunding','cancelled')) then return to_jsonb(o); end if;
 if s is distinct from 'pending' or o.status<>'paid' or o.refund_status is not null
  or o.fulfillment_status<>'ready' or o.fulfillment_type<>'delivery'
  or o.courier_id is not null or o.courier_assigned_at is not null
  or not public.delivery_resolution_unassigned(o.id) then raise exception 'DELIVERY_RESOLUTION_CONFLICT'; end if;
 if p_action='pickup' then
  if not public.delivery_resolution_valid_pickup(o.branch_id,p_pickup,p_offset)
   then raise exception 'DELIVERY_RESOLUTION_INVALID_SLOT'; end if;
  perform public.reserve_fulfillment_slot_v2(o.customer_id,rid,o.branch_id,'pickup'::varchar,
   p_pickup,1440,null,p_offset);
  update public.fulfillment_slot_reservations set status='committed',order_id=o.id,updated_at=now()
   where client_request_id=rid and customer_id=o.customer_id;
 end if;
 update public.kaspi_orders set delivery_resolution=o.delivery_resolution||jsonb_build_object(
  'status',p_action||'_cancelling','pickupTime',p_pickup,'timezoneOffsetMinutes',p_offset,'retryAt',now(),'error',null),
  courier_timeout_at=now(),updated_at=now() where id=o.id returning * into o;
 return to_jsonb(o);
end;
$$;

create or replace function public.claim_delivery_resolution_work(p_order uuid default null)
returns setof public.kaspi_orders language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return query update public.kaspi_orders o set delivery_resolution=o.delivery_resolution||
  jsonb_build_object('retryAt',now()+interval '1 minute') where o.id in (
   select q.id from public.kaspi_orders q where (p_order is null or q.id=p_order)
    and q.delivery_resolution->>'status' in ('pickup_cancelling','cancel_cancelling','cancel_refunding','pickup_rejecting','pickup_accepting')
    and coalesce((q.delivery_resolution->>'retryAt')::timestamptz,now())<=now()
    and (q.refund_status is distinct from 'processing' or q.delivery_resolution->>'status'='pickup_accepting')
    order by q.updated_at limit 50 for update skip locked) returning o.*;
end;
$$;

create or replace function public.finish_delivery_resolution(p_order uuid,p_resolution uuid,p_next text,p_actor text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.kaspi_orders%rowtype; s text; branch uuid;
begin
 select branch_id into branch from public.kaspi_orders where id=p_order;
 perform id from public.bulka_locations where id=branch for update;
 select * into o from public.kaspi_orders where id=p_order for update;
 if not found then raise exception 'DELIVERY_RESOLUTION_NOT_FOUND'; end if;
 if o.branch_id is distinct from branch then raise exception 'DELIVERY_RESOLUTION_CONFLICT'; end if;
 if o.delivery_resolution->>'id' is distinct from p_resolution::text then raise exception 'DELIVERY_RESOLUTION_CONFLICT'; end if;
 s:=o.delivery_resolution->>'status';
 if s=p_next then return to_jsonb(o); end if;
 if not ((s='pickup_cancelling' and p_next='pickup_pending_approval')
  or (s='cancel_cancelling' and p_next='cancel_refunding')
  or (s='pickup_pending_approval' and p_next in ('pickup_accepting','pickup_rejecting'))
  or (s='pickup_accepting' and p_next in ('pickup_accepted','pickup_rejecting'))
  or (s='cancel_refunding' and p_next='cancelled')
  or (s='pickup_rejecting' and p_next='pickup_rejected')
  or (s in ('pickup_cancelling','cancel_cancelling') and p_next='delivery_resumed'))
  then raise exception 'DELIVERY_RESOLUTION_CONFLICT'; end if;
 if p_next not in ('delivery_resumed','cancelled','pickup_rejected') and
  (o.status<>'paid' or coalesce(o.refund_status,'') not in ('','partial','failed') or o.courier_id is not null
   or o.courier_assigned_at is not null or not public.delivery_resolution_unassigned(o.id)
   or not public.delivery_resolution_delivery_closed(o.id)) then raise exception 'DELIVERY_RESOLUTION_DELIVERY_ACTIVE'; end if;
 if p_next in ('cancelled','pickup_rejected') and (o.fulfillment_status<>'cancelled' or o.refund_status is distinct from 'succeeded')
  then raise exception 'DELIVERY_RESOLUTION_CONFLICT'; end if;
 if p_next in ('pickup_accepting','pickup_accepted') then
  if not public.delivery_resolution_valid_pickup(o.branch_id,(o.delivery_resolution->>'pickupTime')::timestamptz,
   coalesce((o.delivery_resolution->>'timezoneOffsetMinutes')::integer,300))
   then raise exception 'DELIVERY_RESOLUTION_INVALID_SLOT'; end if;
 end if;
 if p_next='pickup_accepted' then
  if not exists(select 1 from public.fulfillment_slot_reservations where client_request_id=p_resolution
   and order_id=o.id and status='committed') then raise exception 'DELIVERY_RESOLUTION_INVALID_SLOT'; end if;
  update public.fulfillment_slot_reservations set status='released',updated_at=now()
   where order_id=o.id and fulfillment_type='delivery' and status in ('active','committed');
 end if;
 if p_next='delivery_resumed' then
  update public.fulfillment_slot_reservations set status='released',updated_at=now()
   where client_request_id=p_resolution and status in ('active','committed');
 end if;
 update public.kaspi_orders set delivery_resolution=o.delivery_resolution||jsonb_build_object('status',p_next,'error',null,
  'retryAt',now(),'reviewedAt',case when p_next in ('pickup_accepting','pickup_rejecting') then now() else
    (o.delivery_resolution->>'reviewedAt')::timestamptz end,
  'reviewedBy',coalesce(p_actor,o.delivery_resolution->>'reviewedBy')),
  fulfillment_type=case when p_next='pickup_accepted' then 'pickup' else fulfillment_type end,
  scheduled_at=case when p_next='pickup_accepted' then (delivery_resolution->>'pickupTime')::timestamptz else scheduled_at end,
  pickup_time=case when p_next='pickup_accepted' then delivery_resolution->>'pickupTime' else pickup_time end,
  courier_dispatch_status=case when p_next='pickup_accepted' then 'failed' else courier_dispatch_status end,
  courier_timeout_at=case when p_next in ('pickup_accepted','delivery_resumed') then null else courier_timeout_at end,
  updated_at=now() where id=o.id returning * into o;
 return to_jsonb(o);
end;
$$;

create or replace function public.guard_delivery_resolution_order()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare s text:=old.delivery_resolution->>'status';
begin
 if s in ('pending','pickup_cancelling','cancel_cancelling') and
  (new.courier_id is not null or new.courier_assigned_at is not null
   or new.delivery_status in ('assigned','picked_up','en_route','delivered')) then
  new.delivery_resolution:=old.delivery_resolution||jsonb_build_object('status','delivery_resumed','error',null);
  new.courier_timeout_at:=null;
  update public.fulfillment_slot_reservations set status='released',updated_at=now()
   where client_request_id=(old.delivery_resolution->>'id')::uuid and status in ('active','committed');
 elsif s in ('pickup_pending_approval','pickup_accepting','pickup_rejecting','cancel_refunding','pickup_accepted') and
  (new.courier_id is not null or new.courier_assigned_at is not null
   or new.delivery_status in ('assigned','picked_up','en_route','delivered')) then
  raise exception 'DELIVERY_RESOLUTION_CONFLICT';
 end if;
 if s in ('pending','pickup_cancelling','cancel_cancelling','pickup_pending_approval','pickup_accepting')
  and new.delivery_resolution->>'status' not in ('pickup_accepted','delivery_resumed')
  and (new.fulfillment_type is distinct from old.fulfillment_type
   or new.fulfillment_status is distinct from old.fulfillment_status
   or new.kitchen_status is distinct from old.kitchen_status) then raise exception 'DELIVERY_RESOLUTION_REVIEW_REQUIRED'; end if;
 return new;
end;
$$;
-- Run before the historical timeout guard, so an assignment can win before cancellation.
create trigger aa_delivery_resolution_order before update on public.kaspi_orders
 for each row execute function public.guard_delivery_resolution_order();
create or replace function public.guard_delivery_resolution_job()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare s text;
begin
 select delivery_resolution->>'status' into s from public.kaspi_orders where id=new.order_id for update;
 if s in ('pickup_cancelling','cancel_cancelling','pickup_pending_approval','pickup_accepting','pickup_rejecting','cancel_refunding','pickup_accepted')
  and (tg_op='INSERT' or new.provider_status in ('creating','creating_uncertain')
   or (s in ('pickup_pending_approval','pickup_accepting','pickup_accepted') and new.internal_status in ('assigned','picked_up','en_route','delivered')))
  then raise exception 'DELIVERY_RESOLUTION_CONFLICT'; end if;
 return new;
end;
$$;
create trigger aa_delivery_resolution_job before insert or update on public.delivery_jobs
 for each row execute function public.guard_delivery_resolution_job();

create or replace function public.poll_front_order_inbox(p_branch uuid,p_terminal uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer; v_first jsonb;
begin
 if p_terminal is null or not exists(select 1 from public.bulka_locations where id=p_branch and active)
  then raise exception 'Филиал не активен'; end if;
 insert into public.front_order_inbox_terminals(branch_id,terminal_id,last_seen_at) values(p_branch,p_terminal,now())
  on conflict(branch_id,terminal_id) do update set last_seen_at=excluded.last_seen_at
   where front_order_inbox_terminals.last_seen_at<now()-interval '10 seconds';
 select count(*) into v_count from public.kaspi_orders where branch_id=p_branch and status='paid'
  and (fulfillment_status='new' or delivery_resolution->>'status'='pickup_pending_approval')
  and coalesce(refund_status,'') in ('','partial','failed');
 select jsonb_build_array(jsonb_build_object('id',id,'number',order_number)) into v_first
  from public.kaspi_orders where branch_id=p_branch and status='paid'
   and (fulfillment_status='new' or delivery_resolution->>'status'='pickup_pending_approval')
   and coalesce(refund_status,'') in ('','partial','failed') order by created_at,id limit 1;
 return jsonb_build_object('total',v_count,'page',1,'orders',coalesce(v_first,'[]'::jsonb));
end;
$$;
create or replace function public.poll_front_order_board(p_branch uuid,p_terminal uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_inbox jsonb; v_revision text; v_newest bigint;
begin
 v_inbox:=public.poll_front_order_inbox(p_branch,p_terminal);
 select md5(coalesce(string_agg(o.id::text||':'||coalesce(o.updated_at::text,'')||':'||
  coalesce(o.fulfillment_status,'')||':'||coalesce(o.kitchen_status,'')||':'||o.pos_receipt_due::text||':'||
  coalesce(o.delivery_resolution::text,'')||':'||coalesce(j.changed::text,''),',' order by o.id),'')),
  coalesce(max(o.order_number) filter(where o.fulfillment_status='new' or o.delivery_resolution->>'status'='pickup_pending_approval'),0)
  into v_revision,v_newest from public.kaspi_orders o
  left join lateral(select max(d.updated_at) changed from public.delivery_jobs d where d.order_id=o.id) j on true
  where o.branch_id=p_branch and o.status='paid'
   and (coalesce(o.refund_status,'') in ('','partial','failed')
    or o.delivery_resolution->>'status' in ('pickup_accepting','pickup_rejecting','cancel_refunding'))
   and ((o.fulfillment_status in ('new','preparing','ready') and o.kitchen_status is distinct from 'handed_over')
    or o.delivery_resolution->>'status' in ('pickup_accepting','pickup_rejecting','cancel_refunding')
    or coalesce(o.handed_to_courier_at,o.fulfilled_at)>=now()-interval '24 hours' or o.pos_receipt_due);
 return v_inbox||jsonb_build_object('revision',v_revision,'newestOrderNumber',v_newest);
end;
$$;

revoke all on function public.delivery_resolution_unassigned(uuid),public.delivery_resolution_delivery_closed(uuid),
 public.delivery_resolution_fee_refunded(uuid),
 public.delivery_resolution_valid_pickup(uuid,timestamptz,integer),
 public.claim_delivery_resolutions(timestamptz),public.choose_delivery_resolution(uuid,uuid,text,timestamptz,integer),
 public.claim_delivery_resolution_work(uuid),public.finish_delivery_resolution(uuid,uuid,text,text),
 public.poll_front_order_inbox(uuid,uuid),public.poll_front_order_board(uuid,uuid),
 public.guard_delivery_resolution_order(),public.guard_delivery_resolution_job() from public,anon,authenticated;
grant execute on function public.delivery_resolution_unassigned(uuid),public.delivery_resolution_delivery_closed(uuid),
 public.delivery_resolution_fee_refunded(uuid),
 public.delivery_resolution_valid_pickup(uuid,timestamptz,integer),
 public.claim_delivery_resolutions(timestamptz),public.choose_delivery_resolution(uuid,uuid,text,timestamptz,integer),
 public.claim_delivery_resolution_work(uuid),public.finish_delivery_resolution(uuid,uuid,text,text),
 public.poll_front_order_inbox(uuid,uuid),public.poll_front_order_board(uuid,uuid) to service_role;
commit;

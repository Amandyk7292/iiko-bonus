-- Referral accounting is transactional; workers only deliver durable events.
alter table public.customers add column referral_bonus_debt numeric(12,2) not null default 0
  check (referral_bonus_debt >= 0);
alter table public.referral_redemptions
  add column review_state text not null default 'clear' check(review_state in ('clear','pending','approved','rejected')),
  add column risk_reasons text[] not null default '{}',
  add column reviewed_by text, add column review_note text, add column reviewed_at timestamptz,
  add column reversed_at timestamptz,
  add column owner_recovered numeric(12,2) not null default 0,
  add column friend_recovered numeric(12,2) not null default 0,
  add column owner_debt numeric(12,2) not null default 0,
  add column friend_debt numeric(12,2) not null default 0;
alter table public.referral_first_purchases add column refunded_amount numeric(12,2) not null default 0,
  add column attempts integer not null default 0, add column last_attempt_at timestamptz,
  add column last_error text, add column refund_recorded_by text, add column refund_note text;
create index referral_purchase_identity on public.referral_first_purchases(source,purchase_id);
create index referral_review_queue on public.referral_redemptions(created_at) where review_state='pending';

-- Old rewards predate snapshots. Recover amounts from the actual ledger, never
-- from today's configurable reward. Do not retroactively revoke old refunds.
update public.referral_redemptions r set
  reward_friend=coalesce(r.reward_friend,(select sum(t.amount) from public.transactions t
    where t.order_id='REFERRAL-'||r.id||':friend' and t.customer_id=r.referred_customer_id and t.type='deposit'),0),
  reward_referrer=coalesce(r.reward_referrer,(select sum(t.amount) from public.transactions t
    join public.referral_codes c on c.customer_id=t.customer_id
    where c.id=r.referral_code_id and t.order_id='REFERRAL-'||r.id||':owner' and t.type='deposit'),0),
  purchase_source=coalesce(r.purchase_source,'online'),purchase_id=coalesce(r.purchase_id,r.order_id)
where r.rewarded_at is not null and r.order_id is not null;
insert into public.referral_first_purchases(customer_id,source,purchase_id,amount,branch_id,purchased_at,state,refunded_amount)
select r.referred_customer_id,'online',o.id,o.amount,o.branch_id,coalesce(r.rewarded_at,r.created_at),
  case when o.status='refunded' then 'rejected' else 'done' end,
  case when o.status='refunded' then o.amount else greatest(0,coalesce(o.partially_refunded_amount,0)) end
from public.referral_redemptions r join public.kaspi_orders o on o.id=r.order_id
where r.rewarded_at is not null and r.status='rewarded' and o.amount>0
on conflict(customer_id) do update set source=excluded.source,purchase_id=excluded.purchase_id,
  amount=excluded.amount,branch_id=excluded.branch_id,purchased_at=excluded.purchased_at,
  state=excluded.state,refunded_amount=excluded.refunded_amount;

create table public.referral_devices (
  customer_id uuid not null references public.customers(id) on delete cascade,
  device_hash text not null check(length(device_hash)=64), created_at timestamptz not null default now(),
  primary key(customer_id,device_hash)
);
create index referral_device_hash on public.referral_devices(device_hash);
create table public.referral_events (
  id uuid primary key default gen_random_uuid(),
  redemption_id uuid not null references public.referral_redemptions(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  kind text not null check(kind in ('reward','reversal')),
  amount numeric(12,2) not null, debt numeric(12,2) not null default 0,
  created_at timestamptz not null default now(), delivered_at timestamptz,
  attempts integer not null default 0, last_error text,
  unique(redemption_id,customer_id,kind)
);
create index referral_events_pending on public.referral_events(created_at) where delivered_at is null;
alter table public.referral_devices enable row level security;
alter table public.referral_events enable row level security;
create policy referral_devices_service on public.referral_devices for all to service_role using(true) with check(true);
create policy referral_events_service on public.referral_events for all to service_role using(true) with check(true);
revoke all on public.referral_devices,public.referral_events from public,anon,authenticated;
grant all on public.referral_devices,public.referral_events to service_role;

update public.settings set value = (coalesce(value::jsonb,'{}') || jsonb_build_object(
  'max_invites_per_day',20,'max_rewards_per_month',30,'max_reward_amount_per_month',30000,
  'review_same_device',true))::text where key='bonus_referral';

create function public.collect_referral_bonus_debt() returns trigger
language plpgsql security definer set search_path=public as $$
declare collected numeric; held numeric;
begin
  if old.referral_bonus_debt > 0 then
    -- A checkout may debit and credit in one UPDATE. Recover from the resulting
    -- available balance, not only the net increase, without touching reservations.
    select coalesce(sum(discount_amount),0) into held from public.loyalty_reservations
      where customer_id=new.id and status='active' and expires_at>now();
    collected := least(greatest(0,new.balance-held),old.referral_bonus_debt);
    if collected<=0 then return new; end if;
    new.balance := new.balance-collected;
    new.referral_bonus_debt := greatest(0,new.referral_bonus_debt-collected);
    insert into public.transactions(customer_id,order_id,type,amount,description)
    values(new.id,'REFERRAL-DEBT-'||gen_random_uuid(),'refund_reversal',collected,
      'Погашение бонусного долга за возвращённую покупку по приглашению');
  end if;
  return new;
end; $$;
create trigger collect_referral_bonus_debt before update of balance on public.customers
for each row execute function public.collect_referral_bonus_debt();

-- Checkout updates balance before committing its reservation. Once released,
-- collect any remaining available cashback without touching other active holds.
create function public.collect_referral_debt_after_reservation() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.status='active' and new.status<>'active' then
    update public.customers set balance=balance where id=new.customer_id and referral_bonus_debt>0;
  end if;
  return new;
end; $$;
create trigger collect_referral_debt_after_reservation after update of status on public.loyalty_reservations
for each row execute function public.collect_referral_debt_after_reservation();
revoke all on function public.collect_referral_debt_after_reservation() from public,anon,authenticated;

-- Keep original eligibility checks, with serialized invitation limits and device review.
alter function public.redeem_referral_code(uuid,text) rename to redeem_referral_code_v1;
revoke all on function public.redeem_referral_code_v1(uuid,text) from public,anon,authenticated,service_role;
create function public.redeem_referral_code(p_customer_id uuid,p_code text)
returns public.referral_redemptions language plpgsql security definer set search_path=public as $$
declare c public.referral_codes%rowtype; r public.referral_redemptions%rowtype; s jsonb; device text;
begin
  select * into c from public.referral_codes where upper(code)=upper(btrim(p_code)) for update;
  select * into r from public.referral_redemptions where referred_customer_id=p_customer_id;
  if r.id is not null then return public.redeem_referral_code_v1(p_customer_id,p_code); end if;
  select value::jsonb into s from public.settings where key='bonus_referral';
  if (select count(*) from public.referral_redemptions where referral_code_id=c.id
      and created_at >= date_trunc('day',now() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty')
      >= coalesce((s->>'max_invites_per_day')::int,20) then raise exception 'referral invitation limit reached'; end if;
  r := public.redeem_referral_code_v1(p_customer_id,p_code);
  if coalesce((s->>'review_same_device')::boolean,true) and exists (
    select 1 from public.referral_devices mine join public.referral_devices d using(device_hash)
    where mine.customer_id=p_customer_id and d.customer_id<>p_customer_id
  ) then
    update public.referral_redemptions set review_state='pending',risk_reasons=array['shared_device']
    where id=r.id returning * into r;
  end if;
  return r;
end; $$;

-- Capture actual POS branch and refund totals, including refunds before reward processing.
create or replace function public.capture_referral_purchase() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='kaspi_orders' then
    if new.status='paid' and new.customer_id is not null and new.amount>0 then
      insert into public.referral_first_purchases(customer_id,source,purchase_id,amount,branch_id,refunded_amount)
      values(new.customer_id,'online',new.id,new.amount,new.branch_id,coalesce(new.partially_refunded_amount,0))
      on conflict(customer_id) do nothing;
    end if;
    update public.referral_first_purchases set refunded_amount=case when new.status='refunded' then amount
      else least(amount,greatest(0,coalesce(new.partially_refunded_amount,0))) end
    where source='online' and purchase_id=new.id;
  else
    if new.status='committed' and new.order_total-new.discount_amount>0 then
      insert into public.referral_first_purchases(customer_id,source,purchase_id,amount,branch_id)
      values(new.customer_id,'pos',new.id,new.order_total-new.discount_amount,new.pos_branch_id)
      on conflict(customer_id) do nothing;
    end if;
    if new.status='cancelled' and new.committed_at is not null then
      update public.referral_first_purchases set refunded_amount=amount where source='pos' and purchase_id=new.id;
    end if;
  end if;
  return new;
end; $$;
drop trigger referral_online_purchase on public.kaspi_orders;
create trigger referral_online_purchase after insert or update of status,partially_refunded_amount on public.kaspi_orders
for each row execute function public.capture_referral_purchase();
update public.referral_first_purchases p set branch_id=r.pos_branch_id
from public.loyalty_reservations r where p.source='pos' and p.purchase_id=r.id and p.branch_id is null;
update public.referral_first_purchases p set refunded_amount=case when o.status='refunded' then p.amount
  else least(p.amount,greatest(0,coalesce(o.partially_refunded_amount,0))) end
from public.kaspi_orders o where p.source='online' and p.purchase_id=o.id;

alter function public.process_referral_purchase(uuid) rename to process_referral_purchase_v1;
revoke all on function public.process_referral_purchase_v1(uuid) from public,anon,authenticated,service_role;
create function public.process_referral_purchase(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.referral_first_purchases%rowtype; r public.referral_redemptions%rowtype;
  c public.referral_codes%rowtype; s jsonb; result jsonb; n bigint; total numeric; since timestamptz;
begin
  select * into p from public.referral_first_purchases where customer_id=p_customer_id for update;
  if p.customer_id is null then return jsonb_build_object('status','not_found'); end if;
  select * into r from public.referral_redemptions where referred_customer_id=p_customer_id for update;
  if r.id is null then return public.process_referral_purchase_v1(p_customer_id); end if;
  if p.state<>'pending' then return jsonb_build_object('status','already_processed'); end if;
  if r.review_state='rejected' or p.amount-p.refunded_amount<=0
    or p.amount-p.refunded_amount<coalesce(r.min_first_order,0) then
    update public.referral_first_purchases set state='rejected' where customer_id=p_customer_id;
    update public.referral_redemptions set status='cancelled' where id=r.id;
    return jsonb_build_object('status','not_eligible');
  end if;
  if r.review_state='pending' then return jsonb_build_object('status','review'); end if;
  select * into c from public.referral_codes where id=r.referral_code_id for update;
  select value::jsonb into s from public.settings where key='bonus_referral';
  if r.review_state='clear' and coalesce((s->>'review_same_device')::boolean,true) and exists (
    select 1 from public.referral_devices mine join public.referral_devices d using(device_hash)
    where mine.customer_id=p_customer_id and d.customer_id<>p_customer_id
  ) then
    update public.referral_redemptions set review_state='pending',risk_reasons=array['shared_device'] where id=r.id;
    return jsonb_build_object('status','review');
  end if;
  since := date_trunc('month',now() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty';
  select count(*),coalesce(sum(reward_referrer),0) into n,total from public.referral_redemptions
    where referral_code_id=c.id and rewarded_at>=since;
  if r.review_state<>'approved' and (n>=coalesce((s->>'max_rewards_per_month')::int,30)
    or total+coalesce(r.reward_referrer,c.reward_referrer)>coalesce((s->>'max_reward_amount_per_month')::numeric,30000)) then
    update public.referral_redemptions set review_state='pending',risk_reasons=array['monthly_limit'] where id=r.id;
    return jsonb_build_object('status','review');
  end if;
  result := public.process_referral_purchase_v1(p_customer_id);
  if result->>'status'='rewarded' then
    insert into public.referral_events(redemption_id,customer_id,kind,amount)
    values(r.id,p_customer_id,'reward',(result->>'friendReward')::numeric),
      (r.id,c.customer_id,'reward',(result->>'ownerReward')::numeric)
    on conflict do nothing;
  end if;
  return result;
end; $$;

create function public.reverse_referral_purchase(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.referral_first_purchases%rowtype; r public.referral_redemptions%rowtype;
  owner_id uuid; friend_available numeric; owner_available numeric; f numeric; o numeric;
begin
  select * into p from public.referral_first_purchases where customer_id=p_customer_id for update;
  select * into r from public.referral_redemptions where referred_customer_id=p_customer_id for update;
  if r.status is distinct from 'rewarded' or r.reversed_at is not null then return jsonb_build_object('status','unchanged'); end if;
  if p.refunded_amount<=0 or (p.amount-p.refunded_amount>0 and p.amount-p.refunded_amount>=coalesce(r.min_first_order,0)) then
    return jsonb_build_object('status','unchanged'); end if;
  select customer_id into owner_id from public.referral_codes where id=r.referral_code_id;
  perform 1 from public.customers where id in(owner_id,p_customer_id) order by id for update;
  select greatest(0,balance-(select coalesce(sum(discount_amount),0) from public.loyalty_reservations
    where customer_id=p_customer_id and status='active' and expires_at>now())) into friend_available from public.customers where id=p_customer_id;
  select greatest(0,balance-(select coalesce(sum(discount_amount),0) from public.loyalty_reservations
    where customer_id=owner_id and status='active' and expires_at>now())) into owner_available from public.customers where id=owner_id;
  f:=least(friend_available,r.reward_friend); o:=least(owner_available,r.reward_referrer);
  update public.customers set balance=balance-f,referral_bonus_debt=referral_bonus_debt+r.reward_friend-f where id=p_customer_id;
  update public.customers set balance=balance-o,referral_bonus_debt=referral_bonus_debt+r.reward_referrer-o where id=owner_id;
  if f>0 then insert into public.transactions(customer_id,order_id,type,amount,description,branch_id)
    values(p_customer_id,'REFERRAL-RETURN-'||r.id||':friend','refund_reversal',f,'Возврат бонуса за приглашение',p.branch_id); end if;
  if o>0 then insert into public.transactions(customer_id,order_id,type,amount,description,branch_id)
    values(owner_id,'REFERRAL-RETURN-'||r.id||':owner','refund_reversal',o,'Возврат бонуса за приглашение',p.branch_id); end if;
  update public.referral_redemptions set status='cancelled',reversed_at=now(),friend_recovered=f,owner_recovered=o,
    friend_debt=reward_friend-f,owner_debt=reward_referrer-o where id=r.id;
  update public.referral_first_purchases set state='rejected' where customer_id=p_customer_id;
  insert into public.referral_events(redemption_id,customer_id,kind,amount,debt)
    values(r.id,p_customer_id,'reversal',r.reward_friend,r.reward_friend-f),
      (r.id,owner_id,'reversal',r.reward_referrer,r.reward_referrer-o) on conflict do nothing;
  return jsonb_build_object('status','reversed','friendCustomerId',p_customer_id,'ownerCustomerId',owner_id);
end; $$;

create function public.review_referral(p_id uuid,p_action text,p_actor text,p_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.referral_redemptions%rowtype;
begin
  if p_action not in ('approve','reject') or length(btrim(p_note))<3 then raise exception 'invalid review'; end if;
  select * into r from public.referral_redemptions where id=p_id for update;
  if r.id is null then raise exception 'referral not found'; end if;
  if r.review_state<>'pending' then return jsonb_build_object('status','already_reviewed'); end if;
  update public.referral_redemptions set review_state=case when p_action='approve' then 'approved' else 'rejected' end,
    reviewed_at=now(),reviewed_by=p_actor,review_note=btrim(p_note) where id=p_id;
  return jsonb_build_object('status','reviewed');
end; $$;

revoke all on function public.collect_referral_bonus_debt(),public.redeem_referral_code(uuid,text),
  public.process_referral_purchase(uuid),public.reverse_referral_purchase(uuid),public.review_referral(uuid,text,text,text)
from public,anon,authenticated;
grant execute on function public.redeem_referral_code(uuid,text),public.process_referral_purchase(uuid),
  public.reverse_referral_purchase(uuid),public.review_referral(uuid,text,text,text) to service_role;

create function public.customer_referral_history(p_customer_id uuid,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path=public as $$
  with invitations as (
    select r.*,p.purchased_at,row_number() over(order by r.created_at,r.id) as number
    from public.referral_redemptions r join public.referral_codes c on c.id=r.referral_code_id
    left join public.referral_first_purchases p on p.customer_id=r.referred_customer_id
    where c.customer_id=p_customer_id
  ), page as (
    select jsonb_build_object('id',id,'number',number,'registeredAt',created_at,
      'purchased',purchased_at is not null,'status',case when reversed_at is not null then 'reversed'
        when review_state='pending' then 'review' when review_state='rejected' then 'cancelled'
        when purchased_at is not null and status='registered' then 'qualified' else status end,
      'reward',case when rewarded_at is not null then reward_referrer else 0 end) as item
    from invitations order by created_at desc,id desc limit 30 offset greatest(0,p_offset)
  ) select jsonb_build_object('registered',(select count(*) from invitations),
    'purchased',(select count(*) from invitations where purchased_at is not null),
    'earned',coalesce((select sum(reward_referrer) from invitations where rewarded_at is not null),0),
    'reversed',coalesce((select sum(reward_referrer) from invitations where reversed_at is not null),0),
    'debt',coalesce((select referral_bonus_debt from public.customers where id=p_customer_id),0),
    'items',coalesce((select jsonb_agg(item) from page),'[]'::jsonb));
$$;

-- Cohort report: dates select registrations; branch is the first purchase branch.
-- Unpurchased invitations belong only to the unassigned/all-branches cohort.
create function public.admin_referral_report(p_from timestamptz,p_to timestamptz,
  p_branches uuid[] default '{}',p_offset integer default 0)
returns jsonb language sql stable security definer set search_path=public as $$
  with cohort as (
    select r.*,c.customer_id owner_id,owner.name owner_name,friend.name friend_name,p.branch_id,p.purchased_at,p.amount,p.refunded_amount,p.state,
      p.attempts,p.last_attempt_at,p.last_error,p.source first_purchase_source,l.name branch_name
    from public.referral_redemptions r join public.referral_codes c on c.id=r.referral_code_id
    join public.customers owner on owner.id=c.customer_id
    join public.customers friend on friend.id=r.referred_customer_id
    left join public.referral_first_purchases p on p.customer_id=r.referred_customer_id
    left join public.bulka_locations l on l.id=p.branch_id
    where r.created_at>=p_from and r.created_at<p_to
      and (cardinality(p_branches)=0 or p.branch_id=any(p_branches))
  ), stalled as (
    select r.id,p.purchased_at,p.last_error,l.name branch_name
    from public.referral_first_purchases p join public.referral_redemptions r on r.referred_customer_id=p.customer_id
    left join public.bulka_locations l on l.id=p.branch_id
    where p.state='pending' and r.review_state<>'pending' and p.purchased_at<now()-interval '5 minutes'
      and (cardinality(p_branches)=0 or p.branch_id=any(p_branches))
  ), notifications as (
    select e.id,e.last_error from public.referral_events e
    join public.referral_redemptions r on r.id=e.redemption_id
    left join public.referral_first_purchases p on p.customer_id=r.referred_customer_id
    where e.delivered_at is null and (cardinality(p_branches)=0 or p.branch_id=any(p_branches))
  ), summary as (
    select count(*) invitations,count(purchased_at) purchases,
      coalesce(sum(greatest(0,amount-refunded_amount)),0) revenue,
      coalesce(sum(reward_referrer+reward_friend) filter(where rewarded_at is not null),0) awarded,
      coalesce(sum(reward_referrer+reward_friend) filter(where reversed_at is not null),0) reversed,
      coalesce(sum(owner_debt+friend_debt),0) debt_created,
      count(*) filter(where review_state='pending') review,
      count(*) filter(where state='pending' and review_state<>'pending' and purchased_at<now()-interval '5 minutes') delayed
    from cohort
  ), branches as (
    select branch_id,coalesce(branch_name,'Без покупки / филиала') name,count(*) invitations,count(purchased_at) purchases,
      coalesce(sum(greatest(0,amount-refunded_amount)),0) revenue,
      coalesce(sum(reward_referrer+reward_friend) filter(where rewarded_at is not null and reversed_at is null),0) rewards
    from cohort group by branch_id,branch_name
  ), page as (
    select id,created_at,status,review_state,risk_reasons,reviewed_by,reviewed_at,review_note,
      rewarded_at,reversed_at,branch_id,branch_name,purchased_at,amount,refunded_amount,
      reward_referrer,reward_friend,owner_id,owner_name,friend_name,referred_customer_id,attempts,last_attempt_at,last_error,first_purchase_source
    from cohort order by (review_state='pending') desc,created_at desc,id desc limit 50 offset greatest(0,p_offset)
  ) select jsonb_build_object('summary',(select to_jsonb(summary) from summary),
    'health',jsonb_build_object('delayed',(select count(*) from stalled),
      'pendingNotifications',(select count(*) from notifications),
      'failedNotifications',(select count(*) from notifications where last_error is not null),
      'items',coalesce((select jsonb_agg(to_jsonb(s)) from (select * from stalled order by purchased_at limit 20) s),'[]'::jsonb)),
    'branches',coalesce((select jsonb_agg(to_jsonb(branches) order by revenue desc) from branches),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb));
$$;
revoke all on function public.customer_referral_history(uuid,integer),
  public.admin_referral_report(timestamptz,timestamptz,uuid[],integer) from public,anon,authenticated;
grant execute on function public.customer_referral_history(uuid,integer),
  public.admin_referral_report(timestamptz,timestamptz,uuid[],integer) to service_role;

-- Older POS plugins do not transmit returns. An administrator can record the
-- cumulative confirmed return against the existing first purchase, never a new award.
create function public.record_referral_pos_return(p_id uuid,p_total numeric,p_actor text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare customer uuid; p public.referral_first_purchases%rowtype;
begin
  select referred_customer_id into customer from public.referral_redemptions where id=p_id;
  select * into p from public.referral_first_purchases where customer_id=customer for update;
  if p.source is distinct from 'pos' or p_total is null or p_total<=0 or p_total>p.amount
    or p_total<p.refunded_amount or length(btrim(p_note))<3 then raise exception 'invalid POS return'; end if;
  update public.referral_first_purchases set refunded_amount=p_total,refund_recorded_by=p_actor,
    refund_note=btrim(p_note) where customer_id=customer;
  return public.reverse_referral_purchase(customer);
end; $$;
revoke all on function public.record_referral_pos_return(uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.record_referral_pos_return(uuid,numeric,text,text) to service_role;

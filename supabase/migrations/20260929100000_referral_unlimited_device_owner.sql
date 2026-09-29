-- Unlimited invitations; one referral-beneficiary account per installation.
-- Claims deliberately survive customer deletion and reward refunds.
create table public.referral_device_owners (
 device_hash text primary key check(length(device_hash)=64),
 customer_id uuid not null, created_at timestamptz not null default now()
);
alter table public.referral_device_owners enable row level security;
revoke all on public.referral_device_owners from public,anon,authenticated;
grant select,insert on public.referral_device_owners to service_role;
create policy referral_device_owners_service on public.referral_device_owners
 for all to service_role using(true) with check(true);
insert into public.referral_device_owners(device_hash,customer_id,created_at)
select distinct on(device_hash) device_hash,customer_id,created_at
from public.referral_devices order by device_hash,created_at,customer_id;

create function public.claim_referral_device_owner() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.referral_device_owners(device_hash,customer_id)
 values(new.device_hash,new.customer_id) on conflict(device_hash) do nothing;
 return new;
end; $$;
create trigger claim_referral_device_owner after insert on public.referral_devices
for each row execute function public.claim_referral_device_owner();
revoke all on function public.claim_referral_device_owner() from public,anon,authenticated;

create function public.referral_device_risk(p_customer_id uuid) returns text
language sql stable security definer set search_path=public as $$
 select case
 when not exists(select 1 from public.referral_devices where customer_id=p_customer_id) then 'missing_device'
 when exists(select 1 from public.referral_devices d join public.referral_device_owners o using(device_hash)
   where d.customer_id=p_customer_id and o.customer_id<>p_customer_id) then 'shared_device'
 else null end;
$$;
revoke all on function public.referral_device_risk(uuid) from public,anon,authenticated;
grant execute on function public.referral_device_risk(uuid) to service_role;

update public.settings set value=(value::jsonb || jsonb_build_object(
 'max_invites_per_day',0,'max_rewards_per_month',0,'max_reward_amount_per_month',0,
 'review_same_device',true))::text where key='bonus_referral';
update public.referral_codes set max_uses=null where max_uses is not null;

create or replace function public.redeem_referral_code_v1(p_customer_id uuid, p_code text)
returns public.referral_redemptions language plpgsql security definer set search_path = public as $$
declare
  v_code public.referral_codes%rowtype;
  v_redemption public.referral_redemptions%rowtype;
  v_settings jsonb;
begin
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then raise exception 'customer not found'; end if;
  select * into v_code from public.referral_codes where upper(code) = upper(btrim(p_code));
  if v_code.id is null or not v_code.active then raise exception 'referral not found'; end if;
  if v_code.customer_id = p_customer_id then raise exception 'own referral'; end if;
  select * into v_redemption from public.referral_redemptions where referred_customer_id = p_customer_id;
  if v_redemption.id is not null then
    if v_redemption.referral_code_id = v_code.id then return v_redemption; end if;
    raise exception 'referral already redeemed';
  end if;
  select value::jsonb into v_settings from public.settings where key = 'bonus_referral';
  if not coalesce((v_settings->>'enabled')::boolean, false) then raise exception 'referral disabled'; end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then raise exception 'referral expired'; end if;
  if exists (select 1 from public.customers where id = p_customer_id and total_spent > 0)
    or exists (select 1 from public.kaspi_orders where customer_id = p_customer_id and status in ('paid', 'refunded'))
    or exists (select 1 from public.loyalty_reservations where customer_id = p_customer_id and committed_at is not null)
    or exists (select 1 from public.referral_first_purchases where customer_id = p_customer_id) then
    raise exception 'referral requires first order';
  end if;
  insert into public.referral_redemptions(referral_code_id, referred_customer_id, reward_referrer, reward_friend, min_first_order)
  values (v_code.id, p_customer_id, greatest(0, (v_settings->>'inviter_bonus')::numeric),
    greatest(0, (v_settings->>'friend_bonus')::numeric), greatest(0, (v_settings->>'min_first_order')::numeric))
  returning * into v_redemption;
  return v_redemption;
end;
$$;

create or replace function public.process_referral_purchase_v1(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_purchase public.referral_first_purchases%rowtype;
  v_redemption public.referral_redemptions%rowtype;
  v_code public.referral_codes%rowtype;
  v_friend numeric;
  v_owner numeric;
begin
  select * into v_purchase from public.referral_first_purchases where customer_id = p_customer_id for update;
  if v_purchase.customer_id is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_purchase.state <> 'pending' then return jsonb_build_object('status', 'already_processed'); end if;
  select * into v_redemption from public.referral_redemptions where referred_customer_id = p_customer_id for update;
  if v_redemption.id is null or v_redemption.status not in ('registered', 'qualified')
    or v_redemption.created_at > v_purchase.purchased_at
    or v_purchase.amount < coalesce(v_redemption.min_first_order, 0) then
    update public.referral_first_purchases set state = 'rejected' where customer_id = p_customer_id;
    return jsonb_build_object('status', 'not_eligible');
  end if;
  if (v_purchase.source = 'online' and not exists (
      select 1 from public.kaspi_orders where id = v_purchase.purchase_id and status = 'paid'))
    or (v_purchase.source = 'pos' and not exists (
      select 1 from public.loyalty_reservations where id = v_purchase.purchase_id and status = 'committed')) then
    update public.referral_first_purchases set state = 'rejected' where customer_id = p_customer_id;
    return jsonb_build_object('status', 'cancelled');
  end if;
  select * into v_code from public.referral_codes where id = v_redemption.referral_code_id for update;
  perform 1 from public.customers where id in (p_customer_id, v_code.customer_id) order by id for update;
  v_friend := coalesce(v_redemption.reward_friend, v_code.reward_friend, 0);
  v_owner := coalesce(v_redemption.reward_referrer, v_code.reward_referrer, 0);
  if v_friend > 0 then
    insert into public.transactions(customer_id, order_id, type, amount, description, branch_id)
    values (p_customer_id, 'REFERRAL-' || v_redemption.id || ':friend', 'deposit', v_friend, 'Бонус за первую покупку по приглашению', v_purchase.branch_id);
    update public.customers set balance = balance + v_friend, updated_at = now() where id = p_customer_id;
  end if;
  if v_owner > 0 then
    insert into public.transactions(customer_id, order_id, type, amount, description, branch_id)
    values (v_code.customer_id, 'REFERRAL-' || v_redemption.id || ':owner', 'deposit', v_owner, 'Друг совершил первую покупку', v_purchase.branch_id);
    update public.customers set balance = balance + v_owner, updated_at = now() where id = v_code.customer_id;
  end if;
  update public.referral_redemptions set status = 'rewarded', rewarded_at = now(),
    reward_friend = v_friend, reward_referrer = v_owner,
    purchase_source = v_purchase.source, purchase_id = v_purchase.purchase_id,
    order_id = case when v_purchase.source = 'online' then v_purchase.purchase_id else null end
  where id = v_redemption.id;
  update public.referral_codes set uses_count = uses_count + 1 where id = v_code.id;
  update public.referral_first_purchases set state = 'done' where customer_id = p_customer_id;
  return jsonb_build_object('status', 'rewarded', 'friendCustomerId', p_customer_id,
    'ownerCustomerId', v_code.customer_id, 'friendReward', v_friend, 'ownerReward', v_owner);
end;
$$;


create or replace function public.redeem_referral_code(p_customer_id uuid,p_code text)
returns public.referral_redemptions language plpgsql security definer set search_path=public as $$
declare r public.referral_redemptions%rowtype; risk text;
begin
 r := public.redeem_referral_code_v1(p_customer_id,p_code);
 risk := public.referral_device_risk(p_customer_id);
 if risk is not null and r.status in ('registered','qualified') then
  update public.referral_redemptions set review_state='pending',risk_reasons=array[risk]
  where id=r.id returning * into r;
 end if;
 return r;
end; $$;

create or replace function public.process_referral_purchase(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.referral_first_purchases%rowtype; r public.referral_redemptions%rowtype;
  c public.referral_codes%rowtype; result jsonb; risk text;
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
  select * into c from public.referral_codes where id=r.referral_code_id for update;
  risk := coalesce(public.referral_device_risk(p_customer_id),public.referral_device_risk(c.customer_id));
  -- Always check both beneficiaries, including manually approved redemptions.
  if risk is not null then
    update public.referral_redemptions set review_state='pending',risk_reasons=array[risk] where id=r.id;
    return jsonb_build_object('status','review','reason',risk);
  end if;
  if r.review_state='pending' then
    if cardinality(r.risk_reasons)>0 and r.risk_reasons <@ array['monthly_limit','shared_device','missing_device']::text[] then
      update public.referral_redemptions set review_state='clear',risk_reasons='{}' where id=r.id;
    else
      return jsonb_build_object('status','review');
    end if;
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


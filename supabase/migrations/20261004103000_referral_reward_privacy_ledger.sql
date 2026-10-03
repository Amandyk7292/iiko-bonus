-- Reward accounting must survive removal of referral links and profile PII.
-- Store only financial UUIDs/amounts; no names, phones or referral codes.
-- migration-safety: allow-destructive reason=replace_marketing_fk_with_backfilled_financial_fk_preserving_all_events
-- Reviewed metadata-only FK replacement: no table/column/data is removed;
-- all existing event targets are backfilled before the new FK is validated.
create table public.referral_reward_ledger (
  redemption_id uuid primary key,
  friend_customer_id uuid not null,
  owner_customer_id uuid not null,
  reward_friend numeric(12,2) not null check(reward_friend>=0),
  reward_referrer numeric(12,2) not null check(reward_referrer>=0),
  min_first_order numeric(12,2) not null check(min_first_order>=0),
  branch_id uuid,
  rewarded_at timestamptz not null,
  reversed_at timestamptz,
  friend_recovered numeric(12,2) not null default 0,
  owner_recovered numeric(12,2) not null default 0,
  friend_debt numeric(12,2) not null default 0,
  owner_debt numeric(12,2) not null default 0
);
create index referral_reward_ledger_friend on public.referral_reward_ledger(friend_customer_id);
insert into public.referral_reward_ledger(redemption_id,friend_customer_id,owner_customer_id,reward_friend,reward_referrer,
  min_first_order,branch_id,rewarded_at,reversed_at,friend_recovered,owner_recovered,friend_debt,owner_debt)
select r.id,r.referred_customer_id,c.customer_id,coalesce(r.reward_friend,0),coalesce(r.reward_referrer,0),
  coalesce(r.min_first_order,0),p.branch_id,coalesce(r.rewarded_at,r.created_at),r.reversed_at,
  r.friend_recovered,r.owner_recovered,r.friend_debt,r.owner_debt
from public.referral_redemptions r join public.referral_codes c on c.id=r.referral_code_id
left join public.referral_first_purchases p on p.customer_id=r.referred_customer_id
where r.rewarded_at is not null or exists(select 1 from public.referral_events e where e.redemption_id=r.id);

create function public.snapshot_referral_reward() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status='rewarded' then
    insert into public.referral_reward_ledger(redemption_id,friend_customer_id,owner_customer_id,reward_friend,
      reward_referrer,min_first_order,branch_id,rewarded_at)
    select new.id,new.referred_customer_id,c.customer_id,coalesce(new.reward_friend,0),coalesce(new.reward_referrer,0),
      coalesce(new.min_first_order,0),p.branch_id,coalesce(new.rewarded_at,now())
    from public.referral_codes c left join public.referral_first_purchases p on p.customer_id=new.referred_customer_id
    where c.id=new.referral_code_id on conflict(redemption_id) do nothing;
  end if;
  if new.reversed_at is not null then
    update public.referral_reward_ledger set reversed_at=new.reversed_at,friend_recovered=new.friend_recovered,
      owner_recovered=new.owner_recovered,friend_debt=new.friend_debt,owner_debt=new.owner_debt where redemption_id=new.id;
  end if;
  return new;
end; $$;
create trigger referral_reward_snapshot after insert or update on public.referral_redemptions
  for each row execute function public.snapshot_referral_reward();

-- Durable reward/reversal events reference the financial snapshot, rather
-- than a marketing link that privacy deletion is required to remove.
alter table public.referral_events drop constraint referral_events_redemption_id_fkey;
alter table public.referral_events add constraint referral_events_reward_ledger_fkey
  foreign key(redemption_id) references public.referral_reward_ledger(redemption_id) on delete restrict;

alter function public.reverse_referral_purchase(uuid) rename to reverse_referral_purchase_with_link;
create function public.reverse_referral_purchase(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.referral_first_purchases%rowtype; r public.referral_reward_ledger%rowtype;
  friend_available numeric; owner_available numeric; f numeric; o numeric; friend_active boolean; owner_active boolean;
begin
  select * into p from public.referral_first_purchases where customer_id=p_customer_id for update;
  if not found then return jsonb_build_object('status','unchanged'); end if;
  if exists(select 1 from public.referral_redemptions where referred_customer_id=p_customer_id) then
    return public.reverse_referral_purchase_with_link(p_customer_id);
  end if;
  select * into r from public.referral_reward_ledger where friend_customer_id=p_customer_id
    order by rewarded_at desc limit 1 for update;
  if not found or r.reversed_at is not null or p.refunded_amount<=0
    or (p.amount-p.refunded_amount>0 and p.amount-p.refunded_amount>=r.min_first_order) then
    return jsonb_build_object('status','unchanged'); end if;
  perform 1 from public.customers where id in(r.friend_customer_id,r.owner_customer_id) order by id for update;
  select deleted_at is null,greatest(0,balance-(select coalesce(sum(discount_amount),0) from public.loyalty_reservations
    where customer_id=r.friend_customer_id and status='active' and expires_at>now()))
    into friend_active,friend_available from public.customers where id=r.friend_customer_id;
  select deleted_at is null,greatest(0,balance-(select coalesce(sum(discount_amount),0) from public.loyalty_reservations
    where customer_id=r.owner_customer_id and status='active' and expires_at>now()))
    into owner_active,owner_available from public.customers where id=r.owner_customer_id;
  f:=case when friend_active then least(friend_available,r.reward_friend) else 0 end;
  o:=case when owner_active then least(owner_available,r.reward_referrer) else 0 end;
  if friend_active then
    update public.customers set balance=balance-f,referral_bonus_debt=referral_bonus_debt+r.reward_friend-f where id=r.friend_customer_id;
    if f>0 then insert into public.transactions(customer_id,order_id,type,amount,description,branch_id)
      values(r.friend_customer_id,'REFERRAL-RETURN-'||r.redemption_id||':friend','refund_reversal',f,'Возврат бонуса за приглашение',p.branch_id); end if;
    insert into public.referral_events(redemption_id,customer_id,kind,amount,debt)
      values(r.redemption_id,r.friend_customer_id,'reversal',r.reward_friend,r.reward_friend-f) on conflict do nothing;
  end if;
  if owner_active then
    update public.customers set balance=balance-o,referral_bonus_debt=referral_bonus_debt+r.reward_referrer-o where id=r.owner_customer_id;
    if o>0 then insert into public.transactions(customer_id,order_id,type,amount,description,branch_id)
      values(r.owner_customer_id,'REFERRAL-RETURN-'||r.redemption_id||':owner','refund_reversal',o,'Возврат бонуса за приглашение',p.branch_id); end if;
    insert into public.referral_events(redemption_id,customer_id,kind,amount,debt)
      values(r.redemption_id,r.owner_customer_id,'reversal',r.reward_referrer,r.reward_referrer-o) on conflict do nothing;
  end if;
  update public.referral_reward_ledger set reversed_at=now(),friend_recovered=f,owner_recovered=o,
    friend_debt=case when friend_active then r.reward_friend-f else 0 end,
    owner_debt=case when owner_active then r.reward_referrer-o else 0 end where redemption_id=r.redemption_id;
  update public.referral_first_purchases set state='rejected' where customer_id=p_customer_id;
  return jsonb_build_object('status','reversed','friendCustomerId',case when friend_active then r.friend_customer_id end,
    'ownerCustomerId',case when owner_active then r.owner_customer_id end);
end; $$;

create function public.suppress_deleted_customer_referral_events() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.referral_events set delivered_at=coalesce(delivered_at,now()),last_error=null where customer_id=new.id;
  end if;
  return new;
end; $$;
create trigger referral_events_customer_deleted after update of deleted_at on public.customers
  for each row execute function public.suppress_deleted_customer_referral_events();
alter table public.referral_reward_ledger enable row level security;
create policy service_role_referral_reward_ledger on public.referral_reward_ledger for all to service_role using(true) with check(true);
revoke all on public.referral_reward_ledger from public,anon,authenticated;
grant all on public.referral_reward_ledger to service_role;
revoke all on function public.snapshot_referral_reward(),public.reverse_referral_purchase_with_link(uuid),
  public.reverse_referral_purchase(uuid),public.suppress_deleted_customer_referral_events() from public,anon,authenticated,service_role;
grant execute on function public.reverse_referral_purchase(uuid) to service_role;

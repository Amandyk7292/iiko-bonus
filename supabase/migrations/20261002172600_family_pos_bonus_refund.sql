-- Family wallet refunds and cashback reversals form one transaction.
-- The original payment permanently determines the owner and physical receipt.
alter table public.personal_account_pos_payments
  add column if not exists family_bonus_reversed_at timestamptz,
  add column if not exists family_bonus_refund jsonb;

create or replace function public.family_pos_bonus_order_key(p_branch_id uuid,p_order_id uuid) returns text
language sql immutable security definer set search_path=public as $$
  select 'bp1:'||p_branch_id::text||':'||encode(sha256(
    convert_to(p_branch_id::text,'UTF8')||decode('00','hex')||convert_to(p_order_id::text,'UTF8')),'hex');
$$;
create index if not exists family_pos_bonus_receipt on public.personal_account_pos_payments
  (branch_id,(public.family_pos_bonus_order_key(branch_id,iiko_order_id)),created_at desc)
  where family_member_id is not null;

create or replace function public.family_pos_reverse_cashback(p_payment_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.personal_account_pos_payments%rowtype; c public.customers%rowtype;
  order_key text; earned numeric:=0; pending numeric:=0; spent numeric:=0; real_money numeric:=0;
  held numeric:=0; removed numeric:=0; unrecovered numeric:=0; result jsonb;
begin
  select * into p from public.personal_account_pos_payments where id=p_payment_id for update;
  if p.id is null or p.family_member_id is null or p.status<>'refunded' then raise exception 'family refund claim conflict'; end if;
  select * into c from public.customers where id=p.customer_id for update;
  if c.id is null then raise exception 'customer not found'; end if;
  if p.family_bonus_reversed_at is not null then return p.family_bonus_refund||jsonb_build_object('duplicate',true); end if;
  order_key:=public.family_pos_bonus_order_key(p.branch_id,p.iiko_order_id);
  select coalesce(sum(amount) filter(where type='deposit'),0),
    coalesce(sum(amount) filter(where type='pending_deposit'),0),
    coalesce(sum(amount) filter(where type='withdrawal'),0),
    coalesce(sum(order_total) filter(where type in ('deposit','pending_deposit','cancelled_deposit','order')),0)
    into earned,pending,spent,real_money from public.transactions
    where customer_id=p.customer_id and order_id=order_key;
  -- Release this receipt's uncommitted reservation, preserving every other hold.
  update public.loyalty_reservations set status='cancelled',cancelled_at=now(),updated_at=now()
    where customer_id=p.customer_id and order_id=order_key and status='active';
  update public.branch_pos_loyalty_usage set status='cancelled',updated_at=now()
    where customer_id=p.customer_id and order_id=order_key and status='active';
  update public.transactions set amount=0,type='cancelled_deposit',activated_at=coalesce(activated_at,now()),
    description=coalesce(description,'')||' / отменён возвратом семейной оплаты'
    where customer_id=p.customer_id and order_id=order_key and type='pending_deposit';
  select coalesce(sum(discount_amount),0) into held from public.loyalty_reservations
    where customer_id=p.customer_id and status='active' and expires_at>now();
  removed:=least(earned,greatest(0,c.balance+spent-held));
  unrecovered:=greatest(0,earned-removed);
  update public.customers set balance=greatest(0,balance+spent-removed),
    total_spent=greatest(0,total_spent-real_money),updated_at=now() where id=p.customer_id returning * into c;
  if spent>0 then
    insert into public.transactions(customer_id,order_id,branch_id,type,amount,order_total,description)
      values(p.customer_id,order_key||':refund:restore',p.branch_id,'refund_bonus_restore',spent,real_money,'Возврат списанных бонусов семейного чека');
  end if;
  insert into public.transactions(customer_id,order_id,branch_id,type,amount,order_total,description)
    values(p.customer_id,order_key||':refund',p.branch_id,'refund_reversal',earned+pending,real_money,
      'Возврат семейного чека; снято='||removed::text||'; отменено ожидающее='||pending::text||'; не взыскано='||unrecovered::text);
  result:=jsonb_build_object('duplicate',false,'applied',earned+pending+spent+real_money>0,'balance',c.balance,
    'earnedBonusReversed',earned+pending,'pendingBonusCancelled',pending,'activeBonusRemoved',removed,
    'unrecoveredBonus',unrecovered,'spentBonusRestored',spent,'realMoneyReversed',real_money);
  update public.personal_account_pos_payments set family_bonus_reversed_at=now(),family_bonus_refund=result where id=p.id;
  return result;
end $$;

do $$ begin
  if to_regprocedure('public.personal_account_pos_family_base_action(uuid,uuid,uuid,bigint,text,text,text,uuid)') is null then
    alter function public.personal_account_pos_action(uuid,uuid,uuid,bigint,text,text,text,uuid) rename to personal_account_pos_family_base_action;
  end if;
  if to_regprocedure('public.family_pos_base_reserve(uuid,uuid,text,numeric,numeric,numeric,integer,numeric,numeric,integer,numeric,numeric)') is null then
    alter function public.reserve_branch_loyalty_balance(uuid,uuid,text,numeric,numeric,numeric,integer,numeric,numeric,integer,numeric,numeric) rename to family_pos_base_reserve;
  end if;
  if to_regprocedure('public.family_pos_base_commit(uuid,uuid,text,uuid,numeric,numeric,integer,jsonb,numeric,numeric,numeric,numeric)') is null then
    alter function public.commit_branch_loyalty_reservation(uuid,uuid,text,uuid,numeric,numeric,integer,jsonb,numeric,numeric,numeric,numeric) rename to family_pos_base_commit;
  end if;
end $$;

create or replace function public.personal_account_pos_action(p_id uuid,p_branch_id uuid,p_order_id uuid,p_amount_minor bigint,p_fingerprint text,
  p_action text,p_code_hash text default null,p_transaction_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.personal_account_pos_payments%rowtype; result jsonb; reversal jsonb;
begin
  select * into p from public.personal_account_pos_payments where id=p_id and branch_id=p_branch_id;
  if p.family_member_id is not null then
    -- Same branch -> customer lock order as scoped loyalty reserve/commit.
    -- Customer is locked before the personal wallet or its payment intent.
    perform pg_advisory_xact_lock(hashtextextended('branch-pos-loyalty:'||p_branch_id::text,0));
    perform pg_advisory_xact_lock(hashtext(p.customer_id::text));
    perform 1 from public.customers where id=p.customer_id for update;
  end if;
  result:=public.personal_account_pos_family_base_action(p_id,p_branch_id,p_order_id,p_amount_minor,p_fingerprint,p_action,p_code_hash,p_transaction_id);
  if p.family_member_id is not null and result->>'status'='refunded' then
    reversal:=public.family_pos_reverse_cashback(p.id);
    result:=result||jsonb_build_object('familyBonusRefund',reversal);
  end if;
  return result;
end $$;

create or replace function public.reserve_branch_loyalty_balance(p_branch_id uuid,p_customer_id uuid,p_order_id text,p_order_total numeric,
  p_discount_amount numeric,p_max_discount_percent numeric,p_ttl_hours integer,p_max_order_total numeric,p_max_discount_amount numeric,
  p_rolling_order_count integer,p_rolling_order_total numeric,p_rolling_discount_amount numeric) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.personal_account_pos_payments%rowtype; current_balance numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('branch-pos-loyalty:'||p_branch_id::text,0));
  select * into p from public.personal_account_pos_payments
    where branch_id=p_branch_id and family_member_id is not null
      and (status in ('paid','refunded') or (status in ('pending','authorized') and expires_at>now()))
      and public.family_pos_bonus_order_key(branch_id,iiko_order_id)=p_order_id
    order by case when status in ('paid','refunded') then 0 else 1 end,created_at desc,id desc limit 1;
  if p.id is not null then
    if p.customer_id<>p_customer_id or p_order_total is null or abs(p_order_total-p.amount_minor/100.0)>0.001
      or p_discount_amount is distinct from 0 then raise exception 'family loyalty claim conflict'; end if;
    perform pg_advisory_xact_lock(hashtext(p.customer_id::text));
    select balance into current_balance from public.customers where id=p.customer_id for update;
    select * into p from public.personal_account_pos_payments where id=p.id for update;
    if p.status='refunded' then
      return jsonb_build_object('status','family_refunded','balance',current_balance,'customer_id',p.customer_id,
        'discount_applied',0,'earned_bonus',0,'duplicate',true);
    end if;
    if p.status<>'paid' then raise exception 'family payment not paid'; end if;
  end if;
  return public.family_pos_base_reserve(p_branch_id,p_customer_id,p_order_id,p_order_total,p_discount_amount,p_max_discount_percent,
    p_ttl_hours,p_max_order_total,p_max_discount_amount,p_rolling_order_count,p_rolling_order_total,p_rolling_discount_amount);
end $$;

create or replace function public.commit_branch_loyalty_reservation(p_branch_id uuid,p_customer_id uuid,p_order_id text,p_reservation_id uuid,
  p_order_total numeric,p_earned_bonus numeric,p_activation_delay_days integer,p_items jsonb,p_max_order_total numeric,
  p_max_discount_amount numeric,p_max_earned_bonus numeric,p_rolling_earned_bonus numeric) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.personal_account_pos_payments%rowtype; current_balance numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('branch-pos-loyalty:'||p_branch_id::text,0));
  select * into p from public.personal_account_pos_payments
    where branch_id=p_branch_id and family_member_id is not null
      and (status in ('paid','refunded') or (status in ('pending','authorized') and expires_at>now()))
      and public.family_pos_bonus_order_key(branch_id,iiko_order_id)=p_order_id
    order by case when status in ('paid','refunded') then 0 else 1 end,created_at desc,id desc limit 1;
  if p.id is not null then
    if p.customer_id<>p_customer_id or p_order_total is null or abs(p_order_total-p.amount_minor/100.0)>0.001
      or not exists(select 1 from public.loyalty_reservations where id=p_reservation_id and customer_id=p_customer_id
        and order_id=p_order_id and pos_branch_id=p_branch_id and discount_amount=0) then raise exception 'family loyalty claim conflict'; end if;
    perform pg_advisory_xact_lock(hashtext(p.customer_id::text));
    select balance into current_balance from public.customers where id=p.customer_id for update;
    select * into p from public.personal_account_pos_payments where id=p.id for update;
    if p.status='refunded' then
      return jsonb_build_object('status','family_refunded','balance',current_balance,'customer_id',p.customer_id,
        'discount_applied',0,'earned_bonus',0,'duplicate',true);
    end if;
    if p.status<>'paid' then raise exception 'family payment not paid'; end if;
  end if;
  return public.family_pos_base_commit(p_branch_id,p_customer_id,p_order_id,p_reservation_id,p_order_total,p_earned_bonus,
    p_activation_delay_days,p_items,p_max_order_total,p_max_discount_amount,p_max_earned_bonus,p_rolling_earned_bonus);
end $$;

revoke all on function public.family_pos_bonus_order_key(uuid,uuid),public.family_pos_reverse_cashback(uuid),
  public.personal_account_pos_family_base_action(uuid,uuid,uuid,bigint,text,text,text,uuid),
  public.family_pos_base_reserve(uuid,uuid,text,numeric,numeric,numeric,integer,numeric,numeric,integer,numeric,numeric),
  public.family_pos_base_commit(uuid,uuid,text,uuid,numeric,numeric,integer,jsonb,numeric,numeric,numeric,numeric)
  from public,anon,authenticated,service_role;
revoke all on function public.personal_account_pos_action(uuid,uuid,uuid,bigint,text,text,text,uuid),
  public.reserve_branch_loyalty_balance(uuid,uuid,text,numeric,numeric,numeric,integer,numeric,numeric,integer,numeric,numeric),
  public.commit_branch_loyalty_reservation(uuid,uuid,text,uuid,numeric,numeric,integer,jsonb,numeric,numeric,numeric,numeric)
  from public,anon,authenticated;
grant execute on function public.personal_account_pos_action(uuid,uuid,uuid,bigint,text,text,text,uuid),
  public.reserve_branch_loyalty_balance(uuid,uuid,text,numeric,numeric,numeric,integer,numeric,numeric,integer,numeric,numeric),
  public.commit_branch_loyalty_reservation(uuid,uuid,text,uuid,numeric,numeric,integer,jsonb,numeric,numeric,numeric,numeric)
  to service_role;

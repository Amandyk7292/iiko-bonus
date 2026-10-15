-- Every credited portion has its own six-calendar-month lifetime. Purchases and
-- later rewards never renew earlier portions. All accounting stays in the same
-- transaction and customer row lock as the existing financial ledger.
-- Briefly serialize writers while replaying the old ledger and installing its
-- triggers. Readers continue normally; no credit can slip between the snapshot
-- and trigger installation.
lock table public.customers,public.transactions,public.loyalty_reservations in share row exclusive mode;
-- This is the explicitly requested policy change, including installations on
-- which the old inactivity policy was disabled. Future admin disable remains
-- respected by the shared SQL predicate.
insert into public.settings(key,value) values('bonus_expiration',
  jsonb_build_object('enabled',true,'expiration_months',6,'notify_days',jsonb_build_array(30,15,7),'auto_write_off',true)::text)
on conflict(key) do update set value=excluded.value;
create table public.bonus_credit_lots (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  source_transaction_id uuid references public.transactions(id) on delete restrict,
  source_part integer not null default 0,
  source_kind text not null,
  credited_at timestamptz not null,
  expires_at timestamptz not null,
  original_amount numeric(12,2) not null check(original_amount>0),
  remaining_amount numeric(12,2) not null check(remaining_amount>=0),
  expired_amount numeric(12,2) not null default 0 check(expired_amount>=0),
  expired_at timestamptz,
  restored_from_lot_id uuid references public.bonus_credit_lots(id),
  created_at timestamptz not null default now(),
  unique(source_transaction_id,source_part),
  check(remaining_amount+expired_amount<=original_amount)
);
create index bonus_credit_lots_customer_live on public.bonus_credit_lots(customer_id,expires_at,credited_at,id)
  where remaining_amount>0;
create index bonus_credit_lots_due on public.bonus_credit_lots(expires_at,customer_id) where remaining_amount>0;
create table public.bonus_lot_movements (
  transaction_id uuid primary key references public.transactions(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete cascade,
  kind text not null,
  amount numeric(12,2) not null check(amount>0),
  allocated_amount numeric(12,2) not null default 0 check(allocated_amount>=0),
  settled boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create table public.bonus_lot_allocations (
  id bigint generated always as identity primary key,
  lot_id uuid not null references public.bonus_credit_lots(id) on delete cascade,
  debit_transaction_id uuid references public.transactions(id) on delete restrict,
  amount numeric(12,2) not null check(amount>0),
  restored_amount numeric(12,2) not null default 0 check(restored_amount>=0 and restored_amount<=amount),
  reason text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index bonus_lot_allocations_refund on public.bonus_lot_allocations(debit_transaction_id,id);
alter table public.bonus_credit_lots enable row level security;
alter table public.bonus_lot_movements enable row level security;
alter table public.bonus_lot_allocations enable row level security;
create policy bonus_credit_lots_service on public.bonus_credit_lots for all to service_role using(true) with check(true);
create policy bonus_lot_movements_service on public.bonus_lot_movements for all to service_role using(true) with check(true);
create policy bonus_lot_allocations_service on public.bonus_lot_allocations for all to service_role using(true) with check(true);
revoke all on public.bonus_credit_lots,public.bonus_lot_movements,public.bonus_lot_allocations from public,anon,authenticated;
grant all on public.bonus_credit_lots,public.bonus_lot_movements,public.bonus_lot_allocations to service_role;
grant usage,select on sequence public.bonus_lot_allocations_id_seq to service_role;

create function public.bonus_six_month_expiry(p_credited_at timestamptz) returns timestamptz
language sql immutable strict security definer set search_path=public,pg_temp as $$
  select ((p_credited_at at time zone 'Asia/Almaty')+interval '6 months') at time zone 'Asia/Almaty';
$$;

create function public.bonus_expiry_policy_enabled() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select coalesce((value::jsonb->>'enabled')::boolean,true)
    and coalesce((value::jsonb->>'auto_write_off')::boolean,true)
    from public.settings where key='bonus_expiration'),true);
$$;

create function public.consume_bonus_credit_lots(p_customer_id uuid,p_amount numeric,p_debit_id uuid default null,p_reason text default 'spending')
returns numeric language plpgsql security definer set search_path=public,pg_temp as $$
declare lot public.bonus_credit_lots%rowtype; outstanding numeric:=greatest(0,coalesce(p_amount,0)); taken numeric;
begin
  perform 1 from public.customers where id=p_customer_id for update;
  for lot in select * from public.bonus_credit_lots where customer_id=p_customer_id and remaining_amount>0
    order by expires_at,credited_at,id for update loop
    exit when outstanding<=0;
    taken:=least(lot.remaining_amount,outstanding);
    update public.bonus_credit_lots set remaining_amount=remaining_amount-taken where id=lot.id;
    insert into public.bonus_lot_allocations(lot_id,debit_transaction_id,amount,reason)
      values(lot.id,p_debit_id,taken,p_reason);
    outstanding:=outstanding-taken;
  end loop;
  if p_debit_id is not null then
    update public.bonus_lot_movements set allocated_amount=allocated_amount+greatest(0,p_amount-outstanding)
      where transaction_id=p_debit_id;
  end if;
  return greatest(0,p_amount-outstanding);
end $$;

-- Existing refund ledger amounts can include pending/already-spent cashback.
-- Only the actual balance decrease consumes lots; any unrecovered debt is not
-- charged a second time. A combined spend-and-cashback UPDATE is finalized by
-- the deferred reconciliation after all of its ledger rows have been inserted.
create function public.reconcile_bonus_credit_lots(p_customer_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare balance_value numeric; lots_value numeric; excess numeric; movement public.bonus_lot_movements%rowtype; used numeric;
  uncredited_lot public.bonus_credit_lots%rowtype;
begin
  select greatest(0,balance) into balance_value from public.customers where id=p_customer_id for update;
  if not found then return; end if;
  select coalesce(sum(remaining_amount),0) into lots_value from public.bonus_credit_lots where customer_id=p_customer_id;
  excess:=greatest(0,lots_value-balance_value);
  for movement in select * from public.bonus_lot_movements
    where customer_id=p_customer_id and not settled and kind in('withdrawal','manual_withdrawal','refund_reversal','expiration')
      and allocated_amount<amount order by created_at,transaction_id for update loop
    exit when excess<=0;
    used:=public.consume_bonus_credit_lots(p_customer_id,least(excess,movement.amount-movement.allocated_amount),movement.transaction_id,movement.kind);
    excess:=excess-used;
  end loop;
  -- A ledger row by itself does not prove money was credited. If there is no
  -- matching financial debit, trim the uncredited part of this transaction's
  -- new lots before touching older, genuinely credited money.
  for uncredited_lot in select l.* from public.bonus_credit_lots l
    join public.bonus_lot_movements m on m.transaction_id=l.source_transaction_id
    where l.customer_id=p_customer_id and l.remaining_amount>0 and not m.settled
      and m.kind in('deposit','manual_deposit','manual','refund_bonus_restore')
    order by m.created_at desc,l.source_part desc,l.id for update of l loop
    exit when excess<=0;
    used:=least(excess,uncredited_lot.remaining_amount);
    update public.bonus_credit_lots set remaining_amount=remaining_amount-used where id=uncredited_lot.id;
    insert into public.bonus_lot_allocations(lot_id,amount,reason) values(uncredited_lot.id,used,'uncredited_ledger');
    excess:=excess-used;
  end loop;
  if excess>0 then perform public.consume_bonus_credit_lots(p_customer_id,excess,null,'balance_reconciliation'); end if;
  if lots_value<balance_value then
    insert into public.bonus_credit_lots(customer_id,source_kind,credited_at,expires_at,original_amount,remaining_amount)
      values(p_customer_id,'opening_balance',now(),public.bonus_six_month_expiry(now()),balance_value-lots_value,balance_value-lots_value);
  end if;
  update public.bonus_lot_movements set settled=true where customer_id=p_customer_id and not settled;
end $$;

create function public.record_bonus_lot_transaction() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare credited timestamptz; expiry timestamptz; amount_left numeric; part integer:=0; original_order text;
  allocation record; restored numeric; balance_value numeric; lots_value numeric;
begin
  if new.customer_id is null or new.amount<=0 then return new; end if;
  if new.type not in('deposit','manual_deposit','manual','refund_bonus_restore','withdrawal','manual_withdrawal','refund_reversal','expiration') then return new; end if;
  perform 1 from public.customers where id=new.customer_id for update;
  insert into public.bonus_lot_movements(transaction_id,customer_id,kind,amount)
    values(new.id,new.customer_id,new.type,new.amount) on conflict(transaction_id) do nothing;
  if not found then return new; end if;
  if new.type in('deposit','manual_deposit','manual','refund_bonus_restore') then
    -- Pending bonuses get their full lifetime when actually activated, never
    -- when the purchase created an unavailable pending ledger entry.
    credited:=coalesce(new.activated_at,new.timestamp,now());
    expiry:=public.bonus_six_month_expiry(credited);
    amount_left:=new.amount;
    if new.type='refund_bonus_restore' then
      original_order:=split_part(new.order_id,':refund',1);
      for allocation in select a.id,a.amount-a.restored_amount available,l.id lot_id,l.expires_at,l.credited_at
        from public.bonus_lot_allocations a join public.transactions t on t.id=a.debit_transaction_id
        join public.bonus_credit_lots l on l.id=a.lot_id
        where t.customer_id=new.customer_id and t.type='withdrawal' and t.order_id=original_order
          and a.amount>a.restored_amount order by a.id for update of a loop
        exit when amount_left<=0;
        restored:=least(amount_left,allocation.available); part:=part+1;
        insert into public.bonus_credit_lots(customer_id,source_transaction_id,source_part,source_kind,credited_at,expires_at,
          original_amount,remaining_amount,restored_from_lot_id)
          values(new.customer_id,new.id,part,'refund_restore',allocation.credited_at,allocation.expires_at,restored,restored,allocation.lot_id);
        update public.bonus_lot_allocations set restored_amount=restored_amount+restored where id=allocation.id;
        amount_left:=amount_left-restored;
      end loop;
    end if;
    if amount_left>0 then
      insert into public.bonus_credit_lots(customer_id,source_transaction_id,source_kind,credited_at,expires_at,original_amount,remaining_amount)
        values(new.customer_id,new.id,new.type,credited,expiry,amount_left,amount_left);
    end if;
  else
    select greatest(0,balance) into balance_value from public.customers where id=new.customer_id;
    select coalesce(sum(remaining_amount),0) into lots_value from public.bonus_credit_lots where customer_id=new.customer_id;
    perform public.consume_bonus_credit_lots(new.customer_id,least(new.amount,greatest(0,lots_value-balance_value)),new.id,new.type);
  end if;
  return new;
end $$;

-- Replay only financially active credits. Missing legacy ledger amounts receive
-- a new documented opening lot. Known overdue credits get 31 days' notice; the
-- migration itself never removes money. Historical ledger rows stay unchanged.
do $$
declare c record; t record; credited timestamptz; expiry timestamptz; spent numeric; debit_budget numeric;
begin
  for c in select id,balance from public.customers order by id for update loop
    for t in select * from public.transactions where customer_id=c.id and amount>0
      and type in('deposit','manual_deposit','manual','refund_bonus_restore')
      order by coalesce(activated_at,timestamp),created_at,id loop
      credited:=coalesce(t.activated_at,t.timestamp,now()); expiry:=public.bonus_six_month_expiry(credited);
      if expiry<=now() then expiry:=now()+interval '31 days'; end if;
      insert into public.bonus_credit_lots(customer_id,source_transaction_id,source_kind,credited_at,expires_at,original_amount,remaining_amount)
        values(c.id,t.id,'legacy_credit',credited,expiry,t.amount,t.amount);
    end loop;
    select greatest(0,coalesce(sum(remaining_amount),0)-greatest(0,c.balance)) into debit_budget
      from public.bonus_credit_lots where customer_id=c.id;
    for t in select * from public.transactions where customer_id=c.id and amount>0
      and type in('withdrawal','manual_withdrawal','refund_reversal','expiration') order by timestamp,created_at,id loop
      insert into public.bonus_lot_movements(transaction_id,customer_id,kind,amount)
        values(t.id,c.id,t.type,t.amount);
      spent:=public.consume_bonus_credit_lots(c.id,least(t.amount,debit_budget),t.id,'legacy_'||t.type);
      debit_budget:=debit_budget-spent;
    end loop;
    insert into public.bonus_lot_movements(transaction_id,customer_id,kind,amount,settled)
      select id,c.id,type,amount,true from public.transactions where customer_id=c.id and amount>0
        and type in('deposit','manual_deposit','manual','refund_bonus_restore') on conflict do nothing;
    perform public.reconcile_bonus_credit_lots(c.id);
  end loop;
end $$;

create trigger bonus_lots_transaction after insert or update of type,amount,activated_at on public.transactions
  for each row execute function public.record_bonus_lot_transaction();
create function public.deferred_reconcile_bonus_credit_lots() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_table_name='transactions' then perform public.reconcile_bonus_credit_lots(new.customer_id);
  else perform public.reconcile_bonus_credit_lots(new.id); end if;
  return new;
end $$;
create constraint trigger bonus_lots_customer_reconcile after insert or update of balance on public.customers
  deferrable initially deferred for each row execute function public.deferred_reconcile_bonus_credit_lots();
create constraint trigger bonus_lots_transaction_reconcile after insert or update of type,amount,activated_at on public.transactions
  deferrable initially deferred for each row execute function public.deferred_reconcile_bonus_credit_lots();

create function public.expire_bonus_credit_lots(p_customer_id uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare balance_value numeric; held numeric; budget numeric; lot public.bonus_credit_lots%rowtype; amount_value numeric;
  total_value numeric:=0; expiry_id uuid;
begin
  if p_now is null then raise exception 'expiry clock required'; end if;
  select balance into balance_value from public.customers where id=p_customer_id and deleted_at is null for update;
  if not found then return jsonb_build_object('customerId',p_customer_id,'expiredAmount',0,'balance',0); end if;
  if not public.bonus_expiry_policy_enabled() then
    return jsonb_build_object('customerId',p_customer_id,'expiredAmount',0,'balance',balance_value);
  end if;
  perform public.reconcile_bonus_credit_lots(p_customer_id);
  select coalesce(sum(discount_amount),0) into held from public.loyalty_reservations
    where customer_id=p_customer_id and status='active' and expires_at>p_now;
  budget:=greatest(0,balance_value-held);
  for lot in select * from public.bonus_credit_lots where customer_id=p_customer_id and remaining_amount>0 and expires_at<=p_now
    order by expires_at,credited_at,id for update loop
    exit when budget<=0;
    amount_value:=least(budget,lot.remaining_amount);
    update public.bonus_credit_lots set remaining_amount=remaining_amount-amount_value,
      expired_amount=expired_amount+amount_value,expired_at=p_now where id=lot.id;
    budget:=budget-amount_value; total_value:=total_value+amount_value;
    -- The order identity is unique for this actual portion; repeated workers see
    -- the reduced lot before they can insert another debit.
    expiry_id:=gen_random_uuid();
    insert into public.transactions(id,customer_id,order_id,type,amount,description)
      values(expiry_id,p_customer_id,'BONUS-LOT-EXPIRY-'||lot.id||'-'||expiry_id,'expiration',amount_value,
        'Истёк срок начисления бонусов · 6 месяцев');
    if lot.source_transaction_id is not null and not exists(select 1 from public.bonus_credit_lots sibling
      where sibling.source_transaction_id=lot.source_transaction_id and sibling.remaining_amount>0) then
      update public.transactions set expired_at=p_now where id=lot.source_transaction_id;
    end if;
  end loop;
  if total_value>0 then
    update public.customers set balance=balance-total_value,updated_at=now() where id=p_customer_id returning balance into balance_value;
  end if;
  return jsonb_build_object('customerId',p_customer_id,'expiredAmount',total_value,'balance',balance_value);
end $$;

create function public.expire_due_bonus_credit_lots(p_limit integer default 200,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare customer_row record; result jsonb; count_value integer:=0; total_value numeric:=0; customer_ids uuid[]:='{}'; has_more boolean;
begin
  if p_limit is null or p_limit<1 or p_limit>1000 or p_now is null then raise exception 'invalid expiry batch'; end if;
  if not public.bonus_expiry_policy_enabled() then
    return jsonb_build_object('expiredCount',0,'totalExpiredAmount',0,'customerIds','[]'::jsonb,'hasMore',false);
  end if;
  for customer_row in select c.id from public.customers c where c.deleted_at is null
      and exists(select 1 from public.bonus_credit_lots l where l.customer_id=c.id and l.remaining_amount>0 and l.expires_at<=p_now)
      and c.balance>(select coalesce(sum(r.discount_amount),0) from public.loyalty_reservations r
        where r.customer_id=c.id and r.status='active' and r.expires_at>p_now)
    order by c.id limit p_limit for update of c skip locked loop
    result:=public.expire_bonus_credit_lots(customer_row.id,p_now);
    if (result->>'expiredAmount')::numeric>0 then
      count_value:=count_value+1; total_value:=total_value+(result->>'expiredAmount')::numeric;
      customer_ids:=array_append(customer_ids,customer_row.id);
    end if;
  end loop;
  select exists(select 1 from public.customers c where c.deleted_at is null
    and exists(select 1 from public.bonus_credit_lots l where l.customer_id=c.id and l.remaining_amount>0 and l.expires_at<=p_now)
    and c.balance>(select coalesce(sum(r.discount_amount),0) from public.loyalty_reservations r
      where r.customer_id=c.id and r.status='active' and r.expires_at>p_now)) into has_more;
  return jsonb_build_object('expiredCount',count_value,'totalExpiredAmount',total_value,'customerIds',to_jsonb(customer_ids),'hasMore',has_more);
end $$;

create function public.bonus_expiry_summary(p_customer_id uuid,p_days integer default 30,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare balance_value numeric; buckets_value jsonb; first_value timestamptz; first_amount numeric; total_value numeric; expiry_result jsonb;
begin
  if p_days is null or p_days<1 or p_days>3660 or p_now is null then raise exception 'invalid expiry forecast'; end if;
  expiry_result:=public.expire_bonus_credit_lots(p_customer_id,p_now);
  select greatest(0,balance) into balance_value from public.customers where id=p_customer_id and deleted_at is null;
  if not found then return null; end if;
  if not public.bonus_expiry_policy_enabled() then
    return jsonb_build_object('currentBalance',balance_value,'totalExpiring',0,'nextExpiryAt',null,
      'nextExpiryAmount',0,'buckets','[]'::jsonb,'expirationMonths',6);
  end if;
  with grouped as (
    select (expires_at at time zone 'Asia/Almaty')::date as expiry_day,min(expires_at) expires_at,sum(remaining_amount) amount
    from public.bonus_credit_lots where customer_id=p_customer_id and remaining_amount>0
      and expires_at>p_now and expires_at<=p_now+make_interval(days=>p_days)
    group by (expires_at at time zone 'Asia/Almaty')::date
  ) select coalesce(jsonb_agg(jsonb_build_object('expiresAt',expires_at,'amount',amount,
      'daysRemaining',greatest(1,expiry_day-(p_now at time zone 'Asia/Almaty')::date)) order by expires_at),'[]'),
    min(expires_at),coalesce(sum(amount),0),(array_agg(amount order by expires_at))[1]
    into buckets_value,first_value,total_value,first_amount from grouped;
  return jsonb_build_object('currentBalance',balance_value,'totalExpiring',total_value,'nextExpiryAt',first_value,
    'nextExpiryAmount',coalesce(first_amount,0),'buckets',buckets_value,'expirationMonths',6,
    'expiredAmount',coalesce((expiry_result->>'expiredAmount')::numeric,0),
    'winbackAmount',coalesce((expiry_result->>'winbackAmount')::numeric,0));
end $$;

create function public.bonus_expiry_customer_forecasts(p_customer_ids uuid[],p_now timestamptz default now())
returns table(customer_id uuid,next_expiry_at timestamptz,expiring_amount numeric)
language sql stable security definer set search_path=public,pg_temp as $$
  with first_dates as (select l.customer_id,min(l.expires_at) first_at from public.bonus_credit_lots l
    where l.customer_id=any(p_customer_ids) and l.remaining_amount>0 and l.expires_at>p_now
      and public.bonus_expiry_policy_enabled() group by l.customer_id)
  select f.customer_id,f.first_at,sum(l.remaining_amount) from first_dates f join public.bonus_credit_lots l
    on l.customer_id=f.customer_id and l.remaining_amount>0 and
      (l.expires_at at time zone 'Asia/Almaty')::date=(f.first_at at time zone 'Asia/Almaty')::date
    group by f.customer_id,f.first_at;
$$;

-- Old inactivity workers must fail closed throughout rolling deployment.
create or replace function public.expire_customer_bonus(p_customer_id uuid,p_expected_balance numeric,p_order_id text,p_inactive_before timestamptz)
returns numeric language sql security definer set search_path=public,pg_temp as $$ select 0::numeric; $$;
create or replace function public.expire_customer_bonus(p_customer_id uuid,p_expected_balance numeric,p_order_id text)
returns numeric language sql security definer set search_path=public,pg_temp as $$ select 0::numeric; $$;

-- Wrap existing, fully validated financial entry points. Their original bodies
-- and refund/idempotency semantics are retained, with lazy expiration first.
alter function public.apply_loyalty_transaction(uuid,text,numeric,numeric,numeric,numeric,integer,jsonb) rename to apply_loyalty_transaction_before_credit_lots;
create function public.apply_loyalty_transaction(p_customer_id uuid,p_order_id text,p_discount_amount numeric,p_earned_bonus numeric,
  p_order_total numeric default 0,p_real_money_paid numeric default 0,p_activation_delay_days integer default 0,p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare expiry_result jsonb; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  expiry_result:=public.expire_bonus_credit_lots(p_customer_id);
  result:=public.apply_loyalty_transaction_before_credit_lots(p_customer_id,p_order_id,p_discount_amount,p_earned_bonus,
    p_order_total,p_real_money_paid,p_activation_delay_days,p_items);
  return result||jsonb_build_object('expiredAmount',coalesce((expiry_result->>'expiredAmount')::numeric,0),
    'winbackAmount',coalesce((expiry_result->>'winbackAmount')::numeric,0));
end $$;
alter function public.reserve_loyalty_balance(uuid,text,numeric,numeric,numeric,integer) rename to reserve_loyalty_balance_before_credit_lots;
create function public.reserve_loyalty_balance(p_customer_id uuid,p_order_id text,p_order_total numeric,p_discount_amount numeric,
  p_max_discount_percent numeric,p_ttl_hours integer default 24) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare expiry_result jsonb; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  expiry_result:=public.expire_bonus_credit_lots(p_customer_id);
  result:=public.reserve_loyalty_balance_before_credit_lots(p_customer_id,p_order_id,p_order_total,p_discount_amount,p_max_discount_percent,p_ttl_hours);
  return result||jsonb_build_object('expiredAmount',coalesce((expiry_result->>'expiredAmount')::numeric,0),
    'winbackAmount',coalesce((expiry_result->>'winbackAmount')::numeric,0));
end $$;
alter function public.quote_checkout_bonus(uuid,numeric) rename to quote_checkout_bonus_before_credit_lots;
create function public.quote_checkout_bonus(p_customer_id uuid,p_order_total numeric) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare expiry_result jsonb; result jsonb; owner_id uuid;
begin
  owner_id:=public.family_bonus_owner(p_customer_id);
  perform pg_advisory_xact_lock(hashtext(owner_id::text));
  expiry_result:=public.expire_bonus_credit_lots(owner_id);
  result:=public.quote_checkout_bonus_before_credit_lots(p_customer_id,p_order_total);
  return result||jsonb_build_object('expiredAmount',coalesce((expiry_result->>'expiredAmount')::numeric,0),
    'winbackAmount',coalesce((expiry_result->>'winbackAmount')::numeric,0),'bonusOwnerId',owner_id);
end $$;

create or replace function public.activate_pending_bonus_transactions() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare customer_row record; transaction_row record; count_value integer:=0; total_value numeric:=0; customer_ids uuid[]:='{}'; customer_amount numeric;
begin
  for customer_row in select c.id from public.customers c where c.deleted_at is null
    and exists(select 1 from public.transactions t where t.customer_id=c.id and t.type='pending_deposit' and t.available_at<=now())
    order by c.id for update of c skip locked loop
    customer_amount:=0;
    for transaction_row in select * from public.transactions where customer_id=customer_row.id and type='pending_deposit' and available_at<=now()
      order by id for update loop
      update public.transactions set type='deposit',activated_at=now(),expires_at=public.bonus_six_month_expiry(now()),
        description=coalesce(description,'')||' / активирован' where id=transaction_row.id;
      count_value:=count_value+1; customer_amount:=customer_amount+transaction_row.amount;
    end loop;
    update public.customers set balance=balance+customer_amount,updated_at=now() where id=customer_row.id;
    total_value:=total_value+customer_amount; customer_ids:=array_append(customer_ids,customer_row.id);
  end loop;
  return jsonb_build_object('activated_count',count_value,'activated_amount',total_value,'customer_ids',to_jsonb(customer_ids));
end $$;

-- Internal helpers cannot be invoked by customers or bypass the wrappers.
revoke all on function public.bonus_six_month_expiry(timestamptz),public.consume_bonus_credit_lots(uuid,numeric,uuid,text),
  public.reconcile_bonus_credit_lots(uuid),public.record_bonus_lot_transaction(),public.deferred_reconcile_bonus_credit_lots(),
  public.apply_loyalty_transaction_before_credit_lots(uuid,text,numeric,numeric,numeric,numeric,integer,jsonb),
  public.reserve_loyalty_balance_before_credit_lots(uuid,text,numeric,numeric,numeric,integer),
  public.quote_checkout_bonus_before_credit_lots(uuid,numeric)
  from public,anon,authenticated,service_role;
revoke all on function public.expire_bonus_credit_lots(uuid,timestamptz),public.expire_due_bonus_credit_lots(integer,timestamptz),
  public.bonus_expiry_policy_enabled(),
  public.bonus_expiry_summary(uuid,integer,timestamptz),public.bonus_expiry_customer_forecasts(uuid[],timestamptz),
  public.expire_customer_bonus(uuid,numeric,text,timestamptz),public.expire_customer_bonus(uuid,numeric,text),
  public.apply_loyalty_transaction(uuid,text,numeric,numeric,numeric,numeric,integer,jsonb),
  public.reserve_loyalty_balance(uuid,text,numeric,numeric,numeric,integer),public.quote_checkout_bonus(uuid,numeric),
  public.activate_pending_bonus_transactions() from public,anon,authenticated;
grant execute on function public.expire_bonus_credit_lots(uuid,timestamptz),public.expire_due_bonus_credit_lots(integer,timestamptz),
  public.bonus_expiry_policy_enabled(),
  public.bonus_expiry_summary(uuid,integer,timestamptz),public.bonus_expiry_customer_forecasts(uuid[],timestamptz),
  public.apply_loyalty_transaction(uuid,text,numeric,numeric,numeric,numeric,integer,jsonb),
  public.reserve_loyalty_balance(uuid,text,numeric,numeric,numeric,integer),public.quote_checkout_bonus(uuid,numeric),
  public.activate_pending_bonus_transactions() to service_role;

update public.loyalty_faq set answer_ru='Каждое начисление бонусов действует 6 календарных месяцев. Сначала расходуются бонусы с ближайшим сроком сгорания. Неиспользованный остаток каждого начисления сгорает отдельно. За 30, 15 и 7 дней до сгорания мы отправляем напоминания.',
  answer_kk='Әр есептелген бонустың мерзімі — 6 күнтізбелік ай. Алдымен мерзімі жақын бонустар жұмсалады. Әр есептеудің пайдаланылмаған қалдығы бөлек жойылады. Мерзім аяқталғанға дейін 30, 15 және 7 күн бұрын ескертеміз.'
where id='fa010000-0000-4000-8000-000000000005' and answer_ru like 'В программе может действовать срок хранения бонусов и автоматическое списание при отсутствии активности.%';

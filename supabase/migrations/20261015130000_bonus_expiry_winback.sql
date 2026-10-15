-- An expired, unused portion can trigger a single return gift after 90 days
-- without a real purchase. Only a later paid purchase starts a new cycle; the
-- gift's own expiry, activation, refunds and marketing credits cannot re-arm it.
create table public.bonus_expiry_winback_rewards (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  cycle_key text not null,
  last_purchase_transaction_id uuid references public.transactions(id) on delete restrict,
  last_purchase_at timestamptz,
  expiration_amount numeric(12,2) not null check(expiration_amount>0),
  amount numeric(12,2) not null default 1000 check(amount=1000),
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  granted_at timestamptz not null default now(),
  unique(customer_id,cycle_key)
);
alter table public.bonus_expiry_winback_rewards enable row level security;
create policy bonus_expiry_winback_rewards_service on public.bonus_expiry_winback_rewards
  for all to service_role using(true) with check(true);
revoke all on public.bonus_expiry_winback_rewards from public,anon,authenticated;
grant all on public.bonus_expiry_winback_rewards to service_role;

-- Expiry and 90 days of absence can happen on different days. Remember the
-- actual unused expiry, scoped to that purchase cycle, until both are true.
create table public.bonus_expiry_winback_qualifications (
  customer_id uuid not null references public.customers(id) on delete cascade,
  cycle_key text not null,
  last_purchase_transaction_id uuid references public.transactions(id) on delete restrict,
  last_purchase_at timestamptz,
  expiration_amount numeric(12,2) not null check(expiration_amount>0),
  eligible_at timestamptz not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  claimed_at timestamptz,
  primary key(customer_id,cycle_key)
);
create index bonus_expiry_winback_qualifications_due on public.bonus_expiry_winback_qualifications(eligible_at,customer_id)
  where cancelled_at is null and claimed_at is null;
alter table public.bonus_expiry_winback_qualifications enable row level security;
create policy bonus_expiry_winback_qualifications_service on public.bonus_expiry_winback_qualifications
  for all to service_role using(true) with check(true);
revoke all on public.bonus_expiry_winback_qualifications from public,anon,authenticated;
grant all on public.bonus_expiry_winback_qualifications to service_role;

create function public.grant_bonus_expiry_winback(p_customer_id uuid,p_expired_amount numeric,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare customer_row public.customers%rowtype; purchase record; cycle text; claim_id uuid:=gen_random_uuid();
  transaction_id_value uuid:=gen_random_uuid(); balance_value numeric; inactive_since timestamptz;
  qualified_expiration numeric;
begin
  if p_now is null or not public.bonus_expiry_policy_enabled() then return jsonb_build_object('winbackAmount',0); end if;
  select * into customer_row from public.customers where id=p_customer_id and deleted_at is null for update;
  if not found then return jsonb_build_object('winbackAmount',0); end if;
  -- A pending cashback activation changes activated_at but never the original
  -- purchase timestamp. All rows from the same order share the same cycle key.
  select t.id,t.order_id,t.timestamp into purchase from public.transactions t
    where t.customer_id=p_customer_id and t.type in('order','deposit','pending_deposit','withdrawal')
      and t.order_total>0 and t.timestamp<=p_now
    order by t.timestamp desc,t.created_at desc,t.id desc limit 1;
  if found then
    cycle:='purchase:'||coalesce(nullif(btrim(purchase.order_id),''),purchase.id::text);
    inactive_since:=purchase.timestamp;
  else
    cycle:='initial'; inactive_since:=customer_row.created_at;
  end if;
  -- A return purchase invalidates an earlier, not-yet-earned gift. It cannot be
  -- awarded for an old absence after the customer has already returned.
  update public.bonus_expiry_winback_qualifications set cancelled_at=p_now
    where customer_id=p_customer_id and cycle_key<>cycle and cancelled_at is null and claimed_at is null;
  if inactive_since is null
    or exists(select 1 from public.bonus_expiry_winback_rewards r where r.customer_id=p_customer_id and r.cycle_key=cycle) then
    return jsonb_build_object('winbackAmount',0);
  end if;
  if coalesce(p_expired_amount,0)>0 then
    insert into public.bonus_expiry_winback_qualifications(customer_id,cycle_key,last_purchase_transaction_id,last_purchase_at,
      expiration_amount,eligible_at,created_at)
      values(p_customer_id,cycle,purchase.id,purchase.timestamp,p_expired_amount,inactive_since+interval '90 days',p_now)
      on conflict(customer_id,cycle_key) do update set
        expiration_amount=bonus_expiry_winback_qualifications.expiration_amount+excluded.expiration_amount;
  end if;
  select expiration_amount into qualified_expiration from public.bonus_expiry_winback_qualifications
    where customer_id=p_customer_id and cycle_key=cycle and eligible_at<=p_now and cancelled_at is null and claimed_at is null;
  if not found then return jsonb_build_object('winbackAmount',0); end if;
  update public.customers set balance=balance+1000,updated_at=now() where id=p_customer_id returning balance into balance_value;
  insert into public.transactions(id,customer_id,order_id,type,amount,description,timestamp,activated_at,expires_at)
    values(transaction_id_value,p_customer_id,'WINBACK-'||claim_id,'manual_deposit',1000,
      'Подарок за возвращение в Bulka',p_now,p_now,public.bonus_six_month_expiry(p_now));
  insert into public.bonus_expiry_winback_rewards(id,customer_id,cycle_key,last_purchase_transaction_id,last_purchase_at,
    expiration_amount,transaction_id,granted_at)
    values(claim_id,p_customer_id,cycle,purchase.id,purchase.timestamp,qualified_expiration,transaction_id_value,p_now);
  update public.bonus_expiry_winback_qualifications set claimed_at=p_now where customer_id=p_customer_id and cycle_key=cycle;
  perform public.queue_bonus_winback_notification(p_customer_id,claim_id,1000);
  return jsonb_build_object('winbackAmount',1000,'winbackClaimId',claim_id,'balance',balance_value);
end $$;

alter function public.expire_bonus_credit_lots(uuid,timestamptz) rename to expire_bonus_credit_lots_before_winback;
create function public.expire_bonus_credit_lots(p_customer_id uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare expiration jsonb; winback jsonb;
begin
  expiration:=public.expire_bonus_credit_lots_before_winback(p_customer_id,p_now);
  winback:=public.grant_bonus_expiry_winback(p_customer_id,coalesce((expiration->>'expiredAmount')::numeric,0),p_now);
  return expiration||winback;
end $$;

create or replace function public.expire_due_bonus_credit_lots(p_limit integer default 200,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare customer_row record; result jsonb; count_value integer:=0; total_value numeric:=0; customer_ids uuid[]:='{}';
  winback_count integer:=0; winback_total numeric:=0; winback_ids uuid[]:='{}'; has_more boolean;
begin
  if p_limit is null or p_limit<1 or p_limit>1000 or p_now is null then raise exception 'invalid expiry batch'; end if;
  if not public.bonus_expiry_policy_enabled() then
    return jsonb_build_object('expiredCount',0,'totalExpiredAmount',0,'customerIds','[]'::jsonb,'hasMore',false,
      'winbackCount',0,'totalWinbackAmount',0,'winbackCustomerIds','[]'::jsonb);
  end if;
  for customer_row in select c.id from public.customers c where c.deleted_at is null
      and ((exists(select 1 from public.bonus_credit_lots l where l.customer_id=c.id and l.remaining_amount>0 and l.expires_at<=p_now)
      and c.balance>(select coalesce(sum(r.discount_amount),0) from public.loyalty_reservations r
        where r.customer_id=c.id and r.status='active' and r.expires_at>p_now))
      or exists(select 1 from public.bonus_expiry_winback_qualifications q where q.customer_id=c.id
        and q.eligible_at<=p_now and q.cancelled_at is null and q.claimed_at is null))
    order by c.id limit p_limit for update of c skip locked loop
    result:=public.expire_bonus_credit_lots(customer_row.id,p_now);
    if (result->>'expiredAmount')::numeric>0 then
      count_value:=count_value+1; total_value:=total_value+(result->>'expiredAmount')::numeric;
      customer_ids:=array_append(customer_ids,customer_row.id);
    end if;
    if coalesce((result->>'winbackAmount')::numeric,0)>0 then
      winback_count:=winback_count+1; winback_total:=winback_total+(result->>'winbackAmount')::numeric;
      winback_ids:=array_append(winback_ids,customer_row.id);
    end if;
  end loop;
  select exists(select 1 from public.customers c where c.deleted_at is null
    and ((exists(select 1 from public.bonus_credit_lots l where l.customer_id=c.id and l.remaining_amount>0 and l.expires_at<=p_now)
    and c.balance>(select coalesce(sum(r.discount_amount),0) from public.loyalty_reservations r
      where r.customer_id=c.id and r.status='active' and r.expires_at>p_now))
    or exists(select 1 from public.bonus_expiry_winback_qualifications q where q.customer_id=c.id
      and q.eligible_at<=p_now and q.cancelled_at is null and q.claimed_at is null))) into has_more;
  return jsonb_build_object('expiredCount',count_value,'totalExpiredAmount',total_value,'customerIds',to_jsonb(customer_ids),'hasMore',has_more,
    'winbackCount',winback_count,'totalWinbackAmount',winback_total,'winbackCustomerIds',to_jsonb(winback_ids));
end $$;

revoke all on function public.grant_bonus_expiry_winback(uuid,numeric,timestamptz),
  public.expire_bonus_credit_lots_before_winback(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.expire_bonus_credit_lots(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.expire_bonus_credit_lots(uuid,timestamptz) to service_role;

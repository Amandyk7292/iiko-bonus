create function public.expire_customer_bonus(p_customer_id uuid,p_expected_balance numeric,p_order_id text,p_inactive_before timestamptz)
returns numeric language plpgsql security definer set search_path=public as $$
declare current_balance numeric; held_balance numeric; expired_balance numeric; last_activity timestamptz;
begin
  if p_customer_id is null or coalesce(p_expected_balance,0)<=0 or nullif(btrim(p_order_id),'') is null
    or p_inactive_before is null or p_inactive_before>now() then return 0; end if;
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select balance,created_at into current_balance,last_activity from public.customers where id=p_customer_id for update;
  if not found or current_balance is distinct from p_expected_balance then return 0; end if;
  -- A purchase can leave the active balance unchanged (e.g. pending cashback).
  -- The customer lock also serializes purchases, so re-read their activity here.
  select coalesce(max(t.timestamp),last_activity) into last_activity from public.transactions t
    where t.customer_id=p_customer_id and t.type<>'churn_reminder';
  if last_activity is null or last_activity>=p_inactive_before then return 0; end if;
  if exists(select 1 from public.transactions where customer_id=p_customer_id and order_id=p_order_id and type='expiration') then return 0; end if;
  select coalesce(sum(discount_amount),0) into held_balance from public.loyalty_reservations
    where customer_id=p_customer_id and status='active' and expires_at>now();
  expired_balance:=greatest(0,current_balance-held_balance);
  if expired_balance<=0 then return 0; end if;
  update public.customers set balance=balance-expired_balance,updated_at=now() where id=p_customer_id;
  insert into public.transactions(customer_id,order_id,type,amount,description)
    values(p_customer_id,p_order_id,'expiration',expired_balance,'Бонусы сгорели из-за отсутствия активности');
  return expired_balance;
end; $$;
-- Old running workers do not carry the policy cutoff. Fail closed during the
-- rolling deployment rather than using a guessed inactivity period.
create or replace function public.expire_customer_bonus(p_customer_id uuid,p_expected_balance numeric,p_order_id text)
returns numeric language sql security definer set search_path=public as $$ select 0::numeric; $$;
revoke all on function public.expire_customer_bonus(uuid,numeric,text,timestamptz),
  public.expire_customer_bonus(uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.expire_customer_bonus(uuid,numeric,text,timestamptz),
  public.expire_customer_bonus(uuid,numeric,text) to service_role;

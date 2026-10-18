begin;

create or replace function public.grant_bonus_expiry_winback(p_customer_id uuid,p_expired_amount numeric,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare customer_row public.customers%rowtype; purchase record; cycle text; claim_id uuid:=gen_random_uuid();
  transaction_id_value uuid:=gen_random_uuid(); balance_value numeric; inactive_since timestamptz;
  qualified_expiration numeric;
begin
  if p_now is null or not public.bonus_expiry_policy_enabled() then return jsonb_build_object('winbackAmount',0); end if;
  select * into customer_row from public.customers where id=p_customer_id and deleted_at is null for update;
  if not found then return jsonb_build_object('winbackAmount',0); end if;
  -- Partial refunds with retained merchandise still count as a purchase.
  -- A full online refund or full POS ledger reversal cannot start a new cycle
  -- or postpone the inactivity clock of an earlier retained purchase.
  select t.id,t.order_id,t.timestamp into purchase from public.transactions t
    where t.customer_id=p_customer_id and t.type in('order','deposit','pending_deposit','withdrawal')
      and t.order_total>0 and t.timestamp<=p_now
      and not exists(select 1 from public.transactions reversal
        where reversal.customer_id=p_customer_id and reversal.type='refund_reversal'
          and reversal.order_id=t.order_id||':refund')
      and not exists(select 1 from public.kaspi_orders online_order
        where t.order_id like 'kaspi:%' and online_order.operation_id=substring(t.order_id from 7)
          and (online_order.status<>'paid'
            or coalesce(online_order.refund_status,'') in ('processing','unknown','succeeded')
            or (online_order.amount>0 and coalesce(online_order.partially_refunded_amount,0)>=online_order.amount)))
    order by t.timestamp desc,t.created_at desc,t.id desc limit 1;
  if found then
    cycle:='purchase:'||coalesce(nullif(btrim(purchase.order_id),''),purchase.id::text);
    inactive_since:=purchase.timestamp;
  else
    cycle:='initial'; inactive_since:=customer_row.created_at;
  end if;
  update public.bonus_expiry_winback_qualifications set cancelled_at=p_now
    where customer_id=p_customer_id and cycle_key<>cycle and cancelled_at is null and claimed_at is null;
  -- If a qualifying purchase is later refunded, falling back to an older
  -- purchase (or initial registration) must not open another absence cycle.
  if inactive_since is null or exists(
    select 1 from public.bonus_expiry_winback_rewards r where r.customer_id=p_customer_id
      and (r.cycle_key=cycle or r.granted_at>=inactive_since)
  ) then return jsonb_build_object('winbackAmount',0); end if;
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
revoke all on function public.grant_bonus_expiry_winback(uuid,numeric,timestamptz)
  from public,anon,authenticated,service_role;

commit;

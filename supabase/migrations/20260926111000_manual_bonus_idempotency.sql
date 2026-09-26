-- Store the adjustment identity and financial result in the balance transaction.
create table public.manual_bonus_operations (
  operation_id uuid primary key,
  customer_id uuid not null references public.customers(id),
  branch_id uuid references public.bulka_locations(id),
  amount_change numeric(12,2) not null,
  reason text not null,
  balance_after numeric not null,
  created_at timestamptz not null default now()
);
alter table public.manual_bonus_operations enable row level security;
revoke all on public.manual_bonus_operations from public,anon,authenticated;
grant select,insert on public.manual_bonus_operations to service_role;

create function public.apply_manual_bonus_once(
  p_operation_id uuid,p_customer_id uuid,p_amount_change numeric,
  p_reason text default null,p_branch_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare previous manual_bonus_operations%rowtype; next_balance numeric; held numeric; current_balance numeric;
  normalized_reason text:=btrim(coalesce(p_reason,''));
begin
  if p_operation_id is null or p_customer_id is null or p_amount_change is null
    or p_amount_change=0 or abs(p_amount_change)>1000000
    or p_amount_change<>round(p_amount_change,2)
    or char_length(normalized_reason) not between 5 and 240 then
    raise exception 'invalid manual bonus arguments' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('manual-bonus:'||p_operation_id::text,0));
  select * into previous from manual_bonus_operations where operation_id=p_operation_id;
  if found then
    if previous.customer_id is distinct from p_customer_id
      or previous.branch_id is distinct from p_branch_id
      or previous.amount_change is distinct from p_amount_change
      or previous.reason is distinct from normalized_reason then
      raise exception 'manual bonus idempotency conflict' using errcode='P0001';
    end if;
    return jsonb_build_object('balance',previous.balance_after,'duplicate',true);
  end if;
  -- Share the lock order with POS/checkout reservations, including prepared holds.
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select balance into current_balance from customers where id=p_customer_id for update;
  select coalesce(sum(discount_amount),0) into held from loyalty_reservations
    where customer_id=p_customer_id and status='active' and expires_at>now();
  if p_amount_change<0 and current_balance+p_amount_change<held then
    raise exception 'manual bonus balance is reserved' using errcode='P0001';
  end if;
  next_balance:=apply_manual_bonus_scoped(p_customer_id,p_amount_change,normalized_reason,p_branch_id);
  insert into manual_bonus_operations(operation_id,customer_id,branch_id,amount_change,reason,balance_after)
    values(p_operation_id,p_customer_id,p_branch_id,p_amount_change,normalized_reason,next_balance);
  return jsonb_build_object('balance',next_balance,'duplicate',false);
end;
$$;
revoke all on function public.apply_manual_bonus_once(uuid,uuid,numeric,text,uuid)
  from public,anon,authenticated;
grant execute on function public.apply_manual_bonus_once(uuid,uuid,numeric,text,uuid) to service_role;
-- The previous unkeyed entry point is internal only; it cannot bypass deduplication.
revoke all on function public.apply_manual_bonus_scoped(uuid,numeric,text,uuid) from service_role;

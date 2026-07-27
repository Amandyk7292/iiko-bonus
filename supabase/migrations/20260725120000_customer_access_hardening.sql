-- Enforce bounded, reasoned manual loyalty adjustments at the database boundary.

create or replace function public.apply_manual_bonus_scoped(
  p_customer_id uuid,
  p_amount_change numeric,
  p_reason text default null,
  p_branch_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_customer_id is null
    or p_amount_change is null
    or p_amount_change = 0
    or abs(p_amount_change) > 1000000 then
    raise exception 'invalid manual bonus arguments';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 240 then
    raise exception 'manual bonus reason must contain between 5 and 240 characters';
  end if;

  update public.customers
  set balance = balance + p_amount_change, updated_at = now()
  where id = p_customer_id and deleted_at is null and balance + p_amount_change >= 0
  returning balance into v_balance;
  if v_balance is null then
    raise exception 'customer not found, deleted, or has insufficient balance';
  end if;

  insert into public.transactions(customer_id, order_id, branch_id, type, amount, description)
  values (
    p_customer_id,
    'MANUAL-' || gen_random_uuid()::text,
    p_branch_id,
    case when p_amount_change > 0 then 'manual_deposit' else 'manual_withdrawal' end,
    abs(p_amount_change),
    v_reason
  );
  return v_balance;
end;
$$;

revoke all on function public.apply_manual_bonus_scoped(uuid, numeric, text, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_manual_bonus_scoped(uuid, numeric, text, uuid)
  to service_role;

-- Administrative withdrawals must preserve authorized POS payment holds.
create or replace function public.admin_adjust_personal_account(
  p_customer_id uuid,
  p_amount_minor bigint,
  p_request_id uuid,
  p_reason text,
  p_admin_subject text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  account public.personal_accounts%rowtype;
  existing public.personal_account_admin_adjustments%rowtype;
  entry_id uuid;
  next_balance bigint;
begin
  if p_customer_id is null or p_request_id is null or p_amount_minor is null
    or p_amount_minor=0 or abs(p_amount_minor)>100000000
    or p_reason is null or length(trim(p_reason)) not between 5 and 240
    or p_admin_subject is null or length(trim(p_admin_subject)) not between 1 and 200 then
    raise exception 'invalid personal account adjustment' using errcode='22023';
  end if;

  perform 1 from public.customers
    where id=p_customer_id and deleted_at is null for update;
  if not found then raise exception 'customer unavailable' using errcode='P0001'; end if;

  insert into public.personal_accounts(customer_id) values(p_customer_id) on conflict do nothing;
  select * into account from public.personal_accounts
    where customer_id=p_customer_id for update;
  select * into existing from public.personal_account_admin_adjustments
    where request_id=p_request_id;
  if found then
    if existing.customer_id<>p_customer_id or existing.amount_minor<>p_amount_minor
      or existing.reason<>trim(p_reason) or existing.admin_subject<>trim(p_admin_subject) then
      raise exception 'adjustment request mismatch' using errcode='P0001';
    end if;
    return jsonb_build_object(
      'entryId',existing.entry_id,
      'balanceMinor',account.balance_minor,
      'duplicate',true
    );
  end if;

  next_balance := account.balance_minor+p_amount_minor;
  if p_amount_minor<0 and next_balance<public.personal_account_held_minor(p_customer_id) then
    raise exception 'insufficient personal account balance' using errcode='P0001';
  end if;
  insert into public.personal_account_entries(
    customer_id,amount_minor,kind,source_key,description,created_by
  ) values(
    p_customer_id,
    p_amount_minor,
    case when p_amount_minor>0 then 'topup' else 'reversal' end,
    'admin-adjust:'||p_request_id,
    trim(p_reason),
    trim(p_admin_subject)
  ) returning id into entry_id;
  insert into public.personal_account_admin_adjustments(
    customer_id,request_id,entry_id,amount_minor,reason,admin_subject
  ) values(
    p_customer_id,p_request_id,entry_id,p_amount_minor,trim(p_reason),trim(p_admin_subject)
  );
  update public.personal_accounts
    set balance_minor=next_balance,updated_at=now()
    where customer_id=p_customer_id;
  return jsonb_build_object(
    'entryId',entry_id,
    'balanceMinor',next_balance,
    'duplicate',false
  );
end;
$$;

revoke all on function public.admin_adjust_personal_account(uuid,bigint,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.admin_adjust_personal_account(uuid,bigint,uuid,text,text)
  to service_role;

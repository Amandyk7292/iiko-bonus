-- A repeated confirm must never expire or overwrite an already paid intent.
create or replace function public.personal_account_pos_action(
  p_id uuid,p_branch_id uuid,p_order_id uuid,p_amount_minor bigint,p_fingerprint text,
  p_action text,p_code_hash text default null,p_transaction_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.personal_account_pos_payments%rowtype; a public.personal_accounts%rowtype; customer uuid; notice uuid;
begin
  select customer_id into customer from public.personal_account_pos_payments where id=p_id and branch_id=p_branch_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  -- Same lock order as online account payments: customer, operation, account.
  perform 1 from public.customers where id=customer for update;
  select * into v from public.personal_account_pos_payments where id=p_id for update;
  if v.branch_id<>p_branch_id or v.iiko_order_id<>p_order_id or v.amount_minor<>p_amount_minor
      or v.fingerprint<>p_fingerprint then return jsonb_build_object('status','mismatch'); end if;
  if p_action in ('cancel','refund') then
    if v.status='paid' then
      if p_transaction_id is distinct from v.transaction_id then return jsonb_build_object('status','mismatch'); end if;
      select * into a from public.personal_accounts where customer_id=customer for update;
      insert into public.personal_account_entries(customer_id,amount_minor,kind,source_key)
        values(customer,v.amount_minor,'refund','pos-refund:'||v.id);
      update public.personal_accounts set balance_minor=balance_minor+v.amount_minor,updated_at=now() where customer_id=customer;
      update public.personal_account_pos_payments set status='refunded',updated_at=now() where id=v.id returning * into v;
    elsif v.status not in ('refunded','cancelled') then
      update public.personal_account_pos_payments set status='cancelled',updated_at=now() where id=v.id returning * into v;
    end if;
  elsif p_action='pay' and v.status='paid' then
    if p_transaction_id is distinct from v.transaction_id then return jsonb_build_object('status','mismatch'); end if;
  elsif p_action='status' and v.status in ('paid','refunded','cancelled','expired','locked') then
    null;
  elsif v.status='paid' then
    return jsonb_build_object('status','mismatch');
  else
    if v.status in ('cancelled','refunded','expired','locked') then return jsonb_build_object('status',v.status); end if;
    if v.expires_at<=now() then
      update public.personal_account_pos_payments set status='expired',updated_at=now() where id=v.id;
      return jsonb_build_object('status','expired');
    end if;
    if p_action='confirm' then
      if v.status not in ('pending','authorized') then return jsonb_build_object('status','mismatch'); end if;
      if p_code_hash is null or p_code_hash<>v.code_hash then
        update public.personal_account_pos_payments set attempts=least(5,attempts+1),
          status=case when attempts+1>=5 then 'locked' else status end,updated_at=now() where id=v.id;
        return jsonb_build_object('status','invalid_code');
      end if;
      update public.personal_account_pos_payments set status='authorized',updated_at=now() where id=v.id returning * into v;
    elsif p_action='pay' then
      if v.status<>'authorized' or p_transaction_id is null then return jsonb_build_object('status','unauthorized'); end if;
      if not exists(select 1 from public.customers where id=customer and deleted_at is null) then return jsonb_build_object('status','unavailable'); end if;
      select * into a from public.personal_accounts where customer_id=customer for update;
      if a.blocked then return jsonb_build_object('status','blocked'); end if;
      if coalesce(a.balance_minor,0)<v.amount_minor then return jsonb_build_object('status','insufficient'); end if;
      insert into public.personal_account_entries(customer_id,amount_minor,kind,source_key)
        values(customer,-v.amount_minor,'payment','pos-payment:'||v.id);
      update public.personal_accounts set balance_minor=balance_minor-v.amount_minor,updated_at=now() where customer_id=customer;
      update public.personal_account_pos_payments set status='paid',transaction_id=p_transaction_id,updated_at=now()
        where id=v.id returning * into v;
    elsif p_action<>'status' then return jsonb_build_object('status','invalid_action'); end if;
  end if;
  if v.status in ('paid','refunded') then notice := public.personal_account_pos_notice(v.id,v.status); end if;
  return jsonb_build_object('status',v.status,'id',v.id,'customerId',customer,'amountMinor',v.amount_minor,'notificationId',notice);
end; $$;

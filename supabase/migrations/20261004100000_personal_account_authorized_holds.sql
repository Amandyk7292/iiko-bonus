-- Every consumer uses the same customer/account lock order and protects valid
-- cash authorizations. Revoked or expired family QR holds reserve no money.
create function public.personal_account_held_minor(p_customer_id uuid, p_exclude_id uuid default null)
returns bigint language sql stable security definer set search_path=public as $$
  select coalesce(sum(p.amount_minor),0)::bigint
  from public.personal_account_pos_payments p
  where p.customer_id=p_customer_id and p.status='authorized' and p.expires_at>now()
    and (p_exclude_id is null or p.id<>p_exclude_id)
    and (p.family_member_id is null or exists (
      select 1 from public.family_members m join public.family_groups g on g.id=m.group_id
      where m.id=p.family_member_id and m.status='active' and not m.blocked
        and g.owner_customer_id=p.customer_id and m.qr_version=p.family_qr_version
        and p.family_qr_expires_at>now()
    ));
$$;

create or replace function public.personal_account_pay_order(p_customer_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.kaspi_orders%rowtype; a public.personal_accounts%rowtype; v_amount bigint;
begin
  perform 1 from public.customers where id=p_customer_id and deleted_at is null for update;
  if not found then raise exception 'personal account customer unavailable'; end if;
  select * into o from public.kaspi_orders where id=p_order_id and customer_id=p_customer_id for update;
  if not found or o.payment_method<>'personal_account' or coalesce(o.order_kind,'product')<>'product' then
    raise exception 'personal account order not found'; end if;
  if exists(select 1 from public.personal_account_entries where source_key='order-payment:'||o.id) then
    return jsonb_build_object('status',o.status); end if;
  if o.status<>'pending' or o.fulfillment_status<>'pending' or o.amount<=0
    or o.amount*100<>trunc(o.amount*100) then raise exception 'personal account order not payable'; end if;
  v_amount:=(o.amount*100)::bigint;
  insert into public.personal_accounts(customer_id) values(p_customer_id) on conflict do nothing;
  select * into a from public.personal_accounts where customer_id=p_customer_id for update;
  if a.blocked then return jsonb_build_object('status','blocked'); end if;
  if a.balance_minor-public.personal_account_held_minor(p_customer_id)<v_amount then
    return jsonb_build_object('status','insufficient'); end if;
  insert into public.personal_account_entries(customer_id,amount_minor,kind,source_key,order_id)
    values(p_customer_id,-v_amount,'payment','order-payment:'||o.id,o.id);
  update public.personal_accounts set balance_minor=balance_minor-v_amount,updated_at=now() where customer_id=p_customer_id;
  update public.kaspi_orders set status='paid',provider_status='paid',payment_reconciled_at=now(),updated_at=now() where id=o.id;
  return jsonb_build_object('status','paid');
end; $$;

-- The family's existing wrapper still validates QR versions, membership,
-- limits and refunds. Wrap its cash base so ordinary POS confirmations and
-- payments also cannot consume a different authorized intent's money.
alter function public.personal_account_pos_base_action(uuid,uuid,uuid,bigint,text,text,text,uuid)
  rename to personal_account_pos_unreserved_action;
create function public.personal_account_pos_base_action(p_id uuid,p_branch_id uuid,p_order_id uuid,p_amount_minor bigint,
  p_fingerprint text,p_action text,p_code_hash text default null,p_transaction_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.personal_account_pos_payments%rowtype; a public.personal_accounts%rowtype; customer uuid;
begin
  select customer_id into customer from public.personal_account_pos_payments where id=p_id and branch_id=p_branch_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  perform 1 from public.customers where id=customer for update;
  select * into v from public.personal_account_pos_payments where id=p_id for update;
  if v.branch_id is distinct from p_branch_id or v.iiko_order_id is distinct from p_order_id
    or v.amount_minor is distinct from p_amount_minor or v.fingerprint is distinct from p_fingerprint then
    return jsonb_build_object('status','mismatch'); end if;
  if p_action in ('confirm','pay') and v.status in ('pending','authorized') and v.expires_at>now() then
    select * into a from public.personal_accounts where customer_id=customer for update;
    if a.blocked then return jsonb_build_object('status','blocked'); end if;
    if coalesce(a.balance_minor,0)-public.personal_account_held_minor(customer,v.id)<v.amount_minor then
      return jsonb_build_object('status','insufficient'); end if;
  end if;
  return public.personal_account_pos_unreserved_action(p_id,p_branch_id,p_order_id,p_amount_minor,p_fingerprint,p_action,p_code_hash,p_transaction_id);
end; $$;
revoke all on function public.personal_account_held_minor(uuid,uuid),
  public.personal_account_pos_unreserved_action(uuid,uuid,uuid,bigint,text,text,text,uuid),
  public.personal_account_pos_base_action(uuid,uuid,uuid,bigint,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.personal_account_pay_order(uuid,uuid) to service_role;

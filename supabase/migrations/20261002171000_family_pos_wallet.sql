alter table public.family_child_sessions add column id uuid not null default gen_random_uuid() unique;
alter table public.family_members add column qr_version integer not null default 1 check (qr_version>0);
alter table public.personal_account_pos_payments add column family_member_id uuid references public.family_members(id),
  add column family_qr_version integer, add column family_qr_expires_at timestamptz, add column family_paid_at timestamptz;
create index family_member_payments on public.personal_account_pos_payments(family_member_id,family_paid_at,status) where family_member_id is not null;

create function public.family_member_wallet_stats(p_member_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('spentToday',coalesce((select sum(amount_minor) from public.personal_account_pos_payments
      where family_member_id=m.id and status='paid' and family_paid_at>=(date_trunc('day',now() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty')),0)/100.0,
    'remainingToday',greatest(0,least(case when a.blocked then 0 else coalesce(a.balance_minor,0) end,m.daily_limit_minor-coalesce((select sum(amount_minor) from public.personal_account_pos_payments
      where family_member_id=m.id and ((status='paid' and family_paid_at>=(date_trunc('day',now() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty'))
        or (status='authorized' and expires_at>now() and family_qr_version=m.qr_version))),0)))/100.0)
  from public.family_members m join public.family_groups g on g.id=m.group_id left join public.personal_accounts a on a.customer_id=g.owner_customer_id
  where m.id=p_member_id and m.status='active' and not m.blocked;
$$;

create function public.family_pos_start(p_id uuid,p_request_id uuid,p_member_id uuid,p_qr_version integer,p_qr_expires_at timestamptz,
  p_branch_id uuid,p_order_id uuid,p_amount_minor bigint,p_fingerprint text,p_code_hash text,p_notification_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare m public.family_members%rowtype; v public.personal_account_pos_payments%rowtype; owner_id uuid; a public.personal_accounts%rowtype; used bigint; held bigint;
begin
  select g.owner_customer_id into owner_id from public.family_members x join public.family_groups g on g.id=x.group_id where x.id=p_member_id;
  if owner_id is null then return jsonb_build_object('status','unavailable'); end if;
  perform 1 from public.customers where id=owner_id and deleted_at is null for update;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  select * into m from public.family_members where id=p_member_id for update;
  select * into v from public.personal_account_pos_payments where request_id=p_request_id;
  if found then
    if v.family_member_id is distinct from m.id or v.customer_id<>owner_id or v.branch_id<>p_branch_id or v.iiko_order_id<>p_order_id or v.amount_minor<>p_amount_minor or v.fingerprint<>p_fingerprint then return jsonb_build_object('status','mismatch'); end if;
    return jsonb_build_object('status',v.status,'id',v.id,'expiresAt',v.expires_at,'familyBonusCustomerId',v.customer_id);
  end if;
  if m.status<>'active' or m.blocked or m.qr_version<>p_qr_version then return jsonb_build_object('status','family_blocked'); end if;
  if p_qr_expires_at<=now() or p_qr_expires_at>now()+interval '5 minutes' then return jsonb_build_object('status','expired'); end if;
  if p_amount_minor not between 1 and 1000000000 or p_fingerprint !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status','mismatch'); end if;
  perform 1 from public.bulka_locations where id=p_branch_id and active=true;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  update public.personal_account_pos_payments set status='expired',updated_at=now() where branch_id=p_branch_id and iiko_order_id=p_order_id and status in ('pending','authorized') and expires_at<=now();
  if exists(select 1 from public.personal_account_pos_payments where branch_id=p_branch_id and iiko_order_id=p_order_id and status in ('pending','authorized','paid','refunded')) then return jsonb_build_object('status','order_busy'); end if;
  select coalesce(sum(amount_minor),0) into used from public.personal_account_pos_payments where family_member_id=m.id and status='paid'
    and family_paid_at>=(date_trunc('day',now() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty');
  select coalesce(sum(amount_minor),0) into held from public.personal_account_pos_payments where family_member_id=m.id and status='authorized' and expires_at>now() and family_qr_version=m.qr_version;
  if used+held+p_amount_minor>m.daily_limit_minor then return jsonb_build_object('status','family_limit'); end if;
  select * into a from public.personal_accounts where customer_id=owner_id for update;
  if a.blocked then return jsonb_build_object('status','blocked'); end if;
  select coalesce(sum(amount_minor),0) into held from public.personal_account_pos_payments where customer_id=owner_id and status='authorized' and expires_at>now();
  if coalesce(a.balance_minor,0)<held+p_amount_minor then return jsonb_build_object('status','insufficient'); end if;
  insert into public.personal_account_pos_payments(id,request_id,customer_id,branch_id,iiko_order_id,amount_minor,fingerprint,code_hash,notification_id,status,
    expires_at,family_member_id,family_qr_version,family_qr_expires_at)
    values(p_id,p_request_id,owner_id,p_branch_id,p_order_id,p_amount_minor,p_fingerprint,p_code_hash,p_notification_id,'authorized',p_qr_expires_at,m.id,p_qr_version,p_qr_expires_at)
    returning * into v;
  insert into public.family_audit(group_id,actor_customer_id,member_id,action,details) values(m.group_id,owner_id,m.id,'pos_authorized',jsonb_build_object('paymentId',v.id,'amountMinor',v.amount_minor));
  return jsonb_build_object('status','authorized','id',v.id,'expiresAt',v.expires_at,'familyBonusCustomerId',v.customer_id);
end $$;

-- Revocation never reverses a completed payment; authorized holds can be released immediately.
create function public.family_revoke_authorizations() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status<>'active' or new.blocked or new.qr_version<>old.qr_version then
    update public.personal_account_pos_payments set status='cancelled',updated_at=now()
      where family_member_id=new.id and status='authorized';
  end if;
  return new;
end $$;
create trigger family_member_revoke_authorizations after update on public.family_members
  for each row execute function public.family_revoke_authorizations();
revoke all on function public.family_revoke_authorizations() from public,anon,authenticated;

create function public.family_revoke_deleted_customer() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    insert into public.family_audit(group_id,actor_customer_id,member_id,action,details)
      select m.group_id,new.id,m.id,'member_removed','{"reason":"account_deleted"}'::jsonb
      from public.family_members m where m.status='active'
        and (m.customer_id=new.id or m.group_id in (select id from public.family_groups where owner_customer_id=new.id));
    update public.family_members m set status='removed',blocked=true,auth_version=auth_version+1,qr_version=qr_version+1,updated_at=now()
      where m.status='active' and (m.customer_id=new.id or m.group_id in (select id from public.family_groups where owner_customer_id=new.id));
    update public.family_invitations i set status='cancelled',answered_at=now()
      where i.status='pending' and (i.recipient_customer_id=new.id or i.group_id in (select id from public.family_groups where owner_customer_id=new.id));
  end if;
  return new;
end $$;
create trigger family_customer_deleted after update of deleted_at on public.customers
  for each row execute function public.family_revoke_deleted_customer();
revoke all on function public.family_revoke_deleted_customer() from public,anon,authenticated;

alter function public.personal_account_pos_action(uuid,uuid,uuid,bigint,text,text,text,uuid) rename to personal_account_pos_base_action;
create function public.personal_account_pos_action(p_id uuid,p_branch_id uuid,p_order_id uuid,p_amount_minor bigint,p_fingerprint text,
  p_action text,p_code_hash text default null,p_transaction_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v public.personal_account_pos_payments%rowtype; m public.family_members%rowtype; result jsonb; used bigint;
begin
  select * into v from public.personal_account_pos_payments where id=p_id and branch_id=p_branch_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v.iiko_order_id<>p_order_id or v.amount_minor<>p_amount_minor or v.fingerprint<>p_fingerprint then return jsonb_build_object('status','mismatch'); end if;
  if v.family_member_id is not null and p_action in ('pay','confirm') and v.status<>'paid' then
    perform 1 from public.customers where id=v.customer_id for update;
    select * into m from public.family_members where id=v.family_member_id for update;
    select * into v from public.personal_account_pos_payments where id=p_id for update;
    if v.status='paid' then
      return public.personal_account_pos_base_action(p_id,p_branch_id,p_order_id,p_amount_minor,p_fingerprint,p_action,p_code_hash,p_transaction_id)
        || jsonb_build_object('familyBonusCustomerId',v.customer_id);
    end if;
    if p_action='confirm' then return jsonb_build_object('status','unauthorized'); end if;
    if m.status<>'active' or m.blocked or m.qr_version<>v.family_qr_version then return jsonb_build_object('status','family_blocked'); end if;
    if v.family_qr_expires_at<=now() then return jsonb_build_object('status','expired'); end if;
    select coalesce(sum(amount_minor),0) into used from public.personal_account_pos_payments where family_member_id=m.id and status='paid'
      and family_paid_at>=(date_trunc('day',now() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty');
    if used+v.amount_minor>m.daily_limit_minor then return jsonb_build_object('status','family_limit'); end if;
  end if;
  result:=public.personal_account_pos_base_action(p_id,p_branch_id,p_order_id,p_amount_minor,p_fingerprint,p_action,p_code_hash,p_transaction_id);
  if v.family_member_id is not null and result->>'status'='paid' then
    update public.personal_account_pos_payments set family_paid_at=coalesce(family_paid_at,now()) where id=v.id;
  end if;
  return result || case when v.family_member_id is not null then jsonb_build_object('familyBonusCustomerId',v.customer_id) else '{}'::jsonb end;
end $$;
revoke all on function public.family_member_wallet_stats(uuid),public.family_pos_start(uuid,uuid,uuid,integer,timestamptz,uuid,uuid,bigint,text,text,uuid),
  public.personal_account_pos_action(uuid,uuid,uuid,bigint,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.family_member_wallet_stats(uuid),public.family_pos_start(uuid,uuid,uuid,integer,timestamptz,uuid,uuid,bigint,text,text,uuid),
  public.personal_account_pos_action(uuid,uuid,uuid,bigint,text,text,text,uuid) to service_role;

create or replace function public.family_update_member(p_owner_id uuid,p_member_id uuid,p_limit_minor bigint,p_blocked boolean,p_password_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare m public.family_members%rowtype;
begin
  select m0.* into m from public.family_members m0 join public.family_groups g on g.id=m0.group_id where m0.id=p_member_id and g.owner_customer_id=p_owner_id and m0.status='active' for update of m0;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if p_password_hash is not null and m.relation<>'child' then return jsonb_build_object('status','forbidden'); end if;
  update public.family_members set daily_limit_minor=coalesce(p_limit_minor,daily_limit_minor),blocked=coalesce(p_blocked,blocked),password_hash=coalesce(p_password_hash,password_hash),
    auth_version=auth_version+case when p_password_hash is not null or p_blocked=true then 1 else 0 end,qr_version=qr_version+1,updated_at=now() where id=m.id;
  update public.personal_account_pos_payments set status='cancelled',updated_at=now()
    where family_member_id=m.id and status='authorized';
  insert into public.family_audit(group_id,actor_customer_id,member_id,action,details) values(m.group_id,p_owner_id,m.id,'member_updated',jsonb_strip_nulls(jsonb_build_object('dailyLimitMinor',p_limit_minor,'blocked',p_blocked,'passwordChanged',p_password_hash is not null)));
  return jsonb_build_object('status','ok','customerId',m.customer_id);
end $$;

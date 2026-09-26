create table public.personal_account_pos_payments (
  id uuid primary key,
  request_id uuid not null unique,
  customer_id uuid not null references public.customers(id),
  branch_id uuid not null references public.bulka_locations(id),
  iiko_order_id uuid not null,
  amount_minor bigint not null check (amount_minor between 1 and 1000000000),
  fingerprint text not null check (length(fingerprint) = 64),
  code_hash text not null check (length(code_hash) = 64),
  attempts integer not null default 0 check (attempts between 0 and 5),
  status text not null default 'pending' check
    (status in ('pending','authorized','paid','cancelled','refunded','expired','locked')),
  transaction_id uuid,
  notification_id uuid not null,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index personal_account_pos_order_active on public.personal_account_pos_payments
  (branch_id,iiko_order_id) where status in ('pending','authorized','paid','refunded');
create index personal_account_pos_customer_recent on public.personal_account_pos_payments(customer_id,created_at desc);
alter table public.personal_account_pos_payments enable row level security;
revoke all on public.personal_account_pos_payments from public,anon,authenticated;
grant select on public.personal_account_pos_payments to service_role;
create policy personal_account_pos_service_read on public.personal_account_pos_payments
  for select to service_role using (true);

create function public.personal_account_pos_notice(p_id uuid,p_status text) returns uuid
language plpgsql security definer set search_path=public as $$
declare v public.personal_account_pos_payments%rowtype; lang text; nid uuid; title text; body text;
begin
  select * into v from public.personal_account_pos_payments where id=p_id;
  select preferred_language into lang from public.customers where id=v.customer_id;
  nid := md5('personal-pos:'||p_id||':'||p_status)::uuid;
  if p_status='paid' then
    title := case lang when 'kk' then 'Төлем сәтті өтті' when 'en' then 'Payment successful' else 'Оплата прошла успешно' end;
    body := case lang when 'kk' then format('Кассадағы сатып алу үшін жеке шотыңыздан %s ₸ есептен шығарылды.',v.amount_minor::numeric/100)
      when 'en' then format('%s ₸ was paid from your personal account at the counter.',v.amount_minor::numeric/100)
      else format('С личного счёта списано %s ₸ за покупку на кассе.',v.amount_minor::numeric/100) end;
  else
    title := case lang when 'kk' then 'Ақша қайтарылды' when 'en' then 'Payment refunded' else 'Деньги возвращены' end;
    body := case lang when 'kk' then format('Жеке шотыңызға %s ₸ қайтарылды.',v.amount_minor::numeric/100)
      when 'en' then format('%s ₸ was returned to your personal account.',v.amount_minor::numeric/100)
      else format('На личный счёт возвращено %s ₸.',v.amount_minor::numeric/100) end;
  end if;
  insert into public.customer_notifications(id,customer_id,title,body,type,payload)
    values(nid,v.customer_id,title,body,'order_personal_account_'||p_status,
      jsonb_build_object('destination','notifications','paymentId',p_id,'amount',v.amount_minor::numeric/100,'status',p_status))
    on conflict(id) do nothing;
  return nid;
end; $$;
revoke all on function public.personal_account_pos_notice(uuid,text) from public,anon,authenticated;

create function public.personal_account_pos_start(
  p_id uuid,p_request_id uuid,p_customer_id uuid,p_branch_id uuid,p_order_id uuid,
  p_amount_minor bigint,p_fingerprint text,p_code_hash text,p_notification_id uuid,
  p_title text,p_body text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.personal_account_pos_payments%rowtype; a public.personal_accounts%rowtype;
begin
  perform 1 from public.customers where id=p_customer_id and deleted_at is null for update;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  perform 1 from public.bulka_locations where id=p_branch_id and active=true;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  select * into v from public.personal_account_pos_payments where request_id=p_request_id;
  if found then
    if v.customer_id<>p_customer_id or v.branch_id<>p_branch_id or v.iiko_order_id<>p_order_id
      or v.amount_minor<>p_amount_minor or v.fingerprint<>p_fingerprint then
      return jsonb_build_object('status','mismatch');
    end if;
    return jsonb_build_object('status',v.status,'id',v.id,'notificationId',v.notification_id,'expiresAt',v.expires_at);
  end if;
  update public.personal_account_pos_payments set status='expired',updated_at=now()
    where branch_id=p_branch_id and iiko_order_id=p_order_id
    and status in ('pending','authorized') and expires_at<=now();
  select * into v from public.personal_account_pos_payments
    where branch_id=p_branch_id and iiko_order_id=p_order_id
      and status in ('pending','authorized','paid','refunded');
  if found then return jsonb_build_object('status','order_busy'); end if;
  if exists(select 1 from public.personal_account_pos_payments where customer_id=p_customer_id
      and created_at>now()-interval '1 minute') then
    return jsonb_build_object('status','rate_limited');
  end if;
  select * into a from public.personal_accounts where customer_id=p_customer_id;
  if a.blocked then return jsonb_build_object('status','blocked'); end if;
  if coalesce(a.balance_minor,0)<p_amount_minor then return jsonb_build_object('status','insufficient'); end if;
  insert into public.personal_account_pos_payments
    (id,request_id,customer_id,branch_id,iiko_order_id,amount_minor,fingerprint,code_hash,notification_id)
    values(p_id,p_request_id,p_customer_id,p_branch_id,p_order_id,p_amount_minor,p_fingerprint,p_code_hash,p_notification_id)
    returning * into v;
  insert into public.customer_notifications(id,customer_id,title,body,type,payload)
    values(p_notification_id,p_customer_id,p_title,p_body,'order_personal_account_code',
      p_payload || jsonb_build_object('expiresAt',v.expires_at,'paymentId',v.id));
  return jsonb_build_object('status',v.status,'id',v.id,'notificationId',v.notification_id,'expiresAt',v.expires_at);
end; $$;

create function public.personal_account_pos_action(
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

revoke all on function public.personal_account_pos_start(uuid,uuid,uuid,uuid,uuid,bigint,text,text,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.personal_account_pos_action(uuid,uuid,uuid,bigint,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.personal_account_pos_start(uuid,uuid,uuid,uuid,uuid,bigint,text,text,uuid,text,text,jsonb) to service_role;
grant execute on function public.personal_account_pos_action(uuid,uuid,uuid,bigint,text,text,text,uuid) to service_role;

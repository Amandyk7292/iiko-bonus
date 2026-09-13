-- A separate prepaid-money ledger; loyalty bonuses are never a funding source.
create table public.personal_accounts (
  customer_id uuid primary key references public.customers(id),
  balance_minor bigint not null default 0,
  blocked boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.personal_account_topups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  request_id uuid not null,
  amount_minor bigint not null check (amount_minor between 10000 and 20000000),
  status text not null default 'creating' check (status in ('creating','pending','credited','failed','expired','reversed')),
  token_ciphertext text,
  provider_transaction_id text unique,
  expires_at timestamptz,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (customer_id, request_id)
);
create table public.personal_account_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  amount_minor bigint not null check (amount_minor <> 0),
  kind text not null check (kind in ('topup','payment','refund','reversal')),
  source_key text not null unique,
  order_id uuid references public.kaspi_orders(id),
  topup_id uuid references public.personal_account_topups(id),
  created_at timestamptz not null default now(),
  check ((kind in ('topup','refund') and amount_minor > 0) or (kind in ('payment','reversal') and amount_minor < 0))
);
create index personal_account_history on public.personal_account_entries(customer_id, created_at desc);
create index personal_account_topup_reconcile on public.personal_account_topups(checked_at nulls first);
create index personal_account_order_entries on public.personal_account_entries(order_id);
alter table public.kaspi_orders add column if not exists personal_account_fingerprint text;

create function public.personal_account_immutable_entry() returns trigger
language plpgsql set search_path = public as $$
begin raise exception 'personal account ledger is append-only'; end; $$;
create trigger personal_account_entry_immutable before update or delete on public.personal_account_entries
for each row execute function public.personal_account_immutable_entry();

create function public.personal_account_confirm_topup(p_id uuid, p_transaction_id text, p_reverse boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.personal_account_topups%rowtype; v_balance bigint;
begin
  select * into t from public.personal_account_topups where id = p_id for update;
  if not found or t.token_ciphertext is null or p_transaction_id is null or length(p_transaction_id) not between 1 and 100 then
    raise exception 'invalid verified topup';
  end if;
  if t.provider_transaction_id is not null and t.provider_transaction_id <> p_transaction_id then
    raise exception 'topup transaction mismatch';
  end if;
  insert into public.personal_accounts(customer_id) values(t.customer_id) on conflict do nothing;
  select balance_minor into v_balance from public.personal_accounts where customer_id = t.customer_id for update;
  if p_reverse then
    if t.status = 'credited' then
      insert into public.personal_account_entries(customer_id,amount_minor,kind,source_key,topup_id)
        values(t.customer_id,-t.amount_minor,'reversal','topup-reversal:' || t.id,t.id);
      v_balance := v_balance - t.amount_minor;
      update public.personal_accounts set balance_minor = v_balance, blocked = blocked or v_balance < 0, updated_at = now() where customer_id = t.customer_id;
    end if;
    update public.personal_account_topups set status = 'reversed', provider_transaction_id = p_transaction_id, checked_at = now() where id = t.id;
  elsif t.status not in ('credited','reversed') then
    insert into public.personal_account_entries(customer_id,amount_minor,kind,source_key,topup_id)
      values(t.customer_id,t.amount_minor,'topup','topup:' || t.id,t.id);
    v_balance := v_balance + t.amount_minor;
    update public.personal_accounts set balance_minor = v_balance, updated_at = now() where customer_id = t.customer_id;
    update public.personal_account_topups set status = 'credited', provider_transaction_id = p_transaction_id, checked_at = now() where id = t.id;
  end if;
  return jsonb_build_object('balanceMinor',v_balance);
end; $$;

create function public.personal_account_pay_order(p_customer_id uuid, p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.kaspi_orders%rowtype; a public.personal_accounts%rowtype; v_amount bigint;
begin
  perform 1 from public.customers where id = p_customer_id and deleted_at is null for update;
  if not found then raise exception 'personal account customer unavailable'; end if;
  select * into o from public.kaspi_orders where id = p_order_id and customer_id = p_customer_id for update;
  if not found or o.payment_method <> 'personal_account' or coalesce(o.order_kind,'product') <> 'product' then
    raise exception 'personal account order not found';
  end if;
  if exists(select 1 from public.personal_account_entries where source_key = 'order-payment:' || o.id) then
    return jsonb_build_object('status',o.status);
  end if;
  if o.status <> 'pending' or o.fulfillment_status <> 'pending' or o.amount <= 0
    or o.amount * 100 <> trunc(o.amount * 100) then raise exception 'personal account order not payable'; end if;
  v_amount := (o.amount * 100)::bigint;
  insert into public.personal_accounts(customer_id) values(p_customer_id) on conflict do nothing;
  select * into a from public.personal_accounts where customer_id = p_customer_id for update;
  if a.blocked then return jsonb_build_object('status','blocked'); end if;
  if a.balance_minor < v_amount then return jsonb_build_object('status','insufficient'); end if;
  insert into public.personal_account_entries(customer_id,amount_minor,kind,source_key,order_id)
    values(p_customer_id,-v_amount,'payment','order-payment:' || o.id,o.id);
  update public.personal_accounts set balance_minor = balance_minor - v_amount, updated_at = now() where customer_id = p_customer_id;
  update public.kaspi_orders set status = 'paid', provider_status = 'paid', payment_reconciled_at = now(), updated_at = now() where id = o.id;
  return jsonb_build_object('status','paid');
end; $$;

-- Bank refunds are separate transactions, and may be partial or repeated in
-- notifications. Preserve each verified reversal once and block overspending.
create function public.personal_account_reverse_bank_transaction(p_topup_id uuid, p_payment_uid text, p_reversal_uid text, p_amount_minor bigint)
returns void language plpgsql security definer set search_path = public as $$
declare t public.personal_account_topups%rowtype; e public.personal_account_entries%rowtype; v_reversed bigint;
begin
  select * into t from public.personal_account_topups where id = p_topup_id for update;
  if not found or t.provider_transaction_id is distinct from p_payment_uid or p_payment_uid is null
    or p_reversal_uid is null or length(p_reversal_uid) not between 1 and 100
    or p_amount_minor is null or p_amount_minor <= 0 then raise exception 'invalid bank reversal'; end if;
  select * into e from public.personal_account_entries where source_key = 'bank-reversal:' || p_reversal_uid;
  if found then
    if e.topup_id <> t.id or e.amount_minor <> -p_amount_minor then raise exception 'reversal identity mismatch'; end if;
    return;
  end if;
  select -coalesce(sum(amount_minor),0) into v_reversed from public.personal_account_entries
    where topup_id = t.id and kind = 'reversal';
  if t.status <> 'credited' or v_reversed + p_amount_minor > t.amount_minor then raise exception 'reversal exceeds topup'; end if;
  perform 1 from public.personal_accounts where customer_id = t.customer_id for update;
  insert into public.personal_account_entries(customer_id,amount_minor,kind,source_key,topup_id)
    values(t.customer_id,-p_amount_minor,'reversal','bank-reversal:' || p_reversal_uid,t.id);
  update public.personal_accounts set balance_minor = balance_minor - p_amount_minor,
    blocked = blocked or balance_minor - p_amount_minor < 0, updated_at = now() where customer_id = t.customer_id;
  if v_reversed + p_amount_minor = t.amount_minor then
    update public.personal_account_topups set status = 'reversed', checked_at = now() where id = t.id;
  end if;
end; $$;
revoke all on function public.personal_account_reverse_bank_transaction(uuid,text,text,bigint) from public, anon, authenticated;
grant execute on function public.personal_account_reverse_bank_transaction(uuid,text,text,bigint) to service_role;

create function public.personal_account_refund_order(p_order_id uuid, p_request_id uuid, p_amount_minor bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.kaspi_orders%rowtype; e public.personal_account_entries%rowtype; v_paid bigint; v_refunded bigint; v_key text;
begin
  select * into o from public.kaspi_orders where id = p_order_id for update;
  if not found or o.payment_method <> 'personal_account' or p_request_id is null or p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'invalid personal account refund'; end if;
  v_key := 'order-refund:' || o.id || ':' || p_request_id;
  select * into e from public.personal_account_entries where source_key = v_key;
  if found then
    if e.amount_minor <> p_amount_minor then raise exception 'refund request already used'; end if;
    return jsonb_build_object('reference',e.id,'requestId',p_request_id);
  end if;
  select -coalesce(sum(amount_minor),0) into v_paid from public.personal_account_entries where order_id = o.id and kind = 'payment';
  select coalesce(sum(amount_minor),0) into v_refunded from public.personal_account_entries where order_id = o.id and kind = 'refund';
  if p_amount_minor > v_paid - v_refunded then raise exception 'refund exceeds payment'; end if;
  perform 1 from public.personal_accounts where customer_id = o.customer_id for update;
  insert into public.personal_account_entries(customer_id,amount_minor,kind,source_key,order_id)
    values(o.customer_id,p_amount_minor,'refund',v_key,o.id) returning * into e;
  update public.personal_accounts set balance_minor = balance_minor + p_amount_minor, updated_at = now() where customer_id = o.customer_id;
  return jsonb_build_object('reference',e.id,'requestId',p_request_id);
end; $$;

alter table public.personal_accounts enable row level security;
alter table public.personal_account_topups enable row level security;
alter table public.personal_account_entries enable row level security;
revoke all on public.personal_accounts, public.personal_account_topups, public.personal_account_entries from public, anon, authenticated;
grant select on public.personal_accounts, public.personal_account_entries to service_role;
grant select, insert, update on public.personal_account_topups to service_role;
create policy personal_account_service_read on public.personal_accounts for select to service_role using (true);
create policy personal_account_entries_service_read on public.personal_account_entries for select to service_role using (true);
create policy personal_account_topups_service on public.personal_account_topups for all to service_role using (true) with check (true);
revoke all on function public.personal_account_confirm_topup(uuid,text,boolean), public.personal_account_pay_order(uuid,uuid), public.personal_account_refund_order(uuid,uuid,bigint), public.personal_account_immutable_entry() from public, anon, authenticated;
grant execute on function public.personal_account_confirm_topup(uuid,text,boolean), public.personal_account_pay_order(uuid,uuid), public.personal_account_refund_order(uuid,uuid,bigint) to service_role;

-- Serialize profile deletion with account funding and checkout. A paid balance
-- cannot silently become inaccessible through profile anonymization.
create function public.personal_account_customer_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null and (
    exists(select 1 from public.personal_accounts where customer_id = new.id and (balance_minor <> 0 or blocked))
    or exists(select 1 from public.personal_account_topups where customer_id = new.id and status in ('creating','pending'))
  ) then raise exception 'personal account has unsettled funds'; end if;
  return new;
end; $$;
create trigger personal_account_customer_deletion before update of deleted_at on public.customers
for each row execute function public.personal_account_customer_guard();

create function public.personal_account_topup_customer_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.customers where id = new.customer_id and deleted_at is null for update;
  if not found then raise exception 'personal account customer unavailable'; end if;
  return new;
end; $$;
create trigger personal_account_topup_owner before insert on public.personal_account_topups
for each row execute function public.personal_account_topup_customer_guard();
revoke all on function public.personal_account_customer_guard(), public.personal_account_topup_customer_guard() from public, anon, authenticated;

-- Branch-attributed loyalty audit and idempotent, MFA-gated admin gift issuance.

alter table public.iiko_operation_logs
  add column if not exists branch_id uuid references public.bulka_locations(id) on delete set null;

create index if not exists iiko_operation_logs_branch_created_idx
  on public.iiko_operation_logs(branch_id, created_at desc);

alter table public.loyalty_reservations
  add column if not exists pos_branch_id uuid
    references public.bulka_locations(id) on delete restrict;
create index if not exists loyalty_reservations_pos_branch_created_idx
  on public.loyalty_reservations(pos_branch_id, created_at desc)
  where pos_branch_id is not null;
create index if not exists loyalty_reservations_active_legacy_expiry_idx
  on public.loyalty_reservations(expires_at)
  where status = 'active' and order_id not like 'bp1:%';

create table if not exists public.branch_pos_loyalty_usage (
  reservation_id uuid primary key
    references public.loyalty_reservations(id) on delete cascade,
  branch_id uuid not null
    references public.bulka_locations(id) on delete restrict,
  customer_id uuid not null
    references public.customers(id) on delete cascade,
  order_id varchar(200) not null,
  order_total numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null,
  earned_bonus numeric(12, 2) not null default 0,
  status varchar(20) not null default 'active',
  claimed_at timestamptz not null default now(),
  committed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint branch_pos_loyalty_usage_amounts_check check (
    order_total >= 0
    and discount_amount >= 0
    and discount_amount <= order_total
    and earned_bonus >= 0
  ),
  constraint branch_pos_loyalty_usage_status_check check (
    status in ('active', 'committed', 'cancelled', 'expired')
  )
);

create index if not exists branch_pos_loyalty_usage_branch_claimed_idx
  on public.branch_pos_loyalty_usage(branch_id, claimed_at desc);
create index if not exists branch_pos_loyalty_usage_branch_committed_idx
  on public.branch_pos_loyalty_usage(branch_id, committed_at desc)
  where status = 'committed';

alter table public.branch_pos_loyalty_usage enable row level security;
drop policy if exists service_role_all_branch_pos_loyalty_usage
  on public.branch_pos_loyalty_usage;
create policy service_role_all_branch_pos_loyalty_usage
  on public.branch_pos_loyalty_usage for all to service_role
  using (true) with check (true);
revoke all on public.branch_pos_loyalty_usage from public, anon, authenticated;
grant all on public.branch_pos_loyalty_usage to service_role;

create or replace function public.reserve_branch_loyalty_balance(
  p_branch_id uuid,
  p_customer_id uuid,
  p_order_id text,
  p_order_total numeric,
  p_discount_amount numeric,
  p_max_discount_percent numeric,
  p_ttl_hours integer,
  p_max_order_total numeric,
  p_max_discount_amount numeric,
  p_rolling_order_count integer,
  p_rolling_order_total numeric,
  p_rolling_discount_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_reservation_id uuid;
  v_reservation_status text;
  v_reservation_committed_at timestamptz;
  v_reservation_branch_id uuid;
  v_usage public.branch_pos_loyalty_usage%rowtype;
  v_order_count integer;
  v_order_total numeric;
  v_discount_amount numeric;
begin
  if p_branch_id is null
    or p_customer_id is null
    or position('bp1:' || p_branch_id::text || ':' in coalesce(p_order_id, '')) <> 1
    or coalesce(p_order_total, -1) < 0
    or coalesce(p_discount_amount, -1) < 0
    or p_discount_amount > p_order_total
    or coalesce(p_max_order_total, 0) < 500
    or p_max_order_total > 100000000
    or coalesce(p_max_discount_amount, 0) < 1
    or p_max_discount_amount > p_max_order_total
    or coalesce(p_rolling_order_count, 0) < 1
    or p_rolling_order_count > 100000
    or coalesce(p_rolling_order_total, 0) < p_max_order_total
    or p_rolling_order_total > 100000000
    or coalesce(p_rolling_discount_amount, 0) < p_max_discount_amount
    or p_rolling_discount_amount > 100000000 then
    raise exception 'invalid branch loyalty safety limits';
  end if;
  if p_order_total > p_max_order_total
    or p_discount_amount > p_max_discount_amount then
    raise exception 'branch loyalty transaction limit exceeded';
  end if;
  if not exists (
    select 1 from public.bulka_locations
    where id = p_branch_id and active = true
  ) then
    raise exception 'branch loyalty claim conflict';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('branch-pos-loyalty:' || p_branch_id::text, 0)
  );
  v_result := public.reserve_loyalty_balance(
    p_customer_id,
    p_order_id,
    p_order_total,
    p_discount_amount,
    p_max_discount_percent,
    p_ttl_hours
  );
  v_reservation_id := (v_result->>'reservation_id')::uuid;
  select status, committed_at, pos_branch_id
    into v_reservation_status, v_reservation_committed_at, v_reservation_branch_id
  from public.loyalty_reservations
  where id = v_reservation_id;
  if v_reservation_branch_id is not null
    and v_reservation_branch_id <> p_branch_id then
    raise exception 'branch loyalty claim conflict';
  end if;
  update public.loyalty_reservations
  set pos_branch_id = p_branch_id, updated_at = now()
  where id = v_reservation_id;

  select * into v_usage
  from public.branch_pos_loyalty_usage
  where reservation_id = v_reservation_id
  for update;
  if found and (
    v_usage.branch_id <> p_branch_id
    or v_usage.customer_id <> p_customer_id
    or v_usage.order_id <> p_order_id
    or abs(v_usage.order_total - p_order_total) > 0.001
    or abs(v_usage.discount_amount - p_discount_amount) > 0.001
  ) then
    raise exception 'branch loyalty claim conflict';
  end if;

  if v_reservation_status = 'committed' then
    insert into public.branch_pos_loyalty_usage(
      reservation_id, branch_id, customer_id, order_id, order_total,
      discount_amount, status, claimed_at, committed_at
    ) values (
      v_reservation_id, p_branch_id, p_customer_id, p_order_id, p_order_total,
      p_discount_amount, 'committed',
      coalesce(v_reservation_committed_at, now()), v_reservation_committed_at
    ) on conflict (reservation_id) do nothing;
    return v_result;
  end if;
  if v_usage.reservation_id is not null
    and v_usage.status = 'active'
    and v_usage.claimed_at >= now() - interval '24 hours' then
    return v_result;
  end if;

  select count(*), coalesce(sum(u.order_total), 0), coalesce(sum(u.discount_amount), 0)
    into v_order_count, v_order_total, v_discount_amount
  from public.branch_pos_loyalty_usage u
  join public.loyalty_reservations r on r.id = u.reservation_id
  where u.branch_id = p_branch_id
    and u.reservation_id <> v_reservation_id
    and u.claimed_at >= now() - interval '24 hours'
    and (
      r.status = 'committed'
      or (r.status = 'active' and r.expires_at > now())
    );
  if v_order_count + 1 > p_rolling_order_count
    or v_order_total + p_order_total > p_rolling_order_total
    or v_discount_amount + p_discount_amount > p_rolling_discount_amount then
    raise exception 'branch loyalty rolling limit exceeded';
  end if;

  insert into public.branch_pos_loyalty_usage(
    reservation_id, branch_id, customer_id, order_id, order_total,
    discount_amount, status, claimed_at, committed_at, updated_at
  ) values (
    v_reservation_id, p_branch_id, p_customer_id, p_order_id, p_order_total,
    p_discount_amount, 'active', now(), null, now()
  ) on conflict (reservation_id) do update set
    status = 'active',
    claimed_at = now(),
    committed_at = null,
    updated_at = now();
  return v_result;
end;
$$;

create or replace function public.commit_branch_loyalty_reservation(
  p_branch_id uuid,
  p_customer_id uuid,
  p_order_id text,
  p_reservation_id uuid,
  p_order_total numeric,
  p_earned_bonus numeric,
  p_activation_delay_days integer,
  p_items jsonb,
  p_max_order_total numeric,
  p_max_discount_amount numeric,
  p_max_earned_bonus numeric,
  p_rolling_earned_bonus numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_usage public.branch_pos_loyalty_usage%rowtype;
  v_earned_bonus numeric;
begin
  if p_branch_id is null
    or p_customer_id is null
    or p_reservation_id is null
    or position('bp1:' || p_branch_id::text || ':' in coalesce(p_order_id, '')) <> 1
    or coalesce(p_order_total, -1) < 0
    or coalesce(p_earned_bonus, -1) < 0
    or coalesce(p_max_order_total, 0) < 500
    or p_max_order_total > 100000000
    or coalesce(p_max_discount_amount, 0) < 1
    or p_max_discount_amount > p_max_order_total
    or coalesce(p_max_earned_bonus, 0) < 1
    or p_max_earned_bonus > p_max_order_total
    or coalesce(p_rolling_earned_bonus, 0) < p_max_earned_bonus
    or p_rolling_earned_bonus > 100000000 then
    raise exception 'invalid branch loyalty safety limits';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('branch-pos-loyalty:' || p_branch_id::text, 0)
  );
  select * into v_usage
  from public.branch_pos_loyalty_usage
  where reservation_id = p_reservation_id
  for update;
  if not found
    or v_usage.branch_id <> p_branch_id
    or v_usage.customer_id <> p_customer_id
    or v_usage.order_id <> p_order_id
    or abs(v_usage.order_total - p_order_total) > 0.001 then
    raise exception 'branch loyalty claim conflict';
  end if;
  if p_order_total > p_max_order_total
    or v_usage.discount_amount > p_max_discount_amount
    or p_earned_bonus > p_max_earned_bonus then
    raise exception 'branch loyalty transaction limit exceeded';
  end if;

  if v_usage.status = 'committed' then
    return public.commit_loyalty_reservation(
      p_customer_id,
      p_order_id,
      p_reservation_id,
      p_order_total,
      v_usage.earned_bonus,
      p_activation_delay_days,
      p_items
    );
  end if;

  select coalesce(sum(earned_bonus), 0) into v_earned_bonus
  from public.branch_pos_loyalty_usage
  where branch_id = p_branch_id
    and reservation_id <> p_reservation_id
    and status = 'committed'
    and committed_at >= now() - interval '24 hours';
  if v_earned_bonus + p_earned_bonus > p_rolling_earned_bonus then
    raise exception 'branch loyalty rolling limit exceeded';
  end if;

  v_result := public.commit_loyalty_reservation(
    p_customer_id,
    p_order_id,
    p_reservation_id,
    p_order_total,
    p_earned_bonus,
    p_activation_delay_days,
    p_items
  );
  update public.branch_pos_loyalty_usage set
    status = 'committed',
    earned_bonus = p_earned_bonus,
    committed_at = coalesce(committed_at, now()),
    updated_at = now()
  where reservation_id = p_reservation_id;
  return v_result;
end;
$$;

create or replace function public.cancel_branch_loyalty_reservation(
  p_branch_id uuid,
  p_customer_id uuid,
  p_order_id text,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_usage public.branch_pos_loyalty_usage%rowtype;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('branch-pos-loyalty:' || p_branch_id::text, 0)
  );
  select * into v_usage
  from public.branch_pos_loyalty_usage
  where reservation_id = p_reservation_id
  for update;
  if not found
    or v_usage.branch_id <> p_branch_id
    or v_usage.customer_id <> p_customer_id
    or v_usage.order_id <> p_order_id then
    raise exception 'branch loyalty claim conflict';
  end if;
  v_result := public.cancel_loyalty_reservation(
    p_customer_id,
    p_order_id,
    p_reservation_id
  );
  update public.branch_pos_loyalty_usage set
    status = 'cancelled',
    updated_at = now()
  where reservation_id = p_reservation_id;
  return v_result;
end;
$$;

revoke all on function public.reserve_branch_loyalty_balance(
  uuid, uuid, text, numeric, numeric, numeric, integer,
  numeric, numeric, integer, numeric, numeric
) from public, anon, authenticated;
revoke all on function public.commit_branch_loyalty_reservation(
  uuid, uuid, text, uuid, numeric, numeric, integer, jsonb,
  numeric, numeric, numeric, numeric
) from public, anon, authenticated;
revoke all on function public.cancel_branch_loyalty_reservation(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.reserve_branch_loyalty_balance(
  uuid, uuid, text, numeric, numeric, numeric, integer,
  numeric, numeric, integer, numeric, numeric
) to service_role;
grant execute on function public.commit_branch_loyalty_reservation(
  uuid, uuid, text, uuid, numeric, numeric, integer, jsonb,
  numeric, numeric, numeric, numeric
) to service_role;
grant execute on function public.cancel_branch_loyalty_reservation(
  uuid, uuid, text, uuid
) to service_role;

alter table public.gift_cards
  add column if not exists issue_request_id uuid,
  add column if not exists issue_payload_hash varchar(64),
  add column if not exists issue_code_ciphertext text,
  add column if not exists issued_by varchar(160);

create unique index if not exists gift_cards_issue_request_unique_idx
  on public.gift_cards(issue_request_id)
  where issue_request_id is not null;

create index if not exists gift_cards_issued_by_created_idx
  on public.gift_cards(issued_by, created_at desc)
  where issued_by is not null;

create or replace function public.issue_admin_gift_card(
  p_request_id uuid,
  p_payload_hash text,
  p_code_hash text,
  p_code_last4 text,
  p_code_ciphertext text,
  p_amount numeric,
  p_purchaser_customer_id uuid,
  p_recipient_customer_id uuid,
  p_recipient_name text,
  p_message text,
  p_expires_at timestamptz,
  p_issued_by text,
  p_daily_amount_limit numeric,
  p_daily_count_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.gift_cards%rowtype;
  v_daily_amount numeric;
  v_daily_count integer;
begin
  if p_request_id is null
    or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$'
    or length(coalesce(p_code_hash, '')) <> 64
    or length(coalesce(p_code_last4, '')) <> 4
    or length(coalesce(p_code_ciphertext, '')) < 20
    or coalesce(p_amount, 0) < 500
    or p_amount > 1000000
    or length(btrim(coalesce(p_issued_by, ''))) < 1
    or length(p_issued_by) > 160
    or coalesce(p_daily_amount_limit, 0) < 500
    or p_daily_amount_limit > 100000000
    or coalesce(p_daily_count_limit, 0) < 1
    or p_daily_count_limit > 1000
    or (p_expires_at is not null and p_expires_at <= now()) then
    raise exception 'invalid admin gift card issuance values';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('admin-gift-request:' || p_request_id::text, 0)
  );
  select * into v_card
  from public.gift_cards
  where issue_request_id = p_request_id
  for update;
  if found then
    if v_card.issue_payload_hash is distinct from p_payload_hash then
      raise exception 'admin gift card idempotency conflict';
    end if;
    return jsonb_build_object(
      'card', to_jsonb(v_card)
        - 'code_hash'
        - 'issue_code_ciphertext'
        - 'issue_payload_hash',
      'codeCiphertext', v_card.issue_code_ciphertext,
      'duplicate', true
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('admin-gift-issuer:' || btrim(p_issued_by), 0)
  );
  select count(*), coalesce(sum(initial_balance), 0)
    into v_daily_count, v_daily_amount
  from public.gift_cards
  where issued_by = btrim(p_issued_by)
    and created_at >= now() - interval '24 hours';
  if v_daily_count >= p_daily_count_limit
    or v_daily_amount + p_amount > p_daily_amount_limit then
    raise exception 'admin gift card daily limit exceeded';
  end if;

  insert into public.gift_cards(
    code_hash,
    code_last4,
    initial_balance,
    balance,
    purchaser_customer_id,
    recipient_customer_id,
    recipient_name,
    message,
    expires_at,
    issue_request_id,
    issue_payload_hash,
    issue_code_ciphertext,
    issued_by
  ) values (
    p_code_hash,
    p_code_last4,
    p_amount,
    p_amount,
    p_purchaser_customer_id,
    p_recipient_customer_id,
    nullif(btrim(coalesce(p_recipient_name, '')), ''),
    nullif(btrim(coalesce(p_message, '')), ''),
    p_expires_at,
    p_request_id,
    p_payload_hash,
    p_code_ciphertext,
    btrim(p_issued_by)
  ) returning * into v_card;

  insert into public.gift_card_transactions(gift_card_id, customer_id, type, amount)
  values (v_card.id, p_purchaser_customer_id, 'issue', p_amount);

  return jsonb_build_object(
    'card', to_jsonb(v_card)
      - 'code_hash'
      - 'issue_code_ciphertext'
      - 'issue_payload_hash',
    'codeCiphertext', v_card.issue_code_ciphertext,
    'duplicate', false
  );
end;
$$;

revoke all on function public.issue_admin_gift_card(
  uuid, text, text, text, text, numeric, uuid, uuid, text, text,
  timestamptz, text, numeric, integer
) from public, anon, authenticated;
grant execute on function public.issue_admin_gift_card(
  uuid, text, text, text, text, numeric, uuid, uuid, text, text,
  timestamptz, text, numeric, integer
) to service_role;

-- Payroll acknowledgements are an append-only journal. They do not initiate a
-- bank transfer or change an accrued 300 KZT signup reward.
create table public.cashier_payroll_payments (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  business_month date not null check (extract(day from business_month) = 1),
  row_key text not null check (row_key ~ '^[a-f0-9]{64}$'),
  unpaid_snapshot text not null check (unpaid_snapshot ~ '^[a-f0-9]{64}$'),
  employee_id text not null references public.cashier_signup_directory(employee_id),
  point_id text,
  city text not null,
  branch_id uuid references public.bulka_locations(id),
  employee_name text not null,
  branch_name text not null,
  amount bigint not null check (amount > 0),
  registrations integer not null check (registrations > 0),
  paid_at timestamptz not null default now(),
  paid_by text not null check (length(btrim(paid_by)) between 1 and 160),
  branch_scope uuid[] not null,
  check (amount = registrations::bigint * 300)
);
create table public.cashier_payroll_payment_rewards (
  reward_id uuid primary key references public.cashier_signup_rewards(id),
  payment_id uuid not null references public.cashier_payroll_payments(id)
);
create index cashier_payroll_payments_month_row on public.cashier_payroll_payments(business_month, row_key, paid_at);
create index cashier_payroll_payment_rewards_batch on public.cashier_payroll_payment_rewards(payment_id);
alter table public.cashier_payroll_payments enable row level security;
alter table public.cashier_payroll_payment_rewards enable row level security;
create policy cashier_payroll_payments_service on public.cashier_payroll_payments
  for select to service_role using (true);
create policy cashier_payroll_payment_rewards_service on public.cashier_payroll_payment_rewards
  for select to service_role using (true);
revoke all on public.cashier_payroll_payments, public.cashier_payroll_payment_rewards
  from public, anon, authenticated, service_role;
grant select on public.cashier_payroll_payments, public.cashier_payroll_payment_rewards to service_role;

-- Label changes do not split a historical employee/point/city/branch group.
-- JSON preserves the distinction between null and a textual ID/label.
create function public.cashier_payroll_row_key(p_employee text, p_point text, p_city text, p_branch uuid)
returns text language sql immutable set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(jsonb_build_array(p_employee, p_point, p_city, p_branch)::text, 'UTF8')), 'hex');
$$;

create function public.cashier_payroll_statement(p_month text, p_branches uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  month_start date;
  starts_at timestamptz;
  ends_at timestamptz;
  result jsonb;
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(p_month, 4) = '0000'
    or p_branches is null or array_position(p_branches, null) is not null then
    raise exception using errcode = '22023', message = 'CASHIER_PAYROLL_INVALID_REQUEST';
  end if;
  month_start := (p_month || '-01')::date;
  starts_at := month_start::timestamp at time zone interval '05:00';
  ends_at := (month_start + interval '1 month') at time zone interval '05:00';
  with period_rewards as materialized (
    select r.*, a.payment_id
    from public.cashier_signup_rewards r
      left join public.cashier_payroll_payment_rewards a on a.reward_id = r.id
    where r.completed_at >= starts_at and r.completed_at < ends_at
      and (cardinality(p_branches) = 0 or r.branch_id = any(p_branches))
  ), grouped as (
    select employee_id, point_id, city, branch_id,
      (array_agg(employee_name order by completed_at desc, id desc))[1] employee_name,
      (array_agg(branch_name order by completed_at desc, id desc))[1] branch_name,
      count(*)::integer completed, sum(amount)::bigint reward_amount,
      coalesce(sum(amount) filter (where payment_id is not null), 0)::bigint paid_amount,
      coalesce(sum(amount) filter (where payment_id is null), 0)::bigint outstanding_amount,
      count(*) filter (where payment_id is null)::integer outstanding_count,
      encode(sha256(convert_to(coalesce(jsonb_agg(id::text order by id)
        filter (where payment_id is null), '[]'::jsonb)::text, 'UTF8')), 'hex') snapshot
    from period_rewards group by employee_id, point_id, city, branch_id
  ), rows as (
    select g.*, public.cashier_payroll_row_key(g.employee_id, g.point_id, g.city, g.branch_id) row_key,
      not d.is_active is_archived
    from grouped g join public.cashier_signup_directory d using(employee_id)
  ), summaries as (
    select r.*, coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'amount', p.amount, 'registrations', p.registrations,
      'paidAt', p.paid_at, 'paidBy', p.paid_by
    ) order by p.paid_at, p.id) from (
      -- Reviewed point mappings may fill a previously NULL historical branch.
      -- Follow the paid reward IDs, so their party remains visible after that
      -- authorized mapping without rewriting the stored payment/snapshot.
      select p.id, sum(paid.amount)::bigint amount, count(*)::integer registrations, p.paid_at, p.paid_by
      from public.cashier_payroll_payments p join period_rewards paid on paid.payment_id = p.id
      where paid.employee_id = r.employee_id
        and paid.point_id is not distinct from r.point_id
        and paid.city = r.city and paid.branch_id is not distinct from r.branch_id
      group by p.id, p.paid_at, p.paid_by
    ) p), '[]'::jsonb) payments
    from rows r
  )
  select jsonb_build_object('month', p_month,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'rowKey', row_key, 'id', employee_id, 'name', employee_name, 'pointId', point_id,
      'branchName', branch_name, 'city', city, 'isArchived', is_archived,
      'completed', completed, 'rewardAmount', reward_amount, 'paidAmount', paid_amount,
      'outstandingAmount', outstanding_amount, 'outstandingCount', outstanding_count,
      'snapshot', snapshot, 'payments', payments
    ) order by city, branch_name, employee_name, employee_id, row_key), '[]'::jsonb),
    'totals', jsonb_build_object('completed', coalesce(sum(completed), 0),
      'rewardAmount', coalesce(sum(reward_amount), 0), 'paidAmount', coalesce(sum(paid_amount), 0),
      'outstandingAmount', coalesce(sum(outstanding_amount), 0))) into result from summaries;
  return result;
end;
$$;

create function public.mark_cashier_payroll_paid(
  p_month text, p_row_key text, p_snapshot text, p_idempotency_key uuid,
  p_actor text, p_branches uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  month_start date;
  starts_at timestamptz;
  ends_at timestamptz;
  scope uuid[];
  previous public.cashier_payroll_payments%rowtype;
  batch public.cashier_payroll_payments%rowtype;
  outstanding_ids uuid[];
  current_snapshot text;
  total bigint;
  employee public.cashier_signup_rewards%rowtype;
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(p_month, 4) = '0000'
    or p_row_key is null or p_row_key !~ '^[a-f0-9]{64}$'
    or p_snapshot is null or p_snapshot !~ '^[a-f0-9]{64}$'
    or p_idempotency_key is null or p_actor is null or length(btrim(p_actor)) not between 1 and 160
    or p_branches is null or array_position(p_branches, null) is not null then
    raise exception using errcode = '22023', message = 'CASHIER_PAYROLL_INVALID_REQUEST';
  end if;
  month_start := (p_month || '-01')::date;
  starts_at := month_start::timestamp at time zone interval '05:00';
  ends_at := (month_start + interval '1 month') at time zone interval '05:00';
  select coalesce(array_agg(distinct branch_id order by branch_id), '{}'::uuid[]) into scope
    from unnest(p_branches) branch_id;
  -- First serialize retries of the same key, then payments of the same row.
  -- Every operation takes these locks in the same order.
  perform pg_advisory_xact_lock(hashtextextended('cashier-payroll-key:' || p_idempotency_key::text, 0));
  select * into previous from public.cashier_payroll_payments where idempotency_key = p_idempotency_key;
  if previous.id is not null then
    if previous.business_month <> month_start or previous.row_key <> p_row_key
      or previous.unpaid_snapshot <> p_snapshot or previous.paid_by <> p_actor
      or previous.branch_scope <> scope then
      raise exception using errcode = 'P0001', message = 'CASHIER_PAYROLL_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('payment', jsonb_build_object(
      'id', previous.id, 'amount', previous.amount, 'registrations', previous.registrations,
      'paidAt', previous.paid_at, 'paidBy', previous.paid_by), 'replayed', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cashier-payroll-row:' || p_month || ':' || p_row_key, 0));
  select array_agg(r.id order by r.id), sum(r.amount)::bigint,
    encode(sha256(convert_to(jsonb_agg(r.id::text order by r.id)::text, 'UTF8')), 'hex')
    into outstanding_ids, total, current_snapshot
  from public.cashier_signup_rewards r
    left join public.cashier_payroll_payment_rewards a on a.reward_id = r.id
  where a.reward_id is null and r.completed_at >= starts_at and r.completed_at < ends_at
    and (cardinality(scope) = 0 or r.branch_id = any(scope))
    and public.cashier_payroll_row_key(r.employee_id, r.point_id, r.city, r.branch_id) = p_row_key;
  if outstanding_ids is null then
    -- A missing/out-of-scope row uses the same response as an empty batch.
    raise exception using errcode = 'P0001', message = 'CASHIER_PAYROLL_NOTHING_OUTSTANDING';
  end if;
  if current_snapshot <> p_snapshot then
    raise exception using errcode = 'P0001', message = 'CASHIER_PAYROLL_SNAPSHOT_CHANGED';
  end if;
  select * into employee from public.cashier_signup_rewards
    where id = any(outstanding_ids) order by completed_at desc, id desc limit 1;
  insert into public.cashier_payroll_payments(idempotency_key, business_month, row_key, unpaid_snapshot,
    employee_id, point_id, city, branch_id, employee_name, branch_name,
    amount, registrations, paid_by, branch_scope)
  values(p_idempotency_key, month_start, p_row_key, p_snapshot, employee.employee_id,
    employee.point_id, employee.city, employee.branch_id, employee.employee_name, employee.branch_name,
    total, cardinality(outstanding_ids), p_actor, scope) returning * into batch;
  -- The exact snapshot is paid. A registration inserted after it was read stays
  -- outstanding. The reward_id primary key prevents any second allocation.
  insert into public.cashier_payroll_payment_rewards(reward_id, payment_id)
    select reward_id, batch.id from unnest(outstanding_ids) reward_id;
  return jsonb_build_object('payment', jsonb_build_object(
    'id', batch.id, 'amount', batch.amount, 'registrations', batch.registrations,
    'paidAt', batch.paid_at, 'paidBy', batch.paid_by), 'replayed', false);
end;
$$;
revoke all on function public.cashier_payroll_row_key(text,text,text,uuid),
  public.cashier_payroll_statement(text,uuid[]),
  public.mark_cashier_payroll_paid(text,text,text,uuid,text,uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.cashier_payroll_statement(text,uuid[]),
  public.mark_cashier_payroll_paid(text,text,text,uuid,text,uuid[]) to service_role;

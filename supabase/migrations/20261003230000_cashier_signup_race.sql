-- Employee identities come from the separate attendance directory. No credentials
-- or client phone numbers are copied here. Salary accrual is not a wallet transfer.
create table public.cashier_signup_directory (
  employee_id text primary key check (employee_id ~ '^[1-9][0-9]{0,18}$'),
  invite_token text not null unique check (invite_token ~ '^[a-f0-9]{64}$'),
  name text not null check (length(btrim(name)) between 1 and 240),
  point_id text check (point_id is null or point_id ~ '^[1-9][0-9]{0,18}$'),
  branch_name text not null check (length(btrim(branch_name)) between 1 and 240),
  city text not null check (length(btrim(city)) between 1 and 120),
  branch_id uuid references public.bulka_locations(id),
  is_active boolean not null default true,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table public.cashier_signup_rewards (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.cashier_signup_directory(employee_id),
  phone_key text not null unique check (phone_key ~ '^[a-f0-9]{64}$'),
  customer_id uuid unique references public.customers(id) on delete set null,
  amount integer not null default 300 check (amount = 300),
  employee_name text not null,
  point_id text,
  branch_name text not null,
  city text not null,
  branch_id uuid references public.bulka_locations(id),
  completed_at timestamptz not null default now()
);
create index cashier_signup_rewards_period on public.cashier_signup_rewards(completed_at, employee_id);
create index cashier_signup_rewards_branch on public.cashier_signup_rewards(branch_id, completed_at);
alter table public.cashier_signup_directory enable row level security;
alter table public.cashier_signup_rewards enable row level security;
create policy cashier_signup_directory_service on public.cashier_signup_directory
  for all to service_role using (true) with check (true);
create policy cashier_signup_rewards_service on public.cashier_signup_rewards
  for select to service_role using (true);
revoke all on public.cashier_signup_directory, public.cashier_signup_rewards from public, anon, authenticated, service_role;
grant select, insert, update on public.cashier_signup_directory to service_role;
-- Mutations of accrued rewards happen only through the atomic signup function.
grant select on public.cashier_signup_rewards to service_role;

create function public.sync_cashier_signup_directory(p_cashiers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare item jsonb;
begin
  if p_cashiers is null or jsonb_typeof(p_cashiers) <> 'array' or jsonb_array_length(p_cashiers) > 20000 then
    raise exception 'Invalid cashier directory';
  end if;
  perform pg_advisory_xact_lock(hashtext('cashier-directory-sync'));
  update public.cashier_signup_directory set is_active = false;
  for item in select value from jsonb_array_elements(p_cashiers) loop
    insert into public.cashier_signup_directory(employee_id, invite_token, name, point_id,
      branch_name, city, branch_id, is_active, synced_at)
    values(item->>'id', item->>'inviteToken', item->>'name', item->>'pointId',
      item->>'branchName', item->>'city', nullif(item->>'branchId', '')::uuid,
      (item->>'isActive')::boolean, now())
    on conflict(employee_id) do update set name = excluded.name, point_id = excluded.point_id,
      branch_name = excluded.branch_name, city = excluded.city, branch_id = excluded.branch_id,
      is_active = excluded.is_active, synced_at = excluded.synced_at;
  end loop;
  return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(d) order by name, employee_id)
    from public.cashier_signup_directory d where is_active), '[]'::jsonb));
end; $$;

create function public.finish_customer_registration_with_cashier(
  p_customer_id uuid, p_phone_key text, p_profile jsonb, p_cashier_token text, p_cashier jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare employee public.cashier_signup_directory%rowtype; reward_id uuid; registration jsonb;
begin
  -- The server obtains this snapshot directly from the attendance database for
  -- every signup; no employee status/name/amount is accepted from the client.
  if p_cashier_token is null or p_cashier_token !~ '^[a-f0-9]{64}$'
    or p_cashier->>'isActive' is distinct from 'true' then
    raise exception 'Cashier unavailable';
  end if;
  select * into employee from public.cashier_signup_directory where invite_token = p_cashier_token for update;
  if employee.employee_id is null or employee.employee_id is distinct from p_cashier->>'id' then
    raise exception 'Cashier unavailable';
  end if;
  -- Use the same phone lock as the existing signup, also across account deletion.
  perform pg_advisory_xact_lock(hashtext('branch-signup:' || p_phone_key));
  update public.cashier_signup_directory set name = p_cashier->>'name',
    point_id = p_cashier->>'pointId', branch_name = p_cashier->>'branchName',
    city = p_cashier->>'city', branch_id = nullif(p_cashier->>'branchId', '')::uuid,
    is_active = true, synced_at = now() where employee_id = employee.employee_id returning * into employee;
  registration := public.finish_customer_registration(p_customer_id, p_phone_key, p_profile);
  insert into public.cashier_signup_rewards(employee_id, phone_key, customer_id, employee_name,
    point_id, branch_name, city, branch_id)
  values(employee.employee_id, p_phone_key, p_customer_id, employee.name,
    employee.point_id, employee.branch_name, employee.city, employee.branch_id)
  on conflict(phone_key) do nothing returning id into reward_id;
  return registration || jsonb_build_object('cashierCounted', reward_id is not null,
    'cashierRewardAmount', case when reward_id is not null then 300 else 0 end);
end; $$;

create function public.cashier_signup_ranking(p_from timestamptz, p_to timestamptz, p_branches uuid[] default '{}') returns jsonb
language sql security definer set search_path = public as $$
  with rewards as (
    select r.employee_id, count(*)::integer completed, sum(r.amount)::integer reward_amount
    from public.cashier_signup_rewards r
    where r.completed_at >= p_from and r.completed_at < p_to
      and (cardinality(p_branches) = 0 or r.branch_id = any(p_branches))
    group by r.employee_id
  ), totals as (
    select d.*, coalesce(r.completed, 0) completed, coalesce(r.reward_amount, 0) reward_amount
    from public.cashier_signup_directory d left join rewards r using(employee_id)
    where (d.is_active or r.completed > 0)
      and (cardinality(p_branches) = 0 or d.branch_id = any(p_branches) or r.completed > 0)
  ), ranked as (select *, dense_rank() over(order by completed desc) rank from totals)
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'id', employee_id, 'name', name, 'branchName', branch_name, 'city', city,
    'completed', completed, 'rewardAmount', reward_amount, 'rank', rank,
    'isArchived', not is_active, 'inviteToken', case when is_active then invite_token else null end
  ) order by completed desc, name, employee_id), '[]'::jsonb)) from ranked;
$$;
revoke all on function public.sync_cashier_signup_directory(jsonb),
  public.finish_customer_registration_with_cashier(uuid,text,jsonb,text,jsonb),
  public.cashier_signup_ranking(timestamptz,timestamptz,uuid[]) from public, anon, authenticated;
grant execute on function public.sync_cashier_signup_directory(jsonb),
  public.finish_customer_registration_with_cashier(uuid,text,jsonb,text,jsonb),
  public.cashier_signup_ranking(timestamptz,timestamptz,uuid[]) to service_role;

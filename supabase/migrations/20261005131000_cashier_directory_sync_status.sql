-- Durable health of complete HR-directory synchronizations. No source credentials,
-- employee names, error messages, or customer information are stored here.
create sequence public.cashier_directory_sync_attempt_seq;
-- Only attempts newer than the last complete success are retained. Tracking
-- their IDs makes late concurrent failures idempotent and counts an outage
-- correctly even if several server processes finish in a different order.
create table public.cashier_directory_sync_attempts (
  attempt_id bigint primary key,
  attempted_at timestamptz not null,
  completed_at timestamptz,
  was_successful boolean
);
alter table public.cashier_directory_sync_attempts enable row level security;
revoke all on public.cashier_directory_sync_attempts from public, anon, authenticated, service_role;
create table public.cashier_directory_sync_status (
  singleton boolean primary key default true check (singleton),
  last_attempt_id bigint not null default 0,
  last_result_attempt_id bigint not null default 0,
  last_success_attempt_id bigint not null default 0,
  last_result_success boolean,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_since timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  cashier_count integer check (cashier_count between 0 and 20000)
);
insert into public.cashier_directory_sync_status(singleton) values(true);
alter table public.cashier_directory_sync_status enable row level security;
create policy cashier_directory_sync_status_service_read
  on public.cashier_directory_sync_status for select to service_role using (true);
revoke all on public.cashier_directory_sync_status from public, anon, authenticated, service_role;
grant select on public.cashier_directory_sync_status to service_role;
revoke all on sequence public.cashier_directory_sync_attempt_seq from public, anon, authenticated, service_role;

create function public.begin_cashier_directory_sync() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare attempt bigint;
begin
  -- Serialize issuance with the singleton row, so sequence order and attempt
  -- timestamps also remain ordered across different server processes.
  perform 1 from public.cashier_directory_sync_status where singleton for update;
  attempt := nextval('public.cashier_directory_sync_attempt_seq');
  insert into public.cashier_directory_sync_attempts(attempt_id, attempted_at)
    values(attempt, clock_timestamp());
  update public.cashier_directory_sync_status
    set last_attempt_id = attempt, last_attempt_at = clock_timestamp() where singleton;
  return attempt::text;
end; $$;

create function public.sync_cashier_directory_with_status(p_attempt_id bigint, p_cashiers jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare status public.cashier_directory_sync_status%rowtype; result jsonb; completed timestamptz;
begin
  select * into status from public.cashier_directory_sync_status where singleton for update;
  if p_attempt_id is null or p_attempt_id < 1 or p_attempt_id > status.last_attempt_id then
    raise exception 'Invalid cashier directory sync attempt';
  end if;
  -- A slow old source read cannot overwrite a newer successful full snapshot.
  -- Replaying a successful attempt is also harmless (including an empty roster).
  if p_attempt_id <= status.last_success_attempt_id then
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(d) order by name, employee_id)
      from public.cashier_signup_directory d where is_active), '[]'::jsonb));
  end if;
  if not exists(select 1 from public.cashier_directory_sync_attempts
    where attempt_id = p_attempt_id and was_successful is null) then
    raise exception 'Invalid cashier directory sync attempt';
  end if;
  result := public.sync_cashier_signup_directory(p_cashiers);
  completed := clock_timestamp();
  -- The directory and the success marker commit together. If validation or a
  -- write fails, neither the previous roster nor its success timestamp changes.
  update public.cashier_directory_sync_status set
    last_success_attempt_id = p_attempt_id,
    last_success_at = completed,
    cashier_count = jsonb_array_length(result->'items'),
    last_result_attempt_id = greatest(last_result_attempt_id, p_attempt_id),
    last_result_success = case when p_attempt_id > last_result_attempt_id then true else last_result_success end,
    failure_since = (select min(completed_at) from public.cashier_directory_sync_attempts
      where attempt_id > p_attempt_id and was_successful is false),
    consecutive_failures = (select count(*)::integer from public.cashier_directory_sync_attempts
      where attempt_id > p_attempt_id and was_successful is false)
  where singleton;
  delete from public.cashier_directory_sync_attempts where attempt_id <= p_attempt_id;
  return result;
end; $$;

create function public.fail_cashier_directory_sync(p_attempt_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare status public.cashier_directory_sync_status%rowtype; failed timestamptz;
begin
  select * into status from public.cashier_directory_sync_status where singleton for update;
  if p_attempt_id is null or p_attempt_id < 1 or p_attempt_id > status.last_attempt_id then
    raise exception 'Invalid cashier directory sync attempt';
  end if;
  -- A slower old failure cannot turn a newer completed success into an outage.
  if p_attempt_id <= status.last_success_attempt_id then return; end if;
  failed := clock_timestamp();
  update public.cashier_directory_sync_attempts set completed_at = failed, was_successful = false
    where attempt_id = p_attempt_id and was_successful is null;
  if not found then return; end if;
  update public.cashier_directory_sync_status set
    last_result_attempt_id = greatest(last_result_attempt_id, p_attempt_id),
    last_result_success = case when p_attempt_id > last_result_attempt_id then false else last_result_success end,
    last_failure_at = greatest(last_failure_at, failed),
    failure_since = (select min(completed_at) from public.cashier_directory_sync_attempts
      where attempt_id > status.last_success_attempt_id and was_successful is false),
    consecutive_failures = (select count(*)::integer from public.cashier_directory_sync_attempts
      where attempt_id > status.last_success_attempt_id and was_successful is false)
  where singleton;
end; $$;

create function public.get_cashier_directory_sync_status() returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'state', case when last_result_success is false then 'error'
      when last_success_at is null then 'never'
      when last_success_at <= now() - interval '15 minutes' then 'stale' else 'ok' end,
    'lastAttemptAt', last_attempt_at, 'lastSuccessAt', last_success_at,
    'lastFailureAt', last_failure_at, 'failureSince', failure_since,
    'consecutiveFailures', consecutive_failures, 'cashierCount', cashier_count
  ) from public.cashier_directory_sync_status where singleton;
$$;

revoke all on function public.begin_cashier_directory_sync(),
  public.sync_cashier_directory_with_status(bigint,jsonb),
  public.fail_cashier_directory_sync(bigint), public.get_cashier_directory_sync_status()
  from public, anon, authenticated;
grant execute on function public.begin_cashier_directory_sync(),
  public.sync_cashier_directory_with_status(bigint,jsonb),
  public.fail_cashier_directory_sync(bigint), public.get_cashier_directory_sync_status()
  to service_role;

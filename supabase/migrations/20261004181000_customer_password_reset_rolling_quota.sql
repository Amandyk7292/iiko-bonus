-- A separate rolling quota for SMS password-reset requests. Registration OTP
-- keeps its existing limits; failed/uncertain paid sends still use this quota.
create table if not exists public.customer_password_reset_send_limits (
  phone text primary key check (phone ~ '^\+7[67][0-9]{9}$'),
  first_requested_at timestamptz,
  second_requested_at timestamptz,
  check (second_requested_at is null or
    (first_requested_at is not null and first_requested_at <= second_requested_at))
);
alter table public.customer_password_reset_send_limits enable row level security;
revoke all on table public.customer_password_reset_send_limits from public, anon, authenticated;
grant all on table public.customer_password_reset_send_limits to service_role;

-- Preserve the last known reservation when upgrading an existing installation.
-- Completed/expired links can disappear; the new quota never relies on link rows.
insert into public.customer_password_reset_send_limits(phone, first_requested_at)
select phone, created_at from public.customer_password_reset_links
where created_at > clock_timestamp() - interval '24 hours'
on conflict(phone) do nothing;

create or replace function public.reserve_customer_password_reset_link(
  p_phone text, p_digest text, p_flow_id text, p_customer_id uuid, p_daily_limit integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_global public.customer_otp_send_limits%rowtype;
  v_phone public.customer_otp_send_limits%rowtype;
  v_reset public.customer_password_reset_send_limits%rowtype;
  v_now timestamptz;
  v_hour timestamptz;
  v_day timestamptz;
  v_retry integer := 0;
  v_auth_version integer := 0;
begin
  if coalesce(p_phone, '') !~ '^\+7[67][0-9]{9}$'
    or coalesce(p_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_flow_id, '') !~ '^[A-Za-z0-9]{12,64}$'
    or p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 100000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- Preserve the global -> phone locking order shared with reserve_customer_otp.
  -- It serializes all workers before they can reserve or spend any quota.
  insert into public.customer_otp_send_limits(scope) values ('global') on conflict do nothing;
  select * into v_global from public.customer_otp_send_limits where scope = 'global' for update;
  insert into public.customer_otp_send_limits(scope) values ('phone:' || p_phone) on conflict do nothing;
  select * into v_phone from public.customer_otp_send_limits where scope = 'phone:' || p_phone for update;
  insert into public.customer_password_reset_send_limits(phone) values(p_phone) on conflict do nothing;
  select * into v_reset from public.customer_password_reset_send_limits where phone = p_phone for update;
  -- Read the clock after any lock wait, including across a calendar boundary.
  v_now := clock_timestamp();
  v_hour := date_trunc('hour', v_now);
  v_day := date_trunc('day', v_now);
  if v_global.day_started_at <> v_day then v_global.day_count := 0; end if;
  if v_phone.hour_started_at <> v_hour then v_phone.hour_count := 0; end if;
  if v_phone.day_started_at <> v_day then v_phone.day_count := 0; end if;
  if v_phone.last_sent_at > v_now - interval '60 seconds' then
    v_retry := ceil(extract(epoch from v_phone.last_sent_at + interval '60 seconds' - v_now))::integer;
  end if;
  if v_phone.hour_count >= 5 then
    v_retry := greatest(v_retry, ceil(extract(epoch from v_hour + interval '1 hour' - v_now))::integer);
  end if;
  if v_phone.day_count >= 10 or v_global.day_count >= p_daily_limit then
    v_retry := greatest(v_retry, ceil(extract(epoch from v_day + interval '1 day' - v_now))::integer);
  end if;
  -- Drop only timestamps that have left the rolling window. Two retained times
  -- block resends until the older request becomes at least 24 hours old.
  if v_reset.second_requested_at <= v_now - interval '24 hours' then
    v_reset.first_requested_at := null;
    v_reset.second_requested_at := null;
  elsif v_reset.first_requested_at <= v_now - interval '24 hours' then
    v_reset.first_requested_at := v_reset.second_requested_at;
    v_reset.second_requested_at := null;
  end if;
  if v_reset.second_requested_at is not null then
    v_retry := greatest(v_retry,
      ceil(extract(epoch from v_reset.first_requested_at + interval '24 hours' - v_now))::integer);
  end if;
  if v_retry > 0 then
    return jsonb_build_object('status', 'rate_limited', 'retryAfterSeconds', v_retry,
      'limitKind', case when v_reset.second_requested_at is not null then 'rolling_24h' else 'shared' end);
  end if;
  -- Reserve before contacting the provider. Delivery failure, link consumption
  -- and link cleanup deliberately never refund this independent paid-send quota.
  update public.customer_password_reset_send_limits
    set first_requested_at = coalesce(v_reset.first_requested_at, v_now),
      second_requested_at = case when v_reset.first_requested_at is not null then v_now else null end
    where phone = p_phone;
  update public.customer_otp_send_limits set last_sent_at = v_now,
    day_started_at = v_day, day_count = v_global.day_count + 1 where scope = 'global';
  update public.customer_otp_send_limits set last_sent_at = v_now,
    hour_started_at = v_hour, hour_count = v_phone.hour_count + 1,
    day_started_at = v_day, day_count = v_phone.day_count + 1 where scope = 'phone:' || p_phone;
  if p_customer_id is not null then
    if not exists(select 1 from public.customers where id = p_customer_id
      and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = right(p_phone, 10)) then
      p_customer_id := null;
    else
      select auth_version into v_auth_version from public.customer_credentials where customer_id = p_customer_id;
    end if;
  end if;
  delete from public.customer_password_reset_links where expires_at <= v_now;
  insert into public.customer_password_reset_links(phone, token_digest, flow_id, customer_id, auth_version, expires_at)
    values(p_phone, p_digest, p_flow_id, p_customer_id, coalesce(v_auth_version, 0), v_now + interval '15 minutes')
    on conflict(phone) do update set token_digest = excluded.token_digest, flow_id = excluded.flow_id,
      customer_id = excluded.customer_id, auth_version = excluded.auth_version,
      delivery_state = 'pending', expires_at = excluded.expires_at, created_at = v_now;
  return jsonb_build_object('status', 'reserved', 'retryAfterSeconds',
    case when v_reset.first_requested_at is not null then
      greatest(60, ceil(extract(epoch from v_reset.first_requested_at + interval '24 hours' - v_now))::integer)
    else 60 end);
end;
$$;

revoke all on function public.reserve_customer_password_reset_link(text,text,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.reserve_customer_password_reset_link(text,text,text,uuid,integer) to service_role;

alter table public.customer_otp_send_limits
  add column if not exists last_flow_id text;

create or replace function public.reserve_customer_otp(
  p_phone text, p_digest text, p_payload jsonb, p_daily_limit integer
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_global public.customer_otp_send_limits%rowtype;
  v_phone public.customer_otp_send_limits%rowtype;
  v_now timestamptz := clock_timestamp();
  v_hour timestamptz;
  v_day timestamptz;
  v_retry integer;
begin
  if p_phone !~ '^\+7[67][0-9]{9}$' or p_digest !~ '^[a-f0-9]{64}$'
    or p_phone is null or p_digest is null
    or p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 100000
    or jsonb_typeof(p_payload) is distinct from 'object'
    or coalesce(p_payload->>'flowId', '') !~ '^[A-Za-z0-9]{12,64}$'
    or coalesce(p_payload->>'purpose', '') not in (
      'customer_login', 'customer_registration', 'customer_password_reset'
    ) then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_hour := date_trunc('hour', v_now);
  v_day := date_trunc('day', v_now);
  insert into public.customer_otp_send_limits(scope) values ('global') on conflict do nothing;
  select * into v_global from public.customer_otp_send_limits where scope = 'global' for update;
  insert into public.customer_otp_send_limits(scope) values ('phone:' || p_phone) on conflict do nothing;
  select * into v_phone from public.customer_otp_send_limits where scope = 'phone:' || p_phone for update;

  if v_global.day_started_at <> v_day then v_global.day_count := 0; end if;
  if v_phone.hour_started_at <> v_hour then v_phone.hour_count := 0; end if;
  if v_phone.day_started_at <> v_day then v_phone.day_count := 0; end if;
  v_retry := 0;
  if v_phone.last_sent_at > v_now - interval '60 seconds' then
    v_retry := ceil(extract(epoch from v_phone.last_sent_at + interval '60 seconds' - v_now))::integer;
  end if;
  if v_phone.hour_count >= 5 then
    v_retry := greatest(v_retry, ceil(extract(epoch from v_hour + interval '1 hour' - v_now))::integer);
  end if;
  if v_phone.day_count >= 10 or v_global.day_count >= p_daily_limit then
    v_retry := greatest(v_retry, ceil(extract(epoch from v_day + interval '1 day' - v_now))::integer);
  end if;
  if v_retry > 0 then
    return jsonb_build_object('status', 'rate_limited', 'retryAfterSeconds', v_retry);
  end if;
  update public.customer_otp_send_limits
    set last_sent_at = v_now, day_started_at = v_day, day_count = v_global.day_count + 1,
        last_flow_id = p_payload->>'flowId'
    where scope = 'global';
  update public.customer_otp_send_limits
    set last_sent_at = v_now, hour_started_at = v_hour, hour_count = v_phone.hour_count + 1,
        day_started_at = v_day, day_count = v_phone.day_count + 1,
        last_flow_id = p_payload->>'flowId'
    where scope = 'phone:' || p_phone;
  insert into public.whatsapp_sessions(id, data, expires_at)
    values ('otp_' || p_phone,
      (p_payload - 'code' - 'codeDigest' - 'attempts' - 'deliveryState') || jsonb_build_object(
        'phone', p_phone, 'codeDigest', p_digest, 'attempts', 0, 'deliveryState', 'pending',
        'expires', floor(extract(epoch from v_now + interval '5 minutes') * 1000)
      ), v_now + interval '5 minutes')
    on conflict (id) do update set data = excluded.data, expires_at = excluded.expires_at, updated_at = v_now;
  return jsonb_build_object('status', 'reserved');
end;
$$;

create or replace function public.release_customer_otp_reservation(
  p_phone text, p_flow_id text
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_phone_released boolean := false;
begin
  if p_phone !~ '^\+7[67][0-9]{9}$' or p_flow_id !~ '^[A-Za-z0-9]{12,64}$'
    or p_phone is null or p_flow_id is null then
    return false;
  end if;
  perform 1 from public.customer_otp_send_limits where scope = 'global' for update;
  perform 1 from public.customer_otp_send_limits where scope = 'phone:' || p_phone for update;
  if not exists (
    select 1 from public.customer_otp_send_limits
      where scope = 'phone:' || p_phone and last_flow_id = p_flow_id
  ) then
    return false;
  end if;
  update public.customer_otp_send_limits
    set day_count = case when day_started_at = date_trunc('day', v_now)
          then greatest(0, day_count - 1) else day_count end,
        last_flow_id = null
    where scope = 'global' and last_flow_id = p_flow_id;
  update public.customer_otp_send_limits
    set last_sent_at = '-infinity',
        hour_count = case when hour_started_at = date_trunc('hour', v_now)
          then greatest(0, hour_count - 1) else hour_count end,
        day_count = case when day_started_at = date_trunc('day', v_now)
          then greatest(0, day_count - 1) else day_count end,
        last_flow_id = null
    where scope = 'phone:' || p_phone and last_flow_id = p_flow_id;
  v_phone_released := found;
  return v_phone_released;
end;
$$;

revoke all on function public.reserve_customer_otp(text, text, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.release_customer_otp_reservation(text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_customer_otp(text, text, jsonb, integer)
  to service_role;
grant execute on function public.release_customer_otp_reservation(text, text)
  to service_role;

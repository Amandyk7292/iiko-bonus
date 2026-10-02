-- Automatic customer OTP is opt-in. Legacy WhatsApp sessions remain compatible.
create table if not exists public.customer_otp_send_limits (
  scope text primary key,
  last_sent_at timestamptz not null default '-infinity',
  hour_started_at timestamptz not null default now(),
  hour_count integer not null default 0,
  day_started_at timestamptz not null default now(),
  day_count integer not null default 0
);
alter table public.customer_otp_send_limits enable row level security;
revoke all on table public.customer_otp_send_limits from public, anon, authenticated;
grant all on table public.customer_otp_send_limits to service_role;

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
  -- A fixed locking order makes limits effective across concurrent server instances.
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
    set last_sent_at = v_now, day_started_at = v_day, day_count = v_global.day_count + 1
    where scope = 'global';
  update public.customer_otp_send_limits
    set last_sent_at = v_now, hour_started_at = v_hour, hour_count = v_phone.hour_count + 1,
        day_started_at = v_day, day_count = v_phone.day_count + 1
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

create or replace function public.complete_customer_otp_delivery(
  p_phone text, p_flow_id text, p_digest text, p_success boolean, p_message_id text
)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_success and length(coalesce(p_message_id, '')) = 0 then return false; end if;
  if p_success then
    update public.whatsapp_sessions
      set data = data || jsonb_build_object('deliveryState', 'accepted', 'providerMessageId', left(p_message_id, 256)),
          updated_at = clock_timestamp()
      where id = 'otp_' || p_phone and data->>'flowId' = p_flow_id
        and data->>'codeDigest' = p_digest and expires_at > clock_timestamp();
  else
    delete from public.whatsapp_sessions
      where id = 'otp_' || p_phone and data->>'flowId' = p_flow_id
        and data->>'codeDigest' = p_digest and data->>'deliveryState' = 'pending';
  end if;
  return found;
end;
$$;

create or replace function public.consume_customer_otp(p_phone text, p_code text, p_digest text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_session public.whatsapp_sessions%rowtype;
  v_payload jsonb;
  v_matches boolean;
  v_attempts integer;
begin
  if coalesce(p_code, '') !~ '^([0-9]{4}|[0-9]{6})$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_session from public.whatsapp_sessions where id = 'otp_' || p_phone for update;
  if not found then return jsonb_build_object('status', 'expired'); end if;
  begin
    v_payload := case when jsonb_typeof(v_session.data) = 'string'
      then (v_session.data #>> '{}')::jsonb else v_session.data end;
  exception when others then
    delete from public.whatsapp_sessions where id = v_session.id;
    return jsonb_build_object('status', 'expired');
  end;
  if v_session.expires_at is null or v_session.expires_at <= clock_timestamp()
    or jsonb_typeof(v_payload) is distinct from 'object' then
    delete from public.whatsapp_sessions where id = v_session.id;
    return jsonb_build_object('status', 'expired');
  end if;
  if v_payload ? 'codeDigest' then
    if v_payload->>'deliveryState' is distinct from 'accepted' then
      return jsonb_build_object('status', 'invalid');
    end if;
    v_matches := length(p_code) = 6 and coalesce(v_payload->>'codeDigest', '') = coalesce(p_digest, '');
  else
    v_matches := length(p_code) = 4 and coalesce(v_payload->>'code', '') = p_code;
  end if;
  if not coalesce(v_matches, false) then
    v_attempts := coalesce((v_payload->>'attempts')::integer, 0) + 1;
    if v_attempts >= 5 then
      delete from public.whatsapp_sessions where id = v_session.id;
      return jsonb_build_object('status', 'attempts_exceeded');
    end if;
    update public.whatsapp_sessions set data = v_payload || jsonb_build_object('attempts', v_attempts),
      updated_at = clock_timestamp() where id = v_session.id;
    return jsonb_build_object('status', 'invalid', 'attempts', v_attempts);
  end if;
  delete from public.whatsapp_sessions where id = v_session.id;
  return jsonb_build_object('status', 'success', 'payload',
    v_payload - 'code' - 'codeDigest' - 'attempts' - 'deliveryState' - 'providerMessageId');
end;
$$;

revoke all on function public.reserve_customer_otp(text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.complete_customer_otp_delivery(text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.consume_customer_otp(text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_customer_otp(text, text, jsonb, integer) to service_role;
grant execute on function public.complete_customer_otp_delivery(text, text, text, boolean, text) to service_role;
grant execute on function public.consume_customer_otp(text, text, text) to service_role;

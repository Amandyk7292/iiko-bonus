-- SMS password reset links. Only hashes reach storage; consume and password
-- replacement, including refresh-session revocation, share one transaction.
create table if not exists public.customer_password_reset_links (
  phone text primary key check (phone ~ '^\+7[67][0-9]{9}$'),
  token_digest text not null unique check (token_digest ~ '^[a-f0-9]{64}$'),
  flow_id text not null check (flow_id ~ '^[A-Za-z0-9]{12,64}$'),
  customer_id uuid references public.customers(id) on delete cascade,
  auth_version integer not null default 0,
  delivery_state text not null default 'pending' check (delivery_state in ('pending', 'accepted')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists customer_password_reset_links_expiry on public.customer_password_reset_links(expires_at);
alter table public.customer_password_reset_links enable row level security;
revoke all on table public.customer_password_reset_links from public, anon, authenticated;
grant all on table public.customer_password_reset_links to service_role;

create or replace function public.reserve_customer_password_reset_link(
  p_phone text, p_digest text, p_flow_id text, p_customer_id uuid, p_daily_limit integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_global public.customer_otp_send_limits%rowtype;
  v_phone public.customer_otp_send_limits%rowtype;
  v_now timestamptz := clock_timestamp();
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
  -- Same rows and locking order as reserve_customer_otp: neither flow can
  -- bypass the shared one-minute, hourly, daily or global paid-send limits.
  v_hour := date_trunc('hour', v_now);
  v_day := date_trunc('day', v_now);
  insert into public.customer_otp_send_limits(scope) values ('global') on conflict do nothing;
  select * into v_global from public.customer_otp_send_limits where scope = 'global' for update;
  insert into public.customer_otp_send_limits(scope) values ('phone:' || p_phone) on conflict do nothing;
  select * into v_phone from public.customer_otp_send_limits where scope = 'phone:' || p_phone for update;
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
  if v_retry > 0 then return jsonb_build_object('status', 'rate_limited', 'retryAfterSeconds', v_retry); end if;
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
  return jsonb_build_object('status', 'reserved');
end;
$$;

create or replace function public.complete_customer_password_reset_link_delivery(
  p_phone text, p_digest text, p_flow_id text, p_success boolean
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_success then
    update public.customer_password_reset_links set delivery_state = 'accepted'
      where phone = p_phone and token_digest = p_digest and flow_id = p_flow_id
        and expires_at > clock_timestamp();
  else
    delete from public.customer_password_reset_links where phone = p_phone and token_digest = p_digest
      and flow_id = p_flow_id and delivery_state = 'pending';
  end if;
  return found;
end;
$$;

create or replace function public.validate_customer_password_reset_link(p_digest text)
returns boolean language sql security definer set search_path = public as $$
  select exists(select 1 from public.customer_password_reset_links l
    join public.customers c on c.id = l.customer_id
    left join public.customer_credentials cr on cr.customer_id = c.id
    where l.token_digest = p_digest and l.delivery_state = 'accepted' and l.expires_at > clock_timestamp()
      and coalesce(cr.auth_version, 0) = l.auth_version
      and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = right(l.phone, 10));
$$;

create or replace function public.consume_customer_password_reset_link(p_digest text, p_password_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_link public.customer_password_reset_links%rowtype;
  v_customer_phone text;
  v_auth_version integer;
begin
  if coalesce(p_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_password_hash, '') !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_link from public.customer_password_reset_links where token_digest = p_digest for update;
  if not found or v_link.delivery_state <> 'accepted' or v_link.expires_at <= clock_timestamp()
    or v_link.customer_id is null then return jsonb_build_object('status', 'invalid'); end if;
  select phone into v_customer_phone from public.customers where id = v_link.customer_id for update;
  if not found or right(regexp_replace(v_customer_phone, '[^0-9]', '', 'g'), 10) <> right(v_link.phone, 10) then
    return jsonb_build_object('status', 'invalid');
  end if;
  select auth_version into v_auth_version from public.customer_credentials
    where customer_id = v_link.customer_id for update;
  if coalesce(v_auth_version, 0) <> v_link.auth_version or v_link.expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform public.set_customer_password(v_link.customer_id, p_password_hash);
  delete from public.customer_password_reset_links where token_digest = p_digest;
  return jsonb_build_object('status', 'success');
end;
$$;

revoke all on function public.reserve_customer_password_reset_link(text,text,text,uuid,integer) from public, anon, authenticated;
revoke all on function public.complete_customer_password_reset_link_delivery(text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.validate_customer_password_reset_link(text) from public, anon, authenticated;
revoke all on function public.consume_customer_password_reset_link(text,text) from public, anon, authenticated;
grant execute on function public.reserve_customer_password_reset_link(text,text,text,uuid,integer) to service_role;
grant execute on function public.complete_customer_password_reset_link_delivery(text,text,text,boolean) to service_role;
grant execute on function public.validate_customer_password_reset_link(text) to service_role;
grant execute on function public.consume_customer_password_reset_link(text,text) to service_role;

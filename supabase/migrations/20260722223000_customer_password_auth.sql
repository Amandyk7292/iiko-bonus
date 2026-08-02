-- Password credentials for customer accounts. Password hashes are deliberately
-- isolated from public.customers so existing profile/admin queries can never
-- serialize them by accident.

create table if not exists public.customer_credentials (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  password_hash text not null,
  auth_version integer not null default 1,
  password_set_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_credentials_password_hash_check check (
    password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'
  ),
  constraint customer_credentials_auth_version_check check (auth_version between 1 and 2147483647)
);

alter table public.customer_credentials enable row level security;

drop policy if exists "service_role_all_customer_credentials"
  on public.customer_credentials;
create policy "service_role_all_customer_credentials"
  on public.customer_credentials
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.customer_credentials from public, anon, authenticated;
grant all on table public.customer_credentials to service_role;

-- Password reset is one transaction: update the credential version and revoke
-- every refresh token that existed before the reset.
create or replace function public.set_customer_password(
  p_customer_id uuid,
  p_password_hash text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_auth_version integer;
begin
  if p_customer_id is null
    or coalesce(p_password_hash, '') !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception 'Invalid customer password credential' using errcode = '22023';
  end if;

  insert into public.customer_credentials (
    customer_id,
    password_hash,
    auth_version,
    password_set_at,
    updated_at
  ) values (
    p_customer_id,
    p_password_hash,
    1,
    now(),
    now()
  )
  on conflict (customer_id) do update set
    password_hash = excluded.password_hash,
    auth_version = public.customer_credentials.auth_version + 1,
    password_set_at = now(),
    updated_at = now()
  returning auth_version into next_auth_version;

  update public.customer_refresh_tokens
  set revoked_at = coalesce(revoked_at, now())
  where customer_id = p_customer_id
    and revoked_at is null;

  return next_auth_version;
end;
$$;

revoke all on function public.set_customer_password(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_customer_password(uuid, text) to service_role;

-- Preserve the purpose and server-side registration grant material when an OTP
-- is consumed. The code and attempt counter are never returned.
create or replace function public.consume_whatsapp_otp(
  p_phone text,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.whatsapp_sessions%rowtype;
  v_payload jsonb;
  v_attempts integer;
begin
  if length(btrim(coalesce(p_phone, ''))) < 10
    or length(btrim(coalesce(p_code, ''))) < 1 then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_session
  from public.whatsapp_sessions
  where id = 'otp_' || p_phone
  for update;
  if not found then return jsonb_build_object('status', 'expired'); end if;

  begin
    v_payload := case
      when jsonb_typeof(v_session.data) = 'string' then (v_session.data #>> '{}')::jsonb
      else v_session.data
    end;
  exception when others then
    delete from public.whatsapp_sessions where id = v_session.id;
    return jsonb_build_object('status', 'expired');
  end;

  if coalesce(v_session.expires_at, to_timestamp((v_payload->>'expires')::numeric / 1000)) <= now() then
    delete from public.whatsapp_sessions where id = v_session.id;
    return jsonb_build_object('status', 'expired');
  end if;

  if coalesce(v_payload->>'code', '') <> p_code then
    v_attempts := coalesce((v_payload->>'attempts')::integer, 0) + 1;
    if v_attempts >= 5 then
      delete from public.whatsapp_sessions where id = v_session.id;
      return jsonb_build_object('status', 'attempts_exceeded');
    end if;
    update public.whatsapp_sessions
    set data = v_payload || jsonb_build_object('attempts', v_attempts), updated_at = now()
    where id = v_session.id;
    return jsonb_build_object('status', 'invalid', 'attempts', v_attempts);
  end if;

  delete from public.whatsapp_sessions where id = v_session.id;
  return jsonb_build_object(
    'status',
    'success',
    'payload',
    v_payload - 'code' - 'attempts'
  );
end;
$$;

revoke all on function public.consume_whatsapp_otp(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_whatsapp_otp(text, text) to service_role;

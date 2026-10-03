-- A failed credential write must not burn the one-time verified password grant.
-- The function returns only the auth version, never the password hash.
create function public.create_customer_credential_from_registration_grant(
  p_customer_id uuid, p_phone text, p_grant_key text
) returns integer
language plpgsql security definer set search_path = public as $$
declare customer public.customers%rowtype; grant_row public.whatsapp_sessions%rowtype;
  payload jsonb; version integer;
begin
  if p_customer_id is null or p_phone is null or p_phone !~ '^\+7[0-9]{10}$'
    or p_grant_key is null or p_grant_key !~ '^registration_grant_[a-f0-9]{64}$' then
    raise exception 'Invalid registration grant' using errcode = '22023';
  end if;
  select * into customer from public.customers where id = p_customer_id for update;
  if customer.id is null
    or regexp_replace(customer.phone, '[^0-9]', '', 'g') is distinct from substring(p_phone from 2)
    or customer.deleted_at is not null then
    raise exception 'Invalid registration grant' using errcode = '22023';
  end if;
  if customer.app_registered_at is not null or lower(btrim(coalesce(customer.name, ''))) not in
    ('', 'гость', 'новый гость', 'қонақ', 'жаңа қонақ', 'guest', 'new guest') then
    raise exception 'Customer already registered' using errcode = '23505';
  end if;
  select auth_version into version from public.customer_credentials where customer_id = p_customer_id;
  if version is not null then return version; end if;
  select * into grant_row from public.whatsapp_sessions where id = p_grant_key for update;
  if grant_row.id is null or grant_row.expires_at is null or grant_row.expires_at <= now() then
    raise exception 'Invalid registration grant' using errcode = '22023';
  end if;
  begin
    payload := case when jsonb_typeof(grant_row.data) = 'string' then (grant_row.data #>> '{}')::jsonb else grant_row.data end;
    if payload->>'phone' is distinct from p_phone
      or coalesce((payload->>'expires')::numeric, 0) <= extract(epoch from now()) * 1000
      or coalesce(payload->>'passwordHash', '') !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
      raise exception 'Invalid registration grant' using errcode = '22023';
    end if;
  exception when others then
    raise exception 'Invalid registration grant' using errcode = '22023';
  end;
  insert into public.customer_credentials(customer_id, password_hash, auth_version, password_set_at, updated_at)
    values(p_customer_id, payload->>'passwordHash', 1, now(), now()) returning auth_version into version;
  delete from public.whatsapp_sessions where id = p_grant_key;
  return version;
end; $$;
revoke all on function public.create_customer_credential_from_registration_grant(uuid,text,text) from public, anon, authenticated;
grant execute on function public.create_customer_credential_from_registration_grant(uuid,text,text) to service_role;

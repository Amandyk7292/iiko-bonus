-- Push tokens are stored per app/browser installation so signing in on a
-- second device does not disable notifications on the first one.
create table if not exists public.customer_push_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  token text not null unique,
  installation_id varchar(160) not null unique,
  platform varchar(16) not null default 'unknown'
    check (platform in ('android', 'ios', 'web', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint customer_push_tokens_token_length
    check (char_length(token) between 20 and 4096),
  constraint customer_push_tokens_installation_length
    check (char_length(installation_id) between 8 and 160)
);

create index if not exists customer_push_tokens_customer_seen_idx
  on public.customer_push_tokens (customer_id, last_seen_at desc);

alter table public.customer_push_tokens enable row level security;
drop policy if exists "service role manages customer push tokens"
  on public.customer_push_tokens;
create policy "service role manages customer push tokens"
  on public.customer_push_tokens
  for all to service_role
  using (true)
  with check (true);

revoke all on table public.customer_push_tokens from public, anon, authenticated;
grant all on table public.customer_push_tokens to service_role;

insert into public.customer_push_tokens (
  customer_id,
  token,
  installation_id,
  platform,
  created_at,
  updated_at,
  last_seen_at
)
select
  id,
  fcm_token,
  'legacy:' || id::text,
  'unknown',
  coalesce(created_at, now()),
  now(),
  now()
from public.customers
where nullif(trim(fcm_token), '') is not null
on conflict (token) do nothing;

create or replace function public.register_customer_push_token(
  p_customer_id uuid,
  p_token text,
  p_platform text,
  p_installation_id text,
  p_language text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_token text := trim(coalesce(p_token, ''));
  v_installation_id text := trim(coalesce(p_installation_id, ''));
  v_platform text := lower(trim(coalesce(p_platform, 'unknown')));
  v_language text := lower(trim(coalesce(p_language, '')));
begin
  if p_customer_id is null then
    raise exception 'customer id is required';
  end if;
  if char_length(v_token) not between 20 and 4096 then
    raise exception 'invalid push token';
  end if;
  if v_installation_id !~ '^[A-Za-z0-9._:-]{8,160}$' then
    raise exception 'invalid installation id';
  end if;
  if v_platform not in ('android', 'ios', 'web', 'unknown') then
    v_platform := 'unknown';
  end if;
  if v_language = 'kz' then
    v_language := 'kk';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_installation_id, 0));

  delete from public.customer_push_tokens
  where token = v_token or installation_id = v_installation_id;

  insert into public.customer_push_tokens (
    customer_id,
    token,
    installation_id,
    platform,
    created_at,
    updated_at,
    last_seen_at
  )
  values (
    p_customer_id,
    v_token,
    v_installation_id,
    v_platform,
    now(),
    now(),
    now()
  )
  returning id into v_id;

  update public.customers
  set
    fcm_token = v_token,
    preferred_language = case
      when v_language in ('ru', 'kk', 'en') then v_language
      else preferred_language
    end,
    updated_at = now()
  where id = p_customer_id;

  if not found then
    raise exception 'customer not found';
  end if;

  return v_id;
end;
$$;

create or replace function public.unregister_customer_push_token(
  p_customer_id uuid,
  p_installation_id text default null,
  p_token text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer := 0;
  v_installation_id text := nullif(trim(coalesce(p_installation_id, '')), '');
  v_token text := nullif(trim(coalesce(p_token, '')), '');
begin
  if p_customer_id is null or (v_installation_id is null and v_token is null) then
    return 0;
  end if;

  delete from public.customer_push_tokens
  where customer_id = p_customer_id
    and (
      (v_installation_id is not null and installation_id = v_installation_id)
      or (v_token is not null and token = v_token)
    );
  get diagnostics v_removed = row_count;

  update public.customers
  set
    fcm_token = (
      select token
      from public.customer_push_tokens
      where customer_id = p_customer_id
      order by last_seen_at desc
      limit 1
    ),
    updated_at = now()
  where id = p_customer_id
    and (v_removed > 0 or (v_token is not null and fcm_token = v_token));

  return v_removed;
end;
$$;

create or replace function public.remove_invalid_customer_push_token(p_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_removed integer := 0;
  v_token text := nullif(trim(coalesce(p_token, '')), '');
begin
  if v_token is null then
    return 0;
  end if;

  delete from public.customer_push_tokens
  where token = v_token
  returning customer_id into v_customer_id;

  if found then
    update public.customers
    set
      fcm_token = (
        select token
        from public.customer_push_tokens
        where customer_id = v_customer_id
        order by last_seen_at desc
        limit 1
      ),
      updated_at = now()
    where id = v_customer_id;
    return 1;
  end if;

  update public.customers
  set fcm_token = null, updated_at = now()
  where fcm_token = v_token;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.register_customer_push_token(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.unregister_customer_push_token(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.remove_invalid_customer_push_token(text)
  from public, anon, authenticated;

grant execute on function public.register_customer_push_token(uuid, text, text, text, text)
  to service_role;
grant execute on function public.unregister_customer_push_token(uuid, text, text)
  to service_role;
grant execute on function public.remove_invalid_customer_push_token(text)
  to service_role;

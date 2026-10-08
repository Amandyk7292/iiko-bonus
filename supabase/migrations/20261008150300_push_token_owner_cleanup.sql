-- An installation transfer must also remove the former owner's legacy fallback.
-- Repair only legacy values for which another installation owner is known;
-- genuinely unclaimed legacy tokens remain usable.
update public.customers customer
set fcm_token = (
    select owned.token
    from public.customer_push_tokens owned
    where owned.customer_id = customer.id
    order by owned.last_seen_at desc, owned.id
    limit 1
  ),
  updated_at = now()
where exists (
  select 1 from public.customer_push_tokens current_owner
  where current_owner.token = customer.fcm_token
    and current_owner.customer_id <> customer.id
);

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
  v_replaced_tokens text[] := array[]::text[];
  v_previous record;
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
  -- Lock replaced installations before customer rows, as unregister does.
  for v_previous in
    select token from public.customer_push_tokens
    where token = v_token or installation_id = v_installation_id
    order by token for update
  loop
    v_replaced_tokens := array_append(v_replaced_tokens, v_previous.token);
  end loop;
  perform customer.id from public.customers customer
    where customer.id = p_customer_id
      or customer.fcm_token = v_token
      or customer.fcm_token = any(v_replaced_tokens)
    order by customer.id for update;

  delete from public.customer_push_tokens
  where token = v_token or installation_id = v_installation_id;

  insert into public.customer_push_tokens (
    customer_id, token, installation_id, platform, created_at, updated_at, last_seen_at
  ) values (
    p_customer_id, v_token, v_installation_id, v_platform, now(), now(), now()
  ) returning id into v_id;

  -- Leave a valid legacy value for another current installation unchanged.
  -- If its installation was removed, choose the owner's remaining device or null.
  update public.customers customer
  set fcm_token = (
      select owned.token from public.customer_push_tokens owned
      where owned.customer_id = customer.id
      order by owned.last_seen_at desc, owned.id
      limit 1
    ),
    updated_at = now()
  where customer.id <> p_customer_id
    and (customer.fcm_token = v_token or customer.fcm_token = any(v_replaced_tokens));

  update public.customers
  set fcm_token = v_token,
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

revoke all on function public.register_customer_push_token(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_customer_push_token(uuid, text, text, text, text)
  to service_role;

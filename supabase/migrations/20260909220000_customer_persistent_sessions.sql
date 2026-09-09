-- Customer devices keep their login until logout, credential revocation or deletion.
-- Short-lived access tokens continue to be rotated and verified on every request.
alter table public.customer_refresh_tokens
  alter column expires_at drop not null,
  add column if not exists rotation_key_hash varchar(64),
  add column if not exists auth_version integer;

-- Do not resurrect expired or explicitly revoked sessions.
update public.customer_refresh_tokens
set expires_at = null
where revoked_at is null and expires_at > now();

update public.customer_refresh_tokens t
set auth_version = c.auth_version
from public.customer_credentials c
where t.customer_id = c.customer_id and t.revoked_at is null and t.auth_version is null;

comment on column public.customer_refresh_tokens.expires_at is
  'Null means a persistent, revocable customer device session.';
comment on column public.customer_refresh_tokens.rotation_key_hash is
  'Hash of the device recovery proof used for this rotation; never store the raw proof.';

-- A logout from a delayed tab also revokes its newer token descendants.
create or replace function public.revoke_customer_refresh_session(p_token_hash text)
returns void language sql security definer set search_path = public as $$
  with recursive chain as (
    select id, replaced_by from public.customer_refresh_tokens where token_hash = p_token_hash
    union
    select t.id, t.replaced_by from public.customer_refresh_tokens t
    join chain c on t.id = c.replaced_by
  )
  update public.customer_refresh_tokens t
  set revoked_at = now(), last_used_at = null, rotation_key_hash = null
  where t.id in (select id from chain);
$$;
revoke all on function public.revoke_customer_refresh_session(text) from public, anon, authenticated;
grant execute on function public.revoke_customer_refresh_session(text) to service_role;

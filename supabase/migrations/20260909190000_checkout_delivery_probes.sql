-- Durable pre-payment courier probes. They never create customer orders.
create table if not exists public.checkout_delivery_probes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  route_hash text not null check (route_hash ~ '^[a-f0-9]{64}$'),
  request_payload jsonb,
  state text not null default 'creating' check (state in
    ('creating', 'evaluating', 'cancelling', 'complete', 'rejected', 'attention')),
  external_claim_id text,
  provider_status text,
  accept_attempted_at timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  checked_at timestamptz,
  last_error text,
  lease_token uuid,
  lease_until timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_delivery_probe_complete check
    (state <> 'complete' or (accepted_at is not null and cancelled_at is not null
      and provider_status = 'cancelled'))
);
create unique index if not exists checkout_delivery_probe_active_customer
  on public.checkout_delivery_probes(customer_id)
  where state not in ('complete', 'rejected');
create index if not exists checkout_delivery_probe_cleanup
  on public.checkout_delivery_probes(lease_until) where state not in ('complete', 'rejected');
create index if not exists checkout_delivery_probe_cache
  on public.checkout_delivery_probes(customer_id, route_hash, checked_at desc);
alter table public.checkout_delivery_probes enable row level security;
revoke all on public.checkout_delivery_probes from anon, authenticated;
grant all on public.checkout_delivery_probes to service_role;

create or replace function public.acquire_checkout_delivery_probe(
  p_customer_id uuid, p_route_hash text, p_payload jsonb, p_lease_token uuid,
  p_after timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_probe public.checkout_delivery_probes;
begin
  -- Serialize admission across server processes; no duplicate physical calls.
  perform pg_advisory_xact_lock(726103492);
  if p_customer_id is null or p_lease_token is null or p_payload is null then
    raise exception 'invalid delivery probe';
  end if;
  select * into v_probe from public.checkout_delivery_probes
    where customer_id = p_customer_id and route_hash = p_route_hash
      and state = 'complete' and checked_at > now() - interval '2 minutes'
      and (p_after is null or checked_at > p_after)
    order by checked_at desc limit 1;
  if found then return jsonb_build_object('kind', 'cached', 'probe', to_jsonb(v_probe)); end if;

  -- Unresolved acceptance blocks additional probes until cleanup catches up.
  if exists (select 1 from public.checkout_delivery_probes
    where state not in ('complete', 'rejected') and
      (customer_id = p_customer_id or
       (accept_attempted_at is not null and accept_attempted_at < now() - interval '5 seconds')))
    or (select count(*) from public.checkout_delivery_probes
      where state not in ('complete', 'rejected')) >= 3
    or exists (select 1 from public.checkout_delivery_probes
      where customer_id = p_customer_id and created_at > now() - interval '30 seconds') then
    return jsonb_build_object('kind', 'busy');
  end if;
  insert into public.checkout_delivery_probes
    (customer_id, route_hash, request_payload, lease_token, lease_until)
    values (p_customer_id, p_route_hash, p_payload, p_lease_token, now() + interval '20 seconds')
    returning * into v_probe;
  return jsonb_build_object('kind', 'created', 'probe', to_jsonb(v_probe));
end;
$$;

create or replace function public.lease_checkout_delivery_probe(p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_probe public.checkout_delivery_probes;
begin
  select * into v_probe from public.checkout_delivery_probes
    where state not in ('complete', 'rejected') and lease_until <= now()
    order by lease_until for update skip locked limit 1;
  if not found then return null; end if;
  update public.checkout_delivery_probes set lease_token = p_lease_token,
    lease_until = now() + interval '20 seconds', updated_at = now()
    where id = v_probe.id returning * into v_probe;
  return to_jsonb(v_probe);
end;
$$;

revoke all on function public.acquire_checkout_delivery_probe(uuid,text,jsonb,uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.lease_checkout_delivery_probe(uuid) from public, anon, authenticated;
grant execute on function public.acquire_checkout_delivery_probe(uuid,text,jsonb,uuid,timestamptz)
  to service_role;
grant execute on function public.lease_checkout_delivery_probe(uuid) to service_role;

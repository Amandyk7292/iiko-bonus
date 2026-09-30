-- Native identity is independent of app preferences and account lifetime.
-- Raw identifiers never leave the API process; only namespaced hashes are stored.
create table public.referral_stable_device_owners (
  device_hash text primary key check (length(device_hash)=64),
  customer_id uuid not null,
  kind text not null check (kind in ('android_id','ios_keychain')),
  created_at timestamptz not null default now()
);
create table public.referral_stable_devices (
  customer_id uuid not null references public.customers(id) on delete cascade,
  device_hash text not null references public.referral_stable_device_owners(device_hash),
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (customer_id,device_hash)
);
alter table public.referral_stable_device_owners enable row level security;
alter table public.referral_stable_devices enable row level security;
revoke all on public.referral_stable_device_owners,public.referral_stable_devices
  from public,anon,authenticated;
grant select,insert on public.referral_stable_device_owners to service_role;
grant select on public.referral_stable_devices to service_role;
create policy referral_stable_owners_service on public.referral_stable_device_owners
  for all to service_role using(true) with check(true);
create policy referral_stable_devices_service on public.referral_stable_devices
  for all to service_role using(true) with check(true);
create table public.referral_device_proofs (
  proof_hash text primary key check(length(proof_hash)=64),
  challenge_hash text not null unique check(length(challenge_hash)=64),
  customer_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.referral_device_proofs enable row level security;
revoke all on public.referral_device_proofs from public,anon,authenticated;
grant select on public.referral_device_proofs to service_role;
create policy referral_device_proofs_service on public.referral_device_proofs
  for all to service_role using(true) with check(true);

create or replace function public.referral_device_risk(p_customer_id uuid) returns text
language sql stable security definer set search_path=public as $$
  select case
    when exists (select 1 from public.referral_devices d
      join public.referral_device_owners o using(device_hash)
      where d.customer_id=p_customer_id and o.customer_id<>p_customer_id)
      or exists (select 1 from public.referral_stable_devices d
        join public.referral_stable_device_owners o using(device_hash)
        where d.customer_id=p_customer_id and (d.blocked or o.customer_id<>p_customer_id))
      then 'shared_device'
    when not exists (select 1 from public.referral_stable_devices
      where customer_id=p_customer_id) then 'missing_device'
    else null
  end;
$$;
revoke all on function public.referral_device_risk(uuid) from public,anon,authenticated;
grant execute on function public.referral_device_risk(uuid) to service_role;

create function public.remember_stable_referral_device(
  p_customer_id uuid,p_installation_hash text,p_stable_hash text,p_kind text,
  p_proof_hash text,p_challenge_hash text,p_blocked boolean default false
) returns text language plpgsql security definer set search_path=public as $$
declare v_owner uuid;
begin
  perform 1 from public.customers where id=p_customer_id for update;
  if not found then raise exception 'customer not found'; end if;
  if p_installation_hash is not null and p_installation_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid installation hash';
  end if;
  if p_stable_hash is not null and (p_stable_hash !~ '^[a-f0-9]{64}$'
    or p_kind is null or p_kind not in ('android_id','ios_keychain')
    or p_proof_hash is null or p_proof_hash !~ '^[a-f0-9]{64}$'
    or p_challenge_hash is null or p_challenge_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'invalid stable device';
  end if;
  if p_stable_hash is not null then
    insert into public.referral_device_proofs(proof_hash,challenge_hash,customer_id)
      values(p_proof_hash,p_challenge_hash,p_customer_id);
  end if;
  if p_installation_hash is not null then
    insert into public.referral_devices(customer_id,device_hash)
      values(p_customer_id,p_installation_hash) on conflict do nothing;
    -- Preserve the first owner of a pre-upgrade installation when adopting
    -- its stable identity. A second account cannot claim it during upgrade.
    select customer_id into v_owner from public.referral_device_owners
      where device_hash=p_installation_hash;
  end if;
  if p_stable_hash is not null then
    insert into public.referral_stable_device_owners(device_hash,customer_id,kind)
      values(p_stable_hash,coalesce(v_owner,p_customer_id),p_kind)
      on conflict(device_hash) do nothing;
    insert into public.referral_stable_devices(customer_id,device_hash,blocked)
      values(p_customer_id,p_stable_hash,coalesce(p_blocked,false))
      on conflict(customer_id,device_hash) do update
        set blocked=referral_stable_devices.blocked or excluded.blocked;
  end if;
  return public.referral_device_risk(p_customer_id);
end;
$$;
revoke all on function public.remember_stable_referral_device(uuid,text,text,text,text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.remember_stable_referral_device(uuid,text,text,text,text,text,boolean)
  to service_role;

-- Do not even accept a code for a second account on a previously claimed phone.
-- Registration itself ignores this rejection and remains available.
create or replace function public.redeem_referral_code(p_customer_id uuid,p_code text)
returns public.referral_redemptions language plpgsql security definer set search_path=public as $$
declare r public.referral_redemptions%rowtype; risk text;
begin
  perform 1 from public.customers where id=p_customer_id for update;
  risk := public.referral_device_risk(p_customer_id);
  if risk='shared_device' then raise exception 'referral device already claimed'; end if;
  r := public.redeem_referral_code_v1(p_customer_id,p_code);
  if risk is not null and r.status in ('registered','qualified') then
    update public.referral_redemptions set review_state='pending',risk_reasons=array[risk]
      where id=r.id returning * into r;
  end if;
  return r;
end;
$$;

-- The existing payout wrapper checks both beneficiaries with this stricter
-- risk function, including manually approved requests and future POS purchases.
-- Account deletion cannot remove either permanent owner table (no customer FK).
create or replace function public.process_referral_purchase(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.referral_first_purchases%rowtype; r public.referral_redemptions%rowtype;
  c public.referral_codes%rowtype; result jsonb; risk text;
begin
  select * into p from public.referral_first_purchases where customer_id=p_customer_id for update;
  if p.customer_id is null then return jsonb_build_object('status','not_found'); end if;
  select * into r from public.referral_redemptions where referred_customer_id=p_customer_id for update;
  if r.id is null then return public.process_referral_purchase_v1(p_customer_id); end if;
  if p.state<>'pending' then return jsonb_build_object('status','already_processed'); end if;
  if r.review_state='rejected' or p.amount-p.refunded_amount<=0
    or p.amount-p.refunded_amount<coalesce(r.min_first_order,0) then
    update public.referral_first_purchases set state='rejected' where customer_id=p_customer_id;
    update public.referral_redemptions set status='cancelled' where id=r.id;
    return jsonb_build_object('status','not_eligible');
  end if;
  select * into c from public.referral_codes where id=r.referral_code_id for update;
  perform 1 from public.customers where id in (p_customer_id,c.customer_id) order by id for update;
  risk := coalesce(public.referral_device_risk(p_customer_id),public.referral_device_risk(c.customer_id));
  -- Always check both beneficiaries, including manually approved redemptions.
  if risk is not null then
    update public.referral_redemptions set review_state='pending',risk_reasons=array[risk] where id=r.id;
    return jsonb_build_object('status','review','reason',risk);
  end if;
  if r.review_state='pending' then
    if cardinality(r.risk_reasons)>0 and r.risk_reasons <@ array['monthly_limit','shared_device','missing_device']::text[] then
      update public.referral_redemptions set review_state='clear',risk_reasons='{}' where id=r.id;
    else
      return jsonb_build_object('status','review');
    end if;
  end if;
  result := public.process_referral_purchase_v1(p_customer_id);
  if result->>'status'='rewarded' then
    insert into public.referral_events(redemption_id,customer_id,kind,amount)
    values(r.id,p_customer_id,'reward',(result->>'friendReward')::numeric),
      (r.id,c.customer_id,'reward',(result->>'ownerReward')::numeric)
    on conflict do nothing;
  end if;
  return result;
end; $$;

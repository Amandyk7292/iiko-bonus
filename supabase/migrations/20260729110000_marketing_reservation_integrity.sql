-- Reserve limited promotions before redirecting a customer to a payment
-- provider, and award both sides of a referral in one database transaction.

create table if not exists public.promotion_reservations (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.targeted_promotions(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  client_request_id uuid not null,
  order_id uuid references public.kaspi_orders(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'consumed', 'released', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  unique (customer_id, client_request_id)
);

create unique index if not exists promotion_reservations_order_idx
  on public.promotion_reservations(order_id)
  where order_id is not null;

create index if not exists promotion_reservations_capacity_idx
  on public.promotion_reservations(promotion_id, status, expires_at);

alter table public.promotion_reservations enable row level security;
drop policy if exists service_role_all_promotion_reservations
  on public.promotion_reservations;
create policy service_role_all_promotion_reservations
  on public.promotion_reservations for all to service_role
  using (true) with check (true);
revoke all on table public.promotion_reservations from public, anon, authenticated;
grant all on table public.promotion_reservations to service_role;

create or replace function public.reserve_order_promotion(
  p_promotion_id uuid,
  p_customer_id uuid,
  p_client_request_id uuid,
  p_ttl_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promotion public.targeted_promotions%rowtype;
  v_existing public.promotion_reservations%rowtype;
  v_reservation public.promotion_reservations%rowtype;
  v_redeemed bigint := 0;
  v_reserved bigint := 0;
  v_customer_redeemed bigint := 0;
  v_customer_reserved bigint := 0;
  v_ttl integer := greatest(5, least(coalesce(p_ttl_minutes, 30), 1500));
begin
  if p_promotion_id is null or p_customer_id is null or p_client_request_id is null then
    raise exception 'promotion reservation parameters are required';
  end if;

  perform pg_advisory_xact_lock(hashtext('promotion-capacity:' || p_promotion_id::text));

  update public.promotion_reservations
  set status = 'expired', updated_at = now()
  where promotion_id = p_promotion_id
    and status = 'active'
    and expires_at <= now();

  select * into v_existing
  from public.promotion_reservations
  where customer_id = p_customer_id and client_request_id = p_client_request_id
  for update;

  if v_existing.id is not null then
    if v_existing.promotion_id <> p_promotion_id then
      raise exception 'checkout already reserves another promotion';
    end if;
    if v_existing.status in ('active', 'consumed') then
      return jsonb_build_object(
        'status', v_existing.status,
        'reservationId', v_existing.id,
        'expiresAt', v_existing.expires_at
      );
    end if;
  end if;

  select * into v_promotion
  from public.targeted_promotions
  where id = p_promotion_id
  for update;

  if v_promotion.id is null or not v_promotion.active
    or v_promotion.starts_at > now()
    or (v_promotion.ends_at is not null and v_promotion.ends_at <= now()) then
    raise exception 'promotion is not active';
  end if;

  select count(*) into v_redeemed
  from public.promotion_redemptions
  where promotion_id = p_promotion_id and released_at is null;

  select count(*) into v_reserved
  from public.promotion_reservations
  where promotion_id = p_promotion_id
    and status = 'active'
    and expires_at > now();

  if v_promotion.usage_limit is not null
    and greatest(v_redeemed, v_promotion.used_count) + v_reserved >= v_promotion.usage_limit then
    raise exception 'promotion usage limit reached';
  end if;

  select count(*) into v_customer_redeemed
  from public.promotion_redemptions
  where promotion_id = p_promotion_id
    and customer_id = p_customer_id
    and released_at is null;

  select count(*) into v_customer_reserved
  from public.promotion_reservations
  where promotion_id = p_promotion_id
    and customer_id = p_customer_id
    and status = 'active'
    and expires_at > now();

  if v_customer_redeemed + v_customer_reserved >= v_promotion.per_customer_limit then
    raise exception 'promotion customer limit reached';
  end if;

  insert into public.promotion_reservations(
    promotion_id, customer_id, client_request_id, status, expires_at
  ) values (
    p_promotion_id,
    p_customer_id,
    p_client_request_id,
    'active',
    now() + make_interval(mins => v_ttl)
  )
  on conflict (customer_id, client_request_id) do update
  set promotion_id = excluded.promotion_id,
      order_id = null,
      status = 'active',
      expires_at = excluded.expires_at,
      consumed_at = null,
      released_at = null,
      updated_at = now()
  returning * into v_reservation;

  return jsonb_build_object(
    'status', 'active',
    'reservationId', v_reservation.id,
    'expiresAt', v_reservation.expires_at
  );
end;
$$;

create or replace function public.attach_order_promotion_reservation(
  p_customer_id uuid,
  p_client_request_id uuid,
  p_order_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  update public.promotion_reservations
  set order_id = p_order_id, updated_at = now()
  where customer_id = p_customer_id
    and client_request_id = p_client_request_id
    and (
      status = 'consumed'
      or (status = 'active' and expires_at > now())
    )
    and (order_id is null or order_id = p_order_id)
    and exists (
      select 1
      from public.kaspi_orders
      where id = p_order_id
        and customer_id = p_customer_id
        and client_request_id = p_client_request_id
    );
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.release_order_promotion_reservation(
  p_order_id uuid,
  p_customer_id uuid default null,
  p_client_request_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  update public.promotion_reservations
  set status = 'released', released_at = now(), updated_at = now()
  where status = 'active'
    and (
      (p_order_id is not null and order_id = p_order_id)
      or (
        p_order_id is null
        and customer_id = p_customer_id
        and client_request_id = p_client_request_id
      )
    );
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.consume_order_promotion_reservation(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.kaspi_orders%rowtype;
  v_promotion public.targeted_promotions%rowtype;
  v_reservation public.promotion_reservations%rowtype;
  v_redeemed bigint := 0;
  v_reserved bigint := 0;
  v_customer_redeemed bigint := 0;
  v_customer_reserved bigint := 0;
  v_inserted integer := 0;
begin
  select * into v_order
  from public.kaspi_orders
  where id = p_order_id
  for update;

  if v_order.id is null or v_order.customer_id is null
    or nullif(btrim(v_order.promo_code), '') is null then
    return jsonb_build_object('status', 'no_promotion');
  end if;

  select * into v_promotion
  from public.targeted_promotions
  where upper(code) = upper(v_order.promo_code);
  if v_promotion.id is null then
    return jsonb_build_object('status', 'promotion_missing');
  end if;

  perform pg_advisory_xact_lock(hashtext('promotion-capacity:' || v_promotion.id::text));

  select * into v_promotion
  from public.targeted_promotions promotion
  where promotion.id = v_promotion.id
  for update;
  if v_promotion.id is null then
    return jsonb_build_object('status', 'promotion_missing');
  end if;

  select * into v_reservation
  from public.promotion_reservations
  where order_id = v_order.id
  for update;

  if v_reservation.id is not null and v_reservation.status = 'consumed' then
    return jsonb_build_object('status', 'already_consumed', 'reservationId', v_reservation.id);
  end if;

  update public.promotion_reservations
  set status = 'expired', updated_at = now()
  where promotion_id = v_promotion.id
    and status = 'active'
    and expires_at <= now();

  if v_reservation.id is null or v_reservation.status <> 'active'
    or v_reservation.expires_at <= now() then
    if not v_promotion.active
      or v_promotion.starts_at > now()
      or (v_promotion.ends_at is not null and v_promotion.ends_at <= now()) then
      return jsonb_build_object('status', 'unavailable', 'reason', 'promotion_inactive');
    end if;

    select count(*) into v_redeemed
    from public.promotion_redemptions
    where promotion_id = v_promotion.id and released_at is null;

    select count(*) into v_reserved
    from public.promotion_reservations
    where promotion_id = v_promotion.id
      and status = 'active'
      and expires_at > now()
      and (v_reservation.id is null or id <> v_reservation.id);

    select count(*) into v_customer_redeemed
    from public.promotion_redemptions
    where promotion_id = v_promotion.id
      and customer_id = v_order.customer_id
      and released_at is null;

    select count(*) into v_customer_reserved
    from public.promotion_reservations
    where promotion_id = v_promotion.id
      and customer_id = v_order.customer_id
      and status = 'active'
      and expires_at > now()
      and (v_reservation.id is null or id <> v_reservation.id);

    if (v_promotion.usage_limit is not null
        and greatest(v_redeemed, v_promotion.used_count) + v_reserved >= v_promotion.usage_limit)
      or (v_customer_redeemed + v_customer_reserved >= v_promotion.per_customer_limit) then
      return jsonb_build_object('status', 'unavailable', 'reason', 'promotion_limit');
    end if;

    if v_reservation.id is not null then
      update public.promotion_reservations
      set status = 'active', expires_at = now() + interval '5 minutes', updated_at = now()
      where id = v_reservation.id
      returning * into v_reservation;
    else
      insert into public.promotion_reservations(
        promotion_id, customer_id, client_request_id, order_id, status, expires_at
      ) values (
        v_promotion.id,
        v_order.customer_id,
        v_order.client_request_id,
        v_order.id,
        'active',
        now() + interval '5 minutes'
      )
      returning * into v_reservation;
    end if;
  end if;

  insert into public.promotion_redemptions(
    promotion_id, customer_id, order_id, discount_amount
  ) values (
    v_promotion.id,
    v_order.customer_id,
    v_order.id,
    coalesce(v_order.discount_amount, 0)
  )
  on conflict (promotion_id, order_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    update public.targeted_promotions
    set used_count = used_count + 1, updated_at = now()
    where id = v_promotion.id;
  end if;

  update public.promotion_reservations
  set status = 'consumed', consumed_at = coalesce(consumed_at, now()), updated_at = now()
  where id = v_reservation.id;

  return jsonb_build_object(
    'status', case when v_inserted > 0 then 'consumed' else 'already_consumed' end,
    'reservationId', v_reservation.id
  );
end;
$$;

create or replace function public.record_order_promotion_redemption(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.consume_order_promotion_reservation(p_order_id);
  return coalesce(v_result->>'status', '') in ('consumed', 'already_consumed', 'no_promotion');
end;
$$;

create or replace function public.redeem_referral_code(
  p_customer_id uuid,
  p_code text
)
returns public.referral_redemptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral public.referral_codes%rowtype;
  v_redemption public.referral_redemptions%rowtype;
begin
  select * into v_referral
  from public.referral_codes
  where upper(code) = upper(btrim(p_code))
  for update;

  if v_referral.id is null or not v_referral.active then
    raise exception 'referral not found';
  end if;
  if v_referral.customer_id = p_customer_id then raise exception 'own referral'; end if;
  if v_referral.expires_at is not null and v_referral.expires_at <= now() then
    raise exception 'referral expired';
  end if;
  if v_referral.max_uses is not null and v_referral.uses_count >= v_referral.max_uses then
    raise exception 'referral limit reached';
  end if;
  if exists (
    select 1 from public.kaspi_orders
    where customer_id = p_customer_id and status in ('paid', 'refunded')
  ) then
    raise exception 'referral requires first order';
  end if;

  insert into public.referral_redemptions(referral_code_id, referred_customer_id)
  values (v_referral.id, p_customer_id)
  returning * into v_redemption;
  return v_redemption;
exception
  when unique_violation then
    raise exception 'referral already redeemed';
end;
$$;

create or replace function public.qualify_referral_for_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.kaspi_orders%rowtype;
  v_redemption public.referral_redemptions%rowtype;
  v_referral public.referral_codes%rowtype;
  v_friend_reward numeric(12,2) := 0;
  v_owner_reward numeric(12,2) := 0;
  v_friend_order_key text;
  v_owner_order_key text;
  v_inserted integer := 0;
begin
  select * into v_order
  from public.kaspi_orders
  where id = p_order_id
  for update;
  if v_order.id is null or v_order.customer_id is null or v_order.status <> 'paid' then
    return jsonb_build_object('status', 'not_eligible');
  end if;

  select * into v_redemption
  from public.referral_redemptions
  where referred_customer_id = v_order.customer_id
  for update;
  if v_redemption.id is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_redemption.status = 'rewarded' then
    return jsonb_build_object('status', 'already_rewarded');
  end if;
  if v_redemption.status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled');
  end if;

  select * into v_referral
  from public.referral_codes
  where id = v_redemption.referral_code_id
  for update;
  if v_referral.id is null then raise exception 'referral code missing'; end if;
  if v_referral.max_uses is not null and v_referral.uses_count >= v_referral.max_uses then
    return jsonb_build_object('status', 'limit_reached');
  end if;

  -- Lock both balances in deterministic UUID order before applying either side.
  perform 1
  from public.customers
  where id in (v_order.customer_id, v_referral.customer_id)
  order by id
  for update;

  v_friend_reward := greatest(0, coalesce(v_referral.reward_friend, 0));
  v_owner_reward := greatest(0, coalesce(v_referral.reward_referrer, 0));
  v_friend_order_key := 'REFERRAL-' || v_redemption.id::text || ':friend';
  v_owner_order_key := 'REFERRAL-' || v_redemption.id::text || ':owner';

  if v_friend_reward > 0 and not exists (
    select 1 from public.transactions
    where customer_id = v_order.customer_id and order_id = v_friend_order_key
  ) then
    insert into public.transactions(customer_id, order_id, type, amount, description, branch_id)
    values (
      v_order.customer_id,
      v_friend_order_key,
      'deposit',
      v_friend_reward,
      'Бонус по приглашению',
      v_order.branch_id
    );
    update public.customers
    set balance = balance + v_friend_reward, updated_at = now()
    where id = v_order.customer_id;
  end if;

  if v_owner_reward > 0 and not exists (
    select 1 from public.transactions
    where customer_id = v_referral.customer_id and order_id = v_owner_order_key
  ) then
    insert into public.transactions(customer_id, order_id, type, amount, description, branch_id)
    values (
      v_referral.customer_id,
      v_owner_order_key,
      'deposit',
      v_owner_reward,
      'Друг совершил первый заказ',
      v_order.branch_id
    );
    update public.customers
    set balance = balance + v_owner_reward, updated_at = now()
    where id = v_referral.customer_id;
  end if;

  update public.referral_redemptions
  set status = 'rewarded', order_id = v_order.id, rewarded_at = coalesce(rewarded_at, now())
  where id = v_redemption.id and status <> 'rewarded';
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    update public.referral_codes
    set uses_count = uses_count + 1
    where id = v_referral.id;
  end if;

  return jsonb_build_object(
    'status', 'rewarded',
    'friendCustomerId', v_order.customer_id,
    'ownerCustomerId', v_referral.customer_id,
    'friendReward', v_friend_reward,
    'ownerReward', v_owner_reward
  );
end;
$$;

revoke all on function public.reserve_order_promotion(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.attach_order_promotion_reservation(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.release_order_promotion_reservation(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.consume_order_promotion_reservation(uuid)
  from public, anon, authenticated;
revoke all on function public.record_order_promotion_redemption(uuid)
  from public, anon, authenticated;
revoke all on function public.redeem_referral_code(uuid, text)
  from public, anon, authenticated;
revoke all on function public.qualify_referral_for_order(uuid)
  from public, anon, authenticated;

grant execute on function public.reserve_order_promotion(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.attach_order_promotion_reservation(uuid, uuid, uuid)
  to service_role;
grant execute on function public.release_order_promotion_reservation(uuid, uuid, uuid)
  to service_role;
grant execute on function public.consume_order_promotion_reservation(uuid)
  to service_role;
grant execute on function public.record_order_promotion_redemption(uuid)
  to service_role;
grant execute on function public.redeem_referral_code(uuid, text)
  to service_role;
grant execute on function public.qualify_referral_for_order(uuid)
  to service_role;

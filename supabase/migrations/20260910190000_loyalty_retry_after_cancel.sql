-- Preserve cancelled attempts and their audit; never reactivate an old reservation ID.
alter table public.loyalty_reservations add column original_order_id varchar(200);

create or replace function public.reserve_loyalty_balance(
  p_customer_id uuid,
  p_order_id text,
  p_order_total numeric,
  p_discount_amount numeric,
  p_max_discount_percent numeric,
  p_ttl_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.loyalty_reservations%rowtype;
  v_balance numeric;
  v_other_reserved numeric;
  v_available numeric;
  v_max_discount numeric;
  v_duplicate boolean := false;
begin
  if p_customer_id is null
    or length(btrim(coalesce(p_order_id, ''))) < 1
    or length(p_order_id) > 200
    or coalesce(p_order_total, -1) < 0
    or coalesce(p_discount_amount, -1) < 0
    or p_discount_amount > p_order_total
    or coalesce(p_max_discount_percent, -1) < 0
    or p_max_discount_percent > 100
    or p_ttl_hours < 1
    or p_ttl_hours > 72 then
    raise exception 'invalid loyalty reservation values';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select balance into v_balance
  from public.customers
  where id = p_customer_id
  for update;
  if not found then raise exception 'customer not found'; end if;

  update public.loyalty_reservations
  set status = 'expired', updated_at = now()
  where customer_id = p_customer_id and status = 'active' and expires_at <= now();

  select * into v_reservation
  from public.loyalty_reservations
  where order_id = p_order_id
  for update;

  if found and v_reservation.status = 'active' and v_reservation.expires_at <= now() then
    update public.loyalty_reservations
    set status = 'expired', updated_at = now()
    where id = v_reservation.id
    returning * into v_reservation;
  end if;

  if found then
    if v_reservation.status = 'committed' then
      if v_reservation.customer_id <> p_customer_id then
        raise exception 'order_id already belongs to another customer';
      end if;
      if abs(v_reservation.order_total - p_order_total) > 0.001
        or abs(v_reservation.discount_amount - p_discount_amount) > 0.001 then
        raise exception 'committed reservation values do not match';
      end if;
      select coalesce(sum(discount_amount), 0) into v_other_reserved
      from public.loyalty_reservations
      where customer_id = p_customer_id
        and status = 'active'
        and expires_at > now();
      return jsonb_build_object(
        'reservation_id', v_reservation.id,
        'order_id', v_reservation.order_id,
        'customer_id', v_reservation.customer_id,
        'discount_amount', v_reservation.discount_amount,
        'available_balance', greatest(0, v_balance - v_other_reserved),
        'max_discount_percent', p_max_discount_percent,
        'expires_at', v_reservation.expires_at,
        'duplicate', true
      );
    end if;
    if v_reservation.status = 'active'
      and v_reservation.customer_id <> p_customer_id then
      raise exception 'order_id already belongs to another customer';
    end if;
  end if;

  -- A new attempt needs its own ID. Late cancel/commit retries keep referring
  -- to the old reservation and cannot cancel or spend the new one.
  if v_reservation.id is not null and v_reservation.status in ('cancelled','expired') then
    update public.loyalty_reservations
      set original_order_id=coalesce(original_order_id,order_id),
          order_id='archived:' || id::text, updated_at=now()
      where id=v_reservation.id;
    v_reservation := null;
  end if;

  select coalesce(sum(discount_amount), 0) into v_other_reserved
  from public.loyalty_reservations
  where customer_id = p_customer_id
    and status = 'active'
    and expires_at > now()
    and order_id <> p_order_id;

  v_available := greatest(0, v_balance - v_other_reserved);
  v_max_discount := least(
    v_available,
    p_order_total,
    p_order_total * p_max_discount_percent / 100
  );
  if p_discount_amount > v_max_discount + 0.001 then
    raise exception 'discount exceeds available reserved balance';
  end if;

  if v_reservation.id is null then
    insert into public.loyalty_reservations (
      customer_id, order_id, order_total, discount_amount, status, expires_at
    ) values (
      p_customer_id, p_order_id, p_order_total, p_discount_amount,
      'active', now() + make_interval(hours => p_ttl_hours)
    ) returning * into v_reservation;
  else
    v_duplicate :=
      v_reservation.status = 'active'
      and abs(v_reservation.order_total - p_order_total) <= 0.001
      and abs(v_reservation.discount_amount - p_discount_amount) <= 0.001;
    update public.loyalty_reservations set
      customer_id = p_customer_id,
      order_total = p_order_total,
      discount_amount = p_discount_amount,
      status = 'active',
      expires_at = now() + make_interval(hours => p_ttl_hours),
      committed_at = null,
      cancelled_at = null,
      updated_at = now()
    where id = v_reservation.id
    returning * into v_reservation;
  end if;

  return jsonb_build_object(
    'reservation_id', v_reservation.id,
    'order_id', v_reservation.order_id,
    'customer_id', v_reservation.customer_id,
    'discount_amount', v_reservation.discount_amount,
    'available_balance', greatest(0, v_available - v_reservation.discount_amount),
    'max_discount_percent', p_max_discount_percent,
    'expires_at', v_reservation.expires_at,
    'duplicate', v_duplicate
  );
end;
$$;

create or replace function public.cancel_loyalty_reservation(
  p_customer_id uuid,
  p_order_id text,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.loyalty_reservations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select * into v_reservation
  from public.loyalty_reservations
  where id = p_reservation_id and customer_id = p_customer_id
    and (order_id = p_order_id or (status in ('cancelled','expired') and original_order_id = p_order_id))
  for update;
  if not found then raise exception 'reservation not found'; end if;
  if v_reservation.status = 'committed' then raise exception 'reservation already committed'; end if;
  if v_reservation.status in ('cancelled', 'expired') then
    return jsonb_build_object('duplicate', true, 'status', v_reservation.status);
  end if;
  update public.loyalty_reservations set
    status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = v_reservation.id;
  return jsonb_build_object('duplicate', false, 'status', 'cancelled');
end;
$$;

create or replace function public.reserve_branch_loyalty_balance(
  p_branch_id uuid,
  p_customer_id uuid,
  p_order_id text,
  p_order_total numeric,
  p_discount_amount numeric,
  p_max_discount_percent numeric,
  p_ttl_hours integer,
  p_max_order_total numeric,
  p_max_discount_amount numeric,
  p_rolling_order_count integer,
  p_rolling_order_total numeric,
  p_rolling_discount_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_reservation_id uuid;
  v_reservation_status text;
  v_reservation_committed_at timestamptz;
  v_reservation_branch_id uuid;
  v_usage public.branch_pos_loyalty_usage%rowtype;
  v_order_count integer;
  v_order_total numeric;
  v_discount_amount numeric;
begin
  if p_branch_id is null
    or p_customer_id is null
    or position('bp1:' || p_branch_id::text || ':' in coalesce(p_order_id, '')) <> 1
    or coalesce(p_order_total, -1) < 0
    or coalesce(p_discount_amount, -1) < 0
    or p_discount_amount > p_order_total
    or coalesce(p_max_order_total, 0) < 500
    or p_max_order_total > 100000000
    or coalesce(p_max_discount_amount, 0) < 1
    or p_max_discount_amount > p_max_order_total
    or coalesce(p_rolling_order_count, 0) < 1
    or p_rolling_order_count > 100000
    or coalesce(p_rolling_order_total, 0) < p_max_order_total
    or p_rolling_order_total > 100000000
    or coalesce(p_rolling_discount_amount, 0) < p_max_discount_amount
    or p_rolling_discount_amount > 100000000 then
    raise exception 'invalid branch loyalty safety limits';
  end if;
  if p_order_total > p_max_order_total
    or p_discount_amount > p_max_discount_amount then
    raise exception 'branch loyalty transaction limit exceeded';
  end if;
  if not exists (
    select 1 from public.bulka_locations
    where id = p_branch_id and active = true
  ) then
    raise exception 'branch loyalty claim conflict';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('branch-pos-loyalty:' || p_branch_id::text, 0)
  );
  v_result := public.reserve_loyalty_balance(
    p_customer_id,
    p_order_id,
    p_order_total,
    p_discount_amount,
    p_max_discount_percent,
    p_ttl_hours
  );
  v_reservation_id := (v_result->>'reservation_id')::uuid;
  select status, committed_at, pos_branch_id
    into v_reservation_status, v_reservation_committed_at, v_reservation_branch_id
  from public.loyalty_reservations
  where id = v_reservation_id;
  if v_reservation_branch_id is not null
    and v_reservation_branch_id <> p_branch_id then
    raise exception 'branch loyalty claim conflict';
  end if;
  update public.loyalty_reservations
  set pos_branch_id = p_branch_id, updated_at = now()
  where id = v_reservation_id;

  select * into v_usage
  from public.branch_pos_loyalty_usage
  where reservation_id = v_reservation_id
  for update;
  if found and (
    v_usage.branch_id <> p_branch_id
    or v_usage.customer_id <> p_customer_id
    or v_usage.order_id <> p_order_id
  ) then
    raise exception 'branch loyalty claim conflict';
  end if;

  if v_reservation_status = 'committed' then
    insert into public.branch_pos_loyalty_usage(
      reservation_id, branch_id, customer_id, order_id, order_total,
      discount_amount, status, claimed_at, committed_at
    ) values (
      v_reservation_id, p_branch_id, p_customer_id, p_order_id, p_order_total,
      p_discount_amount, 'committed',
      coalesce(v_reservation_committed_at, now()), v_reservation_committed_at
    ) on conflict (reservation_id) do nothing;
    return v_result;
  end if;
  if v_usage.reservation_id is not null
    and v_usage.status = 'active'
    and v_usage.claimed_at >= now() - interval '24 hours'
    and abs(v_usage.order_total - p_order_total) <= 0.001
    and abs(v_usage.discount_amount - p_discount_amount) <= 0.001 then
    return v_result;
  end if;

  select count(*), coalesce(sum(u.order_total), 0), coalesce(sum(u.discount_amount), 0)
    into v_order_count, v_order_total, v_discount_amount
  from public.branch_pos_loyalty_usage u
  join public.loyalty_reservations r on r.id = u.reservation_id
  where u.branch_id = p_branch_id
    and u.reservation_id <> v_reservation_id
    and u.claimed_at >= now() - interval '24 hours'
    and (
      r.status = 'committed'
      or (r.status = 'active' and r.expires_at > now())
    );
  if v_order_count + 1 > p_rolling_order_count
    or v_order_total + p_order_total > p_rolling_order_total
    or v_discount_amount + p_discount_amount > p_rolling_discount_amount then
    raise exception 'branch loyalty rolling limit exceeded';
  end if;

  insert into public.branch_pos_loyalty_usage(
    reservation_id, branch_id, customer_id, order_id, order_total,
    discount_amount, status, claimed_at, committed_at, updated_at
  ) values (
    v_reservation_id, p_branch_id, p_customer_id, p_order_id, p_order_total,
    p_discount_amount, 'active', now(), null, now()
  ) on conflict (reservation_id) do update set
    order_total = excluded.order_total,
    discount_amount = excluded.discount_amount,
    status = 'active',
    claimed_at = now(),
    committed_at = null,
    updated_at = now();
  return v_result;
end;
$$;


-- Different pickup times inside one configured interval share its capacity.
alter table public.fulfillment_slot_reservations
  add column if not exists timezone_offset_minutes integer not null default 300
  check (timezone_offset_minutes between -840 and 840);

create or replace function public.fulfillment_slot_bounds(
  p_at timestamptz, p_minutes integer, p_offset integer default 300
) returns tstzrange language sql immutable set search_path = public as $$
  with local_time as (
    select (p_at at time zone 'UTC') + make_interval(mins => p_offset) as at,
      case when p_minutes between 15 and 240 then p_minutes else 60 end as minutes
  ), bucket as (
    select date_trunc('day', at) + make_interval(mins =>
      floor((extract(hour from at) * 60 + extract(minute from at)) / minutes)::integer * minutes
    ) as start_at, date_trunc('day', at) + interval '1 day' as day_end, minutes from local_time
  )
  select tstzrange(
    (start_at - make_interval(mins => p_offset)) at time zone 'UTC',
    (least(start_at + make_interval(mins => minutes), day_end) - make_interval(mins => p_offset)) at time zone 'UTC', '[)'
  ) from bucket;
$$;

create or replace function public.guard_fulfillment_slot_capacity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  location_row public.bulka_locations%rowtype;
  bounds tstzrange;
  capacity_value integer;
  held integer;
begin
  if new.status not in ('active', 'committed')
    or (new.status = 'active' and new.expires_at <= now()) then return new; end if;
  -- Preserve an existing live reservation when its payment completes.
  if tg_op = 'UPDATE' and old.status in ('active', 'committed')
    and (old.status = 'committed' or old.expires_at > now())
    and old.branch_id = new.branch_id and old.fulfillment_type = new.fulfillment_type
    and old.scheduled_at = new.scheduled_at
    and old.timezone_offset_minutes = new.timezone_offset_minutes then return new; end if;
  select * into location_row from public.bulka_locations where id = new.branch_id for update;
  if not found then raise exception 'Филиал больше недоступен'; end if;
  capacity_value := greatest(1, coalesce(case new.fulfillment_type
    when 'preorder' then location_row.preorder_slot_capacity
    when 'delivery' then location_row.delivery_slot_capacity
    else location_row.pickup_slot_capacity end, 1));
  bounds := public.fulfillment_slot_bounds(new.scheduled_at, location_row.slot_minutes, new.timezone_offset_minutes);
  select count(*) into held from public.fulfillment_slot_reservations
  where branch_id = new.branch_id and fulfillment_type = new.fulfillment_type
    and scheduled_at <@ bounds and id is distinct from new.id
    and (status = 'committed' or (status = 'active' and expires_at > now()));
  if held >= capacity_value then
    raise exception 'Это время уже занято. Выберите другой слот' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillment_slot_capacity_guard on public.fulfillment_slot_reservations;
create trigger fulfillment_slot_capacity_guard
before insert or update of status, scheduled_at, branch_id, fulfillment_type, timezone_offset_minutes
on public.fulfillment_slot_reservations for each row execute function public.guard_fulfillment_slot_capacity();
revoke all on function public.fulfillment_slot_bounds(timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.guard_fulfillment_slot_capacity() from public, anon, authenticated;
grant execute on function public.fulfillment_slot_bounds(timestamptz, integer, integer) to service_role;

create or replace function public.reserve_fulfillment_slot_v2(
  p_customer_id uuid,
  p_request_id uuid,
  p_branch_id uuid,
  p_fulfillment_type varchar,
  p_scheduled_at timestamptz,
  p_ttl_minutes integer default 20,
  p_expires_at timestamptz default null,
  p_timezone_offset_minutes integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  location_row public.bulka_locations%rowtype;
  existing_row public.fulfillment_slot_reservations%rowtype;
  capacity_value integer;
  held integer;
  expires_at_value timestamptz;
begin
  if p_fulfillment_type not in ('pickup', 'delivery', 'preorder') then
    raise exception 'Некорректный способ получения заказа' using errcode = '22023';
  end if;
  if p_scheduled_at is null then
    raise exception 'Выберите время заказа' using errcode = '22023';
  end if;

  if p_expires_at is not null then
    if p_expires_at <= now() then
      raise exception 'Срок оплаты уже истёк' using errcode = '22023';
    end if;
    if p_expires_at > now() + interval '24 hours 5 minutes' then
      raise exception 'Срок оплаты превышает допустимый срок резерва' using errcode = '22023';
    end if;
    expires_at_value := p_expires_at;
  else
    expires_at_value := now() + make_interval(
      mins => greatest(5, least(coalesce(p_ttl_minutes, 20), 1445))
    );
  end if;

  select *
  into location_row
  from public.bulka_locations
  where id = p_branch_id and active = true
  for update;
  if not found then
    raise exception 'Филиал больше недоступен' using errcode = 'P0001';
  end if;

  capacity_value := greatest(
    coalesce(
      case p_fulfillment_type
        when 'preorder' then location_row.preorder_slot_capacity
        when 'delivery' then location_row.delivery_slot_capacity
        else location_row.pickup_slot_capacity
      end,
      1
    ),
    1
  );

  update public.fulfillment_slot_reservations
  set status = 'expired', updated_at = now()
  where status = 'active' and expires_at <= now();

  select *
  into existing_row
  from public.fulfillment_slot_reservations
  where client_request_id = p_request_id
  for update;
  if found then
    if existing_row.customer_id <> p_customer_id then
      raise exception 'Конфликт идентификатора оформления' using errcode = 'P0001';
    end if;
    if existing_row.branch_id <> p_branch_id
      or existing_row.fulfillment_type <> p_fulfillment_type
      or existing_row.scheduled_at is distinct from p_scheduled_at then
      raise exception 'Параметры этого оформления уже были зарезервированы'
        using errcode = 'P0001';
    end if;
    if existing_row.status = 'committed' then
      return jsonb_build_object(
        'status', 'already_committed',
        'capacity', capacity_value,
        'remaining', greatest(capacity_value - 1, 0),
        'expiresAt', existing_row.expires_at
      );
    end if;
  end if;

  select count(*)::integer
  into held
  from public.fulfillment_slot_reservations
  where branch_id = p_branch_id
    and fulfillment_type = p_fulfillment_type
    and scheduled_at <@ public.fulfillment_slot_bounds(p_scheduled_at, location_row.slot_minutes, p_timezone_offset_minutes)
    and (
      status = 'committed'
      or (status = 'active' and expires_at > now())
    )
    and client_request_id <> p_request_id;

  if held >= capacity_value then
    raise exception 'Это время уже занято. Выберите другой слот' using errcode = 'P0001';
  end if;

  if existing_row.id is not null then
    update public.fulfillment_slot_reservations
    set
      status = 'active',
      expires_at = greatest(expires_at, expires_at_value),
      updated_at = now()
    where id = existing_row.id;
  else
    insert into public.fulfillment_slot_reservations (
      customer_id,
      client_request_id,
      branch_id,
      fulfillment_type,
      scheduled_at,
      timezone_offset_minutes,
      status,
      expires_at,
      updated_at
    ) values (
      p_customer_id,
      p_request_id,
      p_branch_id,
      p_fulfillment_type,
      p_scheduled_at,
      p_timezone_offset_minutes,
      'active',
      expires_at_value,
      now()
    );
  end if;

  return jsonb_build_object(
    'status', 'reserved',
    'capacity', capacity_value,
    'remaining', greatest(capacity_value - held - 1, 0),
    'expiresAt', expires_at_value
  );
end;
$$;


revoke all on function public.reserve_fulfillment_slot_v2(uuid, uuid, uuid, varchar, timestamptz, integer, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reserve_fulfillment_slot_v2(uuid, uuid, uuid, varchar, timestamptz, integer, timestamptz, integer) to service_role;

-- The previous API remains callable during rollout and rollback.
create or replace function public.reserve_fulfillment_slot(
  p_customer_id uuid, p_request_id uuid, p_branch_id uuid,
  p_fulfillment_type varchar, p_scheduled_at timestamptz,
  p_ttl_minutes integer default 20, p_expires_at timestamptz default null
) returns jsonb language sql security definer set search_path = public as $$
  select public.reserve_fulfillment_slot_v2(p_customer_id, p_request_id, p_branch_id,
    p_fulfillment_type, p_scheduled_at, p_ttl_minutes, p_expires_at, 300);
$$;
revoke all on function public.reserve_fulfillment_slot(uuid, uuid, uuid, varchar, timestamptz, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_fulfillment_slot(uuid, uuid, uuid, varchar, timestamptz, integer, timestamptz) to service_role;
notify pgrst, 'reload schema';

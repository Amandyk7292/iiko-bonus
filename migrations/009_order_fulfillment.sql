-- Durable pickup, delivery and preorder metadata.

alter table public.customers
  add column if not exists preferred_language varchar(2) not null default 'ru';
alter table public.customers
  drop constraint if exists customers_preferred_language_check;
alter table public.customers
  add constraint customers_preferred_language_check
  check (preferred_language in ('ru', 'kk', 'en'));

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
  return jsonb_build_object('status', 'success');
end;
$$;

revoke all on function public.consume_whatsapp_otp(text, text) from public, anon, authenticated;
grant execute on function public.consume_whatsapp_otp(text, text) to service_role;

create table if not exists public.bulka_locations (
  id uuid primary key default gen_random_uuid(),
  city varchar(100) not null,
  name varchar(160) not null,
  address varchar(300) not null,
  created_at timestamptz not null default now()
);

alter table public.bulka_locations add column if not exists two_gis_id varchar(32);
alter table public.bulka_locations add column if not exists latitude numeric(10, 7);
alter table public.bulka_locations add column if not exists longitude numeric(10, 7);
alter table public.bulka_locations add column if not exists hours jsonb not null default '{}'::jsonb;
alter table public.bulka_locations add column if not exists active boolean not null default true;
alter table public.bulka_locations
  add column if not exists pickup_enabled boolean not null default true;
alter table public.bulka_locations
  add column if not exists preorder_enabled boolean not null default true;
alter table public.bulka_locations
  add column if not exists delivery_enabled boolean not null default false;
alter table public.bulka_locations add column if not exists delivery_radius_km numeric(8, 2);
alter table public.bulka_locations add column if not exists delivery_fee numeric(12, 2);
alter table public.bulka_locations add column if not exists delivery_min_order numeric(12, 2);
alter table public.bulka_locations add column if not exists sort_order integer not null default 0;
alter table public.bulka_locations
  add column if not exists updated_at timestamptz not null default now();

delete from public.bulka_locations
where id = 'ca99b62c-50ce-4c60-b36c-649bba035441'::uuid
  and city = 'Актау'
  and name = 'тест'
  and address = 'Актау';

create unique index if not exists bulka_locations_two_gis_id_unique_idx
  on public.bulka_locations(two_gis_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bulka_locations_coordinates_check'
      and conrelid = 'public.bulka_locations'::regclass
  ) then
    alter table public.bulka_locations
      add constraint bulka_locations_coordinates_check
      check (
        (latitude is null and longitude is null)
        or (latitude between -90 and 90 and longitude between -180 and 180)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'bulka_locations_delivery_rules_check'
      and conrelid = 'public.bulka_locations'::regclass
  ) then
    alter table public.bulka_locations
      add constraint bulka_locations_delivery_rules_check
      check (
        delivery_enabled = false
        or (
          latitude is not null
          and longitude is not null
          and delivery_radius_km > 0
          and delivery_fee >= 0
          and delivery_min_order >= 0
        )
      );
  end if;
end
$$;

insert into public.bulka_locations (
  id,
  two_gis_id,
  city,
  name,
  address,
  latitude,
  longitude,
  hours,
  sort_order
)
values
  ('48f71218-aa08-51bf-a6d9-2497c4a1e55b', '70000001037780404', 'Актау', 'ЖК Дукат', '17-й микрорайон, 1', 43.669440, 51.136929, '{"daily":{"open":"08:00","close":"24:00"}}', 10),
  ('a18ea0f1-ac22-5530-a56a-65d810181a12', '70000001059727546', 'Актау', 'ЖК Ақеспе', '17-й микрорайон, 95', 43.671533, 51.147920, '{"daily":{"open":"08:00","close":"21:00"}}', 20),
  ('dc180678-d414-54bd-a077-959e72b7afe5', '70000001094869111', 'Актау', 'ТД Promenade', '28-й микрорайон, 59/3', 43.673225, 51.164858, '{"daily":{"open":"08:00","close":"21:00"}}', 30),
  ('48a835eb-b78d-548e-a450-7789189d5785', '70000001095138965', 'Актау', '19-й микрорайон', '19-й микрорайон, 33/1', 43.679557, 51.153351, '{"daily":{"open":"08:00","close":"21:00"}}', 40),
  ('cb2b13f5-6c4e-5592-adc7-8908bacddabd', '70000001084017190', 'Актау', 'ЖК B-Group Plaza', '16-й микрорайон, 85', 43.674274, 51.153663, '{"daily":{"open":"08:00","close":"21:00"}}', 50),
  ('18ab2d90-7187-5b0b-a245-9c819a67a605', '70000001035248862', 'Актау', '5-й микрорайон', '5-й микрорайон, 20/20', 43.640354, 51.155575, '{"daily":{"open":"08:00","close":"21:00"}}', 60),
  ('7f073eb5-d112-5121-a132-68d8519b1188', '70000001105107971', 'Актау', 'ЖК Premium Plaza', '18A микрорайон, 1', 43.677412, 51.137680, '{"daily":{"open":"08:00","close":"21:00"}}', 70),
  ('b49c5f6f-e051-553f-aa7a-968fef73e62a', '70000001110611288', 'Актау', '26-й микрорайон', '26-й микрорайон, 19/3', 43.662499, 51.164725, '{"daily":{"open":"08:00","close":"21:00"}}', 80),
  ('dcd47584-8559-574d-a223-467ce30069e6', '70000001047301817', 'Актау', 'ТЦ Ardager', '9-й микрорайон, 30/3', 43.647952, 51.155753, '{"daily":{"open":"09:00","close":"21:00"}}', 90),
  ('ea829279-4b48-5e9f-a763-e8ef06a53e57', '70000001110611275', 'Актау', 'ЖК Central Park', '40-й микрорайон, 2', 43.687678, 51.148924, '{"daily":{"open":"08:00","close":"21:00"}}', 100),
  ('07788c1e-8ef0-5f24-ae46-0cbb9109e3eb', '70000001084017199', 'Актау', 'ЖК Green Plaza', '17-й микрорайон, 6', 43.674585, 51.136410, '{"daily":{"open":"08:00","close":"21:00"}}', 110),
  ('92a71bf8-74b2-56a6-ae83-6d08f030ae6d', '70000001115593449', 'Актау', 'ЖК Комфорт', '17-й микрорайон, 55', 43.669455, 51.146964, '{"daily":{"open":"08:00","close":"21:00"}}', 120)
on conflict (two_gis_id) do update set
  city = excluded.city,
  name = excluded.name,
  address = excluded.address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  hours = excluded.hours,
  sort_order = excluded.sort_order,
  updated_at = now();

delete from public.points point
using public.cities city
where point.city_id = city.id
  and city.name = 'Актау'
  and point.name = 'Ардагер'
  and point.address = '11 мкр'
  and point.latitude is null
  and point.longitude is null;

delete from public.cities city
where city.name = 'Астана'
  and not exists (select 1 from public.points point where point.city_id = city.id);

create index if not exists bulka_locations_active_sort_idx
  on public.bulka_locations(active, sort_order, name);
alter table public.bulka_locations enable row level security;
drop policy if exists "service role manages bulka locations" on public.bulka_locations;
create policy "service role manages bulka locations"
  on public.bulka_locations for all to service_role using (true) with check (true);
revoke all on public.bulka_locations from public, anon, authenticated;
grant all on public.bulka_locations to service_role;

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label varchar(120),
  address varchar(500) not null,
  city varchar(100) not null,
  latitude numeric(10, 7) not null,
  longitude numeric(10, 7) not null,
  entrance varchar(30),
  floor varchar(20),
  apartment varchar(30),
  comment varchar(300),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_addresses_coordinates_check check (
    latitude between -90 and 90 and longitude between -180 and 180
  )
);

create index if not exists customer_addresses_customer_idx
  on public.customer_addresses(customer_id, created_at desc);
create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses(customer_id)
  where is_default;
alter table public.customer_addresses enable row level security;
drop policy if exists "service role manages customer addresses" on public.customer_addresses;
create policy "service role manages customer addresses"
  on public.customer_addresses for all to service_role using (true) with check (true);
revoke all on public.customer_addresses from public, anon, authenticated;
grant all on public.customer_addresses to service_role;

create or replace function public.save_customer_address(
  p_customer_id uuid,
  p_address_id uuid,
  p_label varchar,
  p_address varchar,
  p_city varchar,
  p_latitude numeric,
  p_longitude numeric,
  p_entrance varchar,
  p_floor varchar,
  p_apartment varchar,
  p_comment varchar,
  p_is_default boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_address public.customer_addresses%rowtype;
  v_make_default boolean;
  v_count integer;
begin
  if p_customer_id is null
    or length(btrim(coalesce(p_address, ''))) < 3
    or length(btrim(coalesce(p_city, ''))) < 1
    or p_latitude is null
    or p_longitude is null
    or p_latitude not between -90 and 90
    or p_longitude not between -180 and 180 then
    raise exception 'invalid customer address';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select count(*) into v_count
  from public.customer_addresses
  where customer_id = p_customer_id;

  if p_address_id is null then
    if v_count >= 10 then raise exception 'address limit reached'; end if;
    v_make_default := coalesce(p_is_default, false) or v_count = 0;
    if v_make_default then
      update public.customer_addresses
      set is_default = false, updated_at = now()
      where customer_id = p_customer_id and is_default;
    end if;
    insert into public.customer_addresses (
      customer_id, label, address, city, latitude, longitude,
      entrance, floor, apartment, comment, is_default
    ) values (
      p_customer_id, nullif(btrim(p_label), ''), btrim(p_address), btrim(p_city),
      p_latitude, p_longitude, nullif(btrim(p_entrance), ''),
      nullif(btrim(p_floor), ''), nullif(btrim(p_apartment), ''),
      nullif(btrim(p_comment), ''), v_make_default
    ) returning * into v_address;
  else
    select * into v_address
    from public.customer_addresses
    where id = p_address_id and customer_id = p_customer_id
    for update;
    if not found then raise exception 'address not found'; end if;
    v_make_default := coalesce(p_is_default, v_address.is_default);
    if v_make_default then
      update public.customer_addresses
      set is_default = false, updated_at = now()
      where customer_id = p_customer_id and id <> p_address_id and is_default;
    end if;
    update public.customer_addresses set
      label = nullif(btrim(p_label), ''),
      address = btrim(p_address),
      city = btrim(p_city),
      latitude = p_latitude,
      longitude = p_longitude,
      entrance = nullif(btrim(p_entrance), ''),
      floor = nullif(btrim(p_floor), ''),
      apartment = nullif(btrim(p_apartment), ''),
      comment = nullif(btrim(p_comment), ''),
      is_default = v_make_default,
      updated_at = now()
    where id = p_address_id and customer_id = p_customer_id
    returning * into v_address;
  end if;

  return to_jsonb(v_address);
end;
$$;

create or replace function public.set_customer_address_default(
  p_customer_id uuid,
  p_address_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_address public.customer_addresses%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  if not exists (
    select 1 from public.customer_addresses
    where id = p_address_id and customer_id = p_customer_id
  ) then
    raise exception 'address not found';
  end if;
  update public.customer_addresses
  set is_default = false, updated_at = now()
  where customer_id = p_customer_id and id <> p_address_id and is_default;
  update public.customer_addresses
  set is_default = true, updated_at = now()
  where id = p_address_id and customer_id = p_customer_id
  returning * into v_address;
  return to_jsonb(v_address);
end;
$$;

create or replace function public.delete_customer_address(
  p_customer_id uuid,
  p_address_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_default boolean;
  v_next_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select is_default into v_was_default
  from public.customer_addresses
  where id = p_address_id and customer_id = p_customer_id
  for update;
  if not found then raise exception 'address not found'; end if;
  delete from public.customer_addresses
  where id = p_address_id and customer_id = p_customer_id;
  if v_was_default then
    select id into v_next_id
    from public.customer_addresses
    where customer_id = p_customer_id
    order by updated_at desc, created_at desc
    limit 1;
    if v_next_id is not null then
      update public.customer_addresses
      set is_default = true, updated_at = now()
      where id = v_next_id;
    end if;
  end if;
  return true;
end;
$$;

revoke all on function public.save_customer_address(
  uuid, uuid, varchar, varchar, varchar, numeric, numeric,
  varchar, varchar, varchar, varchar, boolean
) from public, anon, authenticated;
revoke all on function public.set_customer_address_default(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_customer_address(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.save_customer_address(
  uuid, uuid, varchar, varchar, varchar, numeric, numeric,
  varchar, varchar, varchar, varchar, boolean
) to service_role;
grant execute on function public.set_customer_address_default(uuid, uuid) to service_role;
grant execute on function public.delete_customer_address(uuid, uuid) to service_role;

create table if not exists public.loyalty_reservations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_id varchar(200) not null unique,
  order_total numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null,
  status varchar(20) not null default 'active',
  expires_at timestamptz not null,
  committed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_reservations_amounts_check check (
    order_total >= 0
    and discount_amount >= 0
    and discount_amount <= order_total
  ),
  constraint loyalty_reservations_status_check check (
    status in ('active', 'committed', 'cancelled', 'expired')
  )
);

create index if not exists loyalty_reservations_customer_active_idx
  on public.loyalty_reservations(customer_id, expires_at)
  where status = 'active';
alter table public.loyalty_reservations enable row level security;
drop policy if exists "service role manages loyalty reservations" on public.loyalty_reservations;
create policy "service role manages loyalty reservations"
  on public.loyalty_reservations for all to service_role using (true) with check (true);
revoke all on public.loyalty_reservations from public, anon, authenticated;
grant all on public.loyalty_reservations to service_role;

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

create or replace function public.commit_loyalty_reservation(
  p_customer_id uuid,
  p_order_id text,
  p_reservation_id uuid,
  p_order_total numeric,
  p_earned_bonus numeric,
  p_activation_delay_days integer,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.loyalty_reservations%rowtype;
  v_result jsonb;
  v_balance numeric;
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select * into v_reservation
  from public.loyalty_reservations
  where id = p_reservation_id and order_id = p_order_id and customer_id = p_customer_id
  for update;
  if not found then raise exception 'reservation not found'; end if;

  if v_reservation.status = 'committed' then
    select balance into v_balance from public.customers where id = p_customer_id;
    return jsonb_build_object(
      'duplicate', true,
      'balance', v_balance,
      'discount_applied', 0,
      'earned_bonus', 0
    );
  end if;
  if v_reservation.status <> 'active' or v_reservation.expires_at <= now() then
    if v_reservation.status = 'active' then
      update public.loyalty_reservations
      set status = 'expired', updated_at = now()
      where id = v_reservation.id;
    end if;
    raise exception 'reservation is not active';
  end if;
  if coalesce(p_order_total, -1) < v_reservation.discount_amount
    or coalesce(p_earned_bonus, -1) < 0
    or coalesce(p_activation_delay_days, -1) < 0 then
    raise exception 'invalid loyalty commit values';
  end if;

  v_result := public.apply_loyalty_transaction(
    p_customer_id,
    p_order_id,
    v_reservation.discount_amount,
    p_earned_bonus,
    p_order_total,
    p_order_total - v_reservation.discount_amount,
    p_activation_delay_days,
    p_items
  );

  update public.loyalty_reservations set
    status = 'committed',
    order_total = p_order_total,
    committed_at = now(),
    updated_at = now()
  where id = v_reservation.id;

  return v_result || jsonb_build_object(
    'discount_applied', case when coalesce((v_result->>'duplicate')::boolean, false) then 0 else v_reservation.discount_amount end,
    'earned_bonus', case when coalesce((v_result->>'duplicate')::boolean, false) then 0 else p_earned_bonus end
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
  where id = p_reservation_id and order_id = p_order_id and customer_id = p_customer_id
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

revoke all on function public.reserve_loyalty_balance(uuid, text, numeric, numeric, numeric, integer)
  from public, anon, authenticated;
revoke all on function public.commit_loyalty_reservation(uuid, text, uuid, numeric, numeric, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.cancel_loyalty_reservation(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_loyalty_balance(uuid, text, numeric, numeric, numeric, integer)
  to service_role;
grant execute on function public.commit_loyalty_reservation(uuid, text, uuid, numeric, numeric, integer, jsonb)
  to service_role;
grant execute on function public.cancel_loyalty_reservation(uuid, text, uuid)
  to service_role;

alter table public.kaspi_orders
  add column if not exists fulfillment_type varchar(20) not null default 'pickup';
alter table public.kaspi_orders add column if not exists branch_id uuid;
alter table public.kaspi_orders add column if not exists scheduled_at timestamptz;
alter table public.kaspi_orders add column if not exists delivery_address jsonb;
alter table public.kaspi_orders add column if not exists delivery_latitude numeric(10, 7);
alter table public.kaspi_orders add column if not exists delivery_longitude numeric(10, 7);
alter table public.kaspi_orders
  add column if not exists delivery_fee numeric(12, 2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_branch_id_fkey'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_branch_id_fkey
      foreign key (branch_id) references public.bulka_locations(id) on delete set null;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_fulfillment_type_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_fulfillment_type_check
      check (fulfillment_type in ('pickup', 'delivery', 'preorder'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_delivery_fee_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_delivery_fee_check
      check (delivery_fee >= 0 and delivery_fee <= 100000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_delivery_coordinates_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_delivery_coordinates_check
      check (
        (delivery_latitude is null and delivery_longitude is null)
        or (
          delivery_latitude between -90 and 90
          and delivery_longitude between -180 and 180
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_delivery_metadata_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_delivery_metadata_check
      check (
        fulfillment_type <> 'delivery'
        or (
          delivery_address is not null
          and jsonb_typeof(delivery_address) = 'object'
          and delivery_latitude is not null
          and delivery_longitude is not null
        )
      );
  end if;
end
$$;

create index if not exists kaspi_orders_fulfillment_schedule_idx
  on public.kaspi_orders(fulfillment_type, scheduled_at, fulfillment_status)
  where status = 'paid';
create index if not exists kaspi_orders_branch_schedule_idx
  on public.kaspi_orders(branch_id, scheduled_at)
  where branch_id is not null and status = 'paid';

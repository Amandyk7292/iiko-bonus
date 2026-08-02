alter table public.customer_addresses
  add column if not exists house varchar(30);

drop function if exists public.save_customer_address(
  uuid, uuid, varchar, varchar, varchar, numeric, numeric,
  varchar, varchar, varchar, varchar, boolean
);

create or replace function public.save_customer_address(
  p_customer_id uuid,
  p_address_id uuid,
  p_label varchar,
  p_address varchar,
  p_city varchar,
  p_latitude numeric,
  p_longitude numeric,
  p_house varchar,
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
      customer_id, label, address, city, latitude, longitude, house,
      entrance, floor, apartment, comment, is_default
    ) values (
      p_customer_id, nullif(btrim(p_label), ''), btrim(p_address), btrim(p_city),
      p_latitude, p_longitude, nullif(btrim(p_house), ''),
      nullif(btrim(p_entrance), ''), nullif(btrim(p_floor), ''),
      nullif(btrim(p_apartment), ''), nullif(btrim(p_comment), ''),
      v_make_default
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
      house = nullif(btrim(p_house), ''),
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

revoke all on function public.save_customer_address(
  uuid, uuid, varchar, varchar, varchar, numeric, numeric,
  varchar, varchar, varchar, varchar, varchar, boolean
) from public, anon, authenticated;

grant execute on function public.save_customer_address(
  uuid, uuid, varchar, varchar, varchar, numeric, numeric,
  varchar, varchar, varchar, varchar, varchar, boolean
) to service_role;

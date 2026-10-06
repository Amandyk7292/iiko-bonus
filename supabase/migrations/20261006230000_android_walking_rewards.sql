begin;
-- Existing App Attest keys keep their type. Android installation identifiers
-- can never be substituted for Apple's attested public keys.
alter table public.walking_device_keys add column platform text not null default 'ios'
  check(platform in ('ios','android'));

-- A batch is one transaction: if any day fails, none of its balances, ledger
-- entries, counters or replay markers survive. Counts are native daily totals,
-- never additions to an earlier count.
create function public.apply_android_walking_steps(
  p_customer_id uuid,p_key_id text,p_previous_counter bigint,p_challenge_id uuid,p_measurements jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare k walking_device_keys%rowtype; measurement jsonb; counter bigint;
  results jsonb:='[]'::jsonb; result jsonb; day_challenge uuid;
begin
  if p_customer_id is null or p_key_id is null or p_previous_counter is null or p_previous_counter<0
    or p_previous_counter>9223372036854775800 or p_challenge_id is null
    or p_measurements is null or jsonb_typeof(p_measurements)<>'array'
    or jsonb_array_length(p_measurements) not between 1 and 7 then
    raise exception 'invalid Android walking proof' using errcode='22023';
  end if;
  for measurement in select value from jsonb_array_elements(p_measurements) loop
    if jsonb_typeof(measurement)<>'object' or
      (select count(*) from jsonb_object_keys(measurement))<>4 or
      not (measurement ?& array['date','steps','startAt','endAt']) or
      jsonb_typeof(measurement->'date')<>'string' or
      jsonb_typeof(measurement->'steps')<>'number' or
      (measurement->>'steps') !~ '^[0-9]+$' or
      jsonb_typeof(measurement->'startAt')<>'string' or
      jsonb_typeof(measurement->'endAt')<>'string' then
      raise exception 'invalid Android walking day' using errcode='22023';
    end if;
  end loop;
  if (select count(distinct value->>'date') from jsonb_array_elements(p_measurements))
      <>jsonb_array_length(p_measurements) then
    raise exception 'duplicate Android walking day' using errcode='22023';
  end if;
  select * into k from walking_device_keys where key_id=p_key_id for update;
  if not found or k.platform<>'android' or k.public_key<>'play_integrity:com.bulka.bonus'
    or k.sign_count<>p_previous_counter then
    raise exception 'Android walking key conflict' using errcode='P0001';
  end if;
  insert into walking_used_challenges(challenge_id) values(p_challenge_id) on conflict do nothing;
  if not found then raise exception 'Android walking challenge reused' using errcode='P0001'; end if;
  counter:=p_previous_counter;
  -- Take every device/day lock before the shared customer lock inside the
  -- existing single-day function. This prevents a batch from holding that
  -- customer lock while waiting on another installation's later day lock.
  for measurement in select value from jsonb_array_elements(p_measurements) order by value->>'date' loop
    perform pg_advisory_xact_lock(hashtextextended('walking:'||k.device_hash||':'||(measurement->>'date')::date,0));
  end loop;
  for measurement in select value from jsonb_array_elements(p_measurements) order by value->>'date' loop
    day_challenge:=md5('bulka:walking:android:v1:'||p_challenge_id::text||':'||(measurement->>'date'))::uuid;
    result:=apply_walking_steps(p_customer_id,p_key_id,counter,counter+1,day_challenge,
      (measurement->>'date')::date,(measurement->>'steps')::integer,
      (measurement->>'startAt')::timestamptz,(measurement->>'endAt')::timestamptz);
    counter:=counter+1;
    results:=results||jsonb_build_array(result);
  end loop;
  return jsonb_build_object('days',results);
end;
$$;
revoke all on function public.apply_android_walking_steps(uuid,text,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_android_walking_steps(uuid,text,bigint,uuid,jsonb) to service_role;
commit;

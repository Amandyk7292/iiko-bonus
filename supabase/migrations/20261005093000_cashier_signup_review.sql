-- Read-only review hints. They never combine employee identities, alter a QR,
-- or withhold/change a salary accrual. The ledger remains immutable.
create or replace function public.cashier_signup_ranking(
  p_from timestamptz, p_to timestamptz, p_branches uuid[] default '{}'
) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  with period_rewards as materialized (
    select r.employee_id, r.completed_at, r.amount
    from public.cashier_signup_rewards r
    where r.completed_at >= p_from and r.completed_at < p_to
      and (cardinality(p_branches) = 0 or r.branch_id = any(p_branches))
  ), rewards as (
    select employee_id, count(*)::integer completed, sum(amount)::integer reward_amount
    from period_rewards group by employee_id
  ), current_scope as (
    select d.*, lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))) normalized_name
    from public.cashier_signup_directory d
    where d.is_active and d.point_id is not null
      and (cardinality(p_branches) = 0 or d.branch_id = any(p_branches))
  ), duplicate_groups as (
    select point_id, city, normalized_name, jsonb_agg(jsonb_build_object(
      'id', employee_id, 'name', name, 'branchName', branch_name, 'city', city,
      'pointId', point_id
    ) order by employee_id) candidates
    from current_scope group by point_id, city, normalized_name having count(*) > 1
  ), duplicates as (
    select d.employee_id, (select jsonb_agg(candidate order by candidate->>'id')
      from jsonb_array_elements(g.candidates) candidate
      where candidate->>'id' <> d.employee_id) candidates
    from current_scope d join duplicate_groups g
      using(point_id, city, normalized_name)
  ), rapid_windows as (
    -- PostgreSQL timestamps have microsecond precision. Subtracting one
    -- microsecond makes this RANGE exactly [event, event + 10 minutes), so an
    -- event at the ten-minute boundary cannot inflate the previous window.
    select employee_id, completed_at,
      count(*) over(partition by employee_id order by completed_at
        range between current row and interval '9 minutes 59.999999 seconds' following)::integer registrations
    from period_rewards
  ), rapid_peaks as (
    select distinct on(employee_id) employee_id, registrations,
      completed_at starts_at, least(completed_at + interval '10 minutes', p_to) ends_at
    from rapid_windows where registrations >= 5
    order by employee_id, registrations desc, completed_at
  ), daily_windows as (
    -- Use the same fixed UTC+5 day boundaries as the ranking date contract.
    select employee_id, (completed_at at time zone interval '05:00')::date local_day,
      count(*)::integer registrations
    from period_rewards group by employee_id, local_day
  ), daily_peaks as (
    select distinct on(employee_id) employee_id, registrations,
      greatest(local_day::timestamp at time zone interval '05:00', p_from) starts_at,
      least((local_day + 1)::timestamp at time zone interval '05:00', p_to) ends_at
    from daily_windows where registrations >= 20
    order by employee_id, registrations desc, local_day
  ), signals as (
    select employee_id, jsonb_agg(jsonb_build_object(
      'type', type, 'count', registrations, 'from', starts_at, 'to', ends_at
    ) order by priority) hints from (
      select employee_id, 'rapid_registrations'::text type, registrations, starts_at, ends_at, 1 priority
      from rapid_peaks
      union all
      select employee_id, 'daily_registrations'::text, registrations, starts_at, ends_at, 2
      from daily_peaks
    ) peaks group by employee_id
  ), totals as (
    select d.*, coalesce(r.completed, 0) completed, coalesce(r.reward_amount, 0) reward_amount,
      coalesce(duplicates.candidates, '[]'::jsonb) duplicate_candidates,
      coalesce(signals.hints, '[]'::jsonb) review_signals
    from public.cashier_signup_directory d
      left join rewards r using(employee_id)
      left join duplicates using(employee_id)
      left join signals using(employee_id)
    where (d.is_active or r.completed > 0)
      and (cardinality(p_branches) = 0 or d.branch_id = any(p_branches) or r.completed > 0)
  ), ranked as (select *, dense_rank() over(order by completed desc) rank from totals)
  select jsonb_build_object(
    'reviewPolicy', jsonb_build_object('rapidCount', 5, 'rapidMinutes', 10,
      'dailyCount', 20, 'timeZone', 'Asia/Almaty'),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', employee_id, 'name', name, 'pointId', point_id, 'branchName', branch_name, 'city', city,
      'completed', completed, 'rewardAmount', reward_amount, 'rank', rank,
      'isArchived', not is_active, 'inviteToken', case when is_active then invite_token else null end,
      'duplicateCandidates', duplicate_candidates, 'reviewSignals', review_signals
    ) order by completed desc, name, employee_id), '[]'::jsonb)) from ranked;
$$;
revoke all on function public.cashier_signup_ranking(timestamptz,timestamptz,uuid[])
  from public, anon, authenticated;
grant execute on function public.cashier_signup_ranking(timestamptz,timestamptz,uuid[]) to service_role;

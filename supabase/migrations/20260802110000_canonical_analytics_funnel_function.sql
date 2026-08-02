-- Keep the funnel RPC aligned with the canonical event names introduced by
-- 20260802090000 while preserving one actor per payment order.
begin;

create or replace function public.get_app_funnel(p_branch_ids uuid[] default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with identified_events as (
    select
      event_type,
      case
        when event_type in (
          'payment_started', 'payment_paid', 'payment_failed', 'payment_cancelled'
        ) and order_id is not null then 'order:' || order_id::text
        when anonymous_session_id is not null then 'session:' || anonymous_session_id
        when customer_id is not null then 'customer:' || customer_id::text
        else 'event:' || id::text
      end as actor_key
    from public.customer_app_events
    where occurred_at >= now() - interval '30 days'
      and (
        p_branch_ids is null
        or branch_id = any(coalesce(p_branch_ids, '{}'::uuid[]))
      )
  ),
  counts as (
    select event_type, count(distinct actor_key)::integer as value
    from identified_events
    group by event_type
  )
  select jsonb_build_object(
    'funnel',
    coalesce(jsonb_object_agg(event_type, value), '{}'::jsonb),
    'funnelStartEvent',
    case when p_branch_ids is null then 'app_open' else 'catalog_view' end
  )
  from counts;
$$;

revoke all on function public.get_app_funnel(uuid[]) from public, anon, authenticated;
grant execute on function public.get_app_funnel(uuid[]) to service_role;

commit;

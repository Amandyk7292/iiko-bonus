-- Read activity in SQL so PostgREST's row limit cannot truncate transaction history.
create or replace function public.customer_bonus_activity(p_customer_ids uuid[])
returns table(customer_id uuid, last_activity_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select c.id, coalesce(max(t.timestamp), c.created_at)
  from public.customers c
  left join public.transactions t
    on t.customer_id = c.id and t.type <> 'churn_reminder'
  where c.id = any(p_customer_ids)
  group by c.id, c.created_at;
$$;
revoke all on function public.customer_bonus_activity(uuid[]) from public, anon, authenticated;
grant execute on function public.customer_bonus_activity(uuid[]) to service_role;

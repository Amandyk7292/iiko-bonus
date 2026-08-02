create or replace function public.activate_pending_bonus_transactions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_amount numeric := 0;
  v_customer_ids uuid[] := '{}'::uuid[];
begin
  with due as (
    update public.transactions
    set
      type = 'deposit',
      activated_at = now(),
      description = coalesce(description, '') || ' / активирован'
    where type = 'pending_deposit'
      and available_at is not null
      and available_at <= now()
    returning customer_id, amount
  ),
  due_totals as (
    select customer_id, sum(amount) as amount
    from due
    group by customer_id
  ),
  updated_customers as (
    update public.customers c
    set
      balance = balance + t.amount,
      updated_at = now()
    from due_totals t
    where c.id = t.customer_id
    returning c.id, t.amount
  )
  select
    count(*),
    coalesce(sum(amount), 0),
    coalesce((select array_agg(id) from updated_customers), '{}'::uuid[])
    into v_count, v_amount, v_customer_ids
    from due;

  return jsonb_build_object(
    'activated_count', v_count,
    'activated_amount', v_amount,
    'customer_ids', to_jsonb(v_customer_ids)
  );
end;
$$;

revoke all on function public.activate_pending_bonus_transactions() from public;
grant execute on function public.activate_pending_bonus_transactions() to service_role;

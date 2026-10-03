-- Global funding/adjustments have no branch and are visible only to an
-- unrestricted administrator. Scoped staff see online and POS entries for
-- their branches, with filtering before pagination.
create function public.customer_scoped_cash_entries(p_customer_id uuid,p_branch_ids uuid[],p_limit integer default 100)
returns table(id uuid,amount_minor bigint,kind text,source_key text,order_id uuid,topup_id uuid,
  description text,created_at timestamptz,ledger_branch_id uuid)
language sql stable security definer set search_path=public as $$
  select e.id,e.amount_minor,e.kind::text,e.source_key::text,e.order_id,e.topup_id,e.description::text,e.created_at,
    coalesce(o.branch_id,p.branch_id)
  from public.personal_account_entries e
  left join public.kaspi_orders o on o.id=e.order_id
  left join public.personal_account_pos_payments p on e.source_key in ('pos-payment:'||p.id,'pos-refund:'||p.id)
  where e.customer_id=p_customer_id and (
    p_branch_ids is null or cardinality(p_branch_ids)=0
    or coalesce(o.branch_id,p.branch_id)=any(p_branch_ids)
  )
  order by e.created_at desc,e.id desc
  limit least(200,greatest(20,coalesce(p_limit,100)));
$$;
revoke all on function public.customer_scoped_cash_entries(uuid,uuid[],integer) from public,anon,authenticated;
grant execute on function public.customer_scoped_cash_entries(uuid,uuid[],integer) to service_role;

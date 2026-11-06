create or replace function public.staff_order_sales_report(p_from timestamptz, p_to timestamptz, p_branches uuid[])
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with sales as (
    select case when fulfillment_type in ('delivery','pickup','preorder') then fulfillment_type else 'other' end as kind,
      greatest(0, coalesce(amount,0) - case when status='refunded' then coalesce(refund_amount,amount,0)
        when refund_status='succeeded' then coalesce(refund_amount,0) else 0 end) as revenue
    from kaspi_orders
    where created_at >= p_from and created_at < p_to
      and (cardinality(p_branches)=0 or branch_id=any(p_branches))
      and status in ('paid','refunded') and fulfillment_status='completed'
  ), groups as (select kind,count(*) as orders,coalesce(sum(revenue),0) as revenue from sales group by kind)
  select jsonb_build_object('revenue',coalesce((select sum(revenue) from sales),0),
    'orders',(select count(*) from sales),
    'channels',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'orders',orders,'revenue',revenue) order by kind) from groups),'[]'::jsonb));
$$;
revoke all on function public.staff_order_sales_report(timestamptz,timestamptz,uuid[]) from public,anon,authenticated;
grant execute on function public.staff_order_sales_report(timestamptz,timestamptz,uuid[]) to service_role;

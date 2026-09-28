begin;
create function public.franchise_report_v2(p_from timestamptz,p_to timestamptz,p_branches uuid[],p_branch uuid default null,p_offset integer default 0,p_partner uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_to<=p_from or p_to-p_from>interval '367 days' or p_offset<0 then raise exception 'Invalid report period'; end if;
 with allowed as (select * from franchise_order_finances where (p_partner is null or partner_id=p_partner) and (coalesce(cardinality(p_branches),0)=0 or branch_id=any(p_branches)) and (p_branch is null or branch_id=p_branch)),
 period as (select * from allowed where ordered_at>=p_from and ordered_at<p_to),
 groups as (
 select branch_id,count(*) as orders,count(distinct customer_id) filter(where was_paid) as customers,
 count(*) filter(where was_paid) as paid_orders,count(*) filter(where was_paid and fulfillment_status='completed') as completed_orders,
 count(*) filter(where fulfillment_status='cancelled' or status in ('failed','expired','cancelled')) as cancelled_orders,
 count(*) filter(where cash_refunded>0 or status='refunded') as refunded_orders,
 coalesce(sum(cash_amount) filter(where was_paid),0) as cash,coalesce(sum(cash_refunded) filter(where was_paid),0) as refunds,
 coalesce(sum(cash_net) filter(where was_paid),0) as net_cash,coalesce(sum(bonus_net) filter(where was_paid),0) as bonuses,
 coalesce(sum(delivery_net) filter(where was_paid),0) as delivery,coalesce(sum(discount_amount) filter(where was_paid),0) as discounts,
 coalesce(sum(platform_commission) filter(where was_paid and partner_id is not null),0) as commission,
 coalesce(sum(acquiring_fee) filter(where was_paid and reconciled),0) as acquiring_fee,
 count(*) filter(where was_paid and not coalesce(reconciled,false)) as unverified
 from period group by branch_id
 ), balances as (
 select branch_id,partner_id,sum(entitlement) as accrued,sum(paid_out) as paid_out,sum(entitlement-paid_out) as balance,
 count(*) filter(where (closed or paid_out<>0) and (not coalesce(reconciled,false) or branch_changed or refund_unresolved or (status='paid' and fulfillment_status='cancelled' and cash_net>0) or coalesce(refund_status,'') in ('pending','processing','failed','unknown'))) as blocked
 from allowed where partner_id is not null group by branch_id,partner_id
 )
 select jsonb_build_object(
 'branches',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('name',coalesce(l.name,'Без точки'),'city',l.city) order by g.net_cash desc) from groups g left join bulka_locations l on l.id=g.branch_id),'[]'::jsonb),
 'balances',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('partner',p.name,'branch',l.name) order by l.name,p.name) from balances b join franchise_partners p on p.id=b.partner_id join bulka_locations l on l.id=b.branch_id),'[]'::jsonb),
 'totalOrders',(select count(*) from period),
 'orders',coalesce((select jsonb_agg(to_jsonb(x)-'customer_id'-'reconciled_signature') from (select f.*,p.name as partner,l.name as branch from period f left join franchise_partners p on p.id=f.partner_id left join bulka_locations l on l.id=f.branch_id order by ordered_at desc,order_id limit 50 offset p_offset) x),'[]'::jsonb),
 'payouts',coalesce((select jsonb_agg(to_jsonb(x)) from (select p.*,n.name as partner,l.name as branch from franchise_payouts p join franchise_partners n on n.id=p.partner_id join bulka_locations l on l.id=p.branch_id where (coalesce(cardinality(p_branches),0)=0 or p.branch_id=any(p_branches)) and (p_branch is null or p.branch_id=p_branch) and (p_partner is null or p.partner_id=p_partner) and p.paid_at>=p_from and p.paid_at<p_to order by p.created_at desc limit 100) x),'[]'::jsonb)
 ) into result;
 return result;
end $$;

create function franchise_order_drilldown(p_from timestamptz,p_to timestamptz,p_branches uuid[],p_branch uuid,p_partner uuid,p_metric text,p_offset integer)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with rows as (
 select f.order_id,f.order_number,f.ordered_at,f.status,f.fulfillment_status,f.cash_amount,f.cash_refunded,f.cash_net,
 o.cancellation_reason,o.payment_method,l.name as branch,
 b.checked_at,b.payment_status as bank_payment,b.refund_status as bank_refund,b.issue as bank_issue,
 case when b.signature=f.current_signature and b.checked_at>now()-interval '24 hours' then true else false end as bank_check_current
 from franchise_order_finances f join kaspi_orders o on o.id=f.order_id
 left join bulka_locations l on l.id=f.branch_id left join franchise_bank_checks b on b.order_id=f.order_id
 where f.ordered_at>=p_from and f.ordered_at<p_to
 and (coalesce(cardinality(p_branches),0)=0 or f.branch_id=any(p_branches))
 and (p_branch is null or f.branch_id=p_branch or (p_branch='00000000-0000-0000-0000-000000000000' and f.branch_id is null)) and (p_partner is null or f.partner_id=p_partner)
 and case p_metric when 'paid' then f.was_paid when 'buyers' then f.was_paid
 when 'completed' then f.was_paid and f.fulfillment_status='completed'
 when 'cancelled' then f.fulfillment_status='cancelled' or f.status in ('failed','expired','cancelled')
 when 'refunded' then f.cash_refunded>0 or f.status='refunded'
 when 'issues' then o.payment_method='forte_card' and (b.order_id is null or b.checked_at<now()-interval '24 hours' or b.signature<>f.current_signature or b.issue<>'ok')
 else p_metric='orders' end
 ) select jsonb_build_object('total',(select count(*) from rows),'orders',coalesce((select jsonb_agg(to_jsonb(x)) from
 (select * from rows order by ordered_at desc,order_id limit 25 offset p_offset) x),'[]'::jsonb));
$$;
revoke all on function franchise_report_v2(timestamptz,timestamptz,uuid[],uuid,integer,uuid),franchise_order_drilldown(timestamptz,timestamptz,uuid[],uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function franchise_report_v2(timestamptz,timestamptz,uuid[],uuid,integer,uuid),franchise_order_drilldown(timestamptz,timestamptz,uuid[],uuid,uuid,text,integer) to service_role;
commit;

begin;
create function public.franchise_report(p_from timestamptz,p_to timestamptz,p_branches uuid[],p_branch uuid default null,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_to<=p_from or p_to-p_from>interval '367 days' or p_offset<0 then raise exception 'Invalid report period'; end if;
 with allowed as (select * from franchise_order_finances where (coalesce(cardinality(p_branches),0)=0 or branch_id=any(p_branches)) and (p_branch is null or branch_id=p_branch)),
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
 'payouts',coalesce((select jsonb_agg(to_jsonb(x)) from (select p.*,n.name as partner,l.name as branch from franchise_payouts p join franchise_partners n on n.id=p.partner_id join bulka_locations l on l.id=p.branch_id where (coalesce(cardinality(p_branches),0)=0 or p.branch_id=any(p_branches)) and (p_branch is null or p.branch_id=p_branch) and p.paid_at>=p_from and p.paid_at<p_to order by p.created_at desc limit 100) x),'[]'::jsonb)
 ) into result;
 return result;
end $$;
create function public.franchise_set_terms(p_branch uuid,p_partner uuid,p_commission integer,p_bonus integer,p_delivery text,p_actor text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('franchise-terms:'||p_branch,0));
 insert into franchise_branch_terms(branch_id,partner_id,commission_bps,bonus_compensation_bps,delivery_recipient,created_by)
 values(p_branch,p_partner,p_commission,p_bonus,p_delivery,p_actor) returning id into result;
 return result;
end $$;
create function public.franchise_reconcile(p_order uuid,p_fee numeric,p_recipient text,p_reference text,p_actor text,p_signature text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare f franchise_order_finances%rowtype;
begin
 perform 1 from franchise_order_accounts where order_id=p_order for update;
 select * into f from franchise_order_finances where order_id=p_order;
 if not found or not f.was_paid or f.branch_changed then raise exception 'Order cannot be reconciled' using errcode='P0001'; end if;
 if f.current_signature<>p_signature then raise exception 'Order changed; reload report' using errcode='P0001'; end if;
 if p_fee<0 or p_fee>f.cash_amount or p_recipient not in ('platform','partner') or length(trim(p_reference))<3 then raise exception 'Invalid reconciliation'; end if;
 update franchise_order_accounts set acquiring_fee=p_fee,payment_recipient=p_recipient,bank_reference=trim(p_reference),reconciled_signature=f.current_signature,reconciled_at=now(),reconciled_by=p_actor where order_id=p_order;
 insert into franchise_reconciliations(order_id,acquiring_fee,payment_recipient,bank_reference,signature,created_by)
 values(p_order,p_fee,p_recipient,trim(p_reference),f.current_signature,p_actor);
end $$;
create function public.franchise_record_payout(p_id uuid,p_branch uuid,p_partner uuid,p_expected numeric,p_reference text,p_paid_at timestamptz,p_actor text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prior franchise_payouts%rowtype; total numeric; blocked integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('franchise-payout:'||p_branch||':'||p_partner,0));
 select * into prior from franchise_payouts where id=p_id;
 if found then
  if prior.branch_id<>p_branch or prior.partner_id<>p_partner or prior.amount<>p_expected or prior.bank_reference<>trim(p_reference) then raise exception 'Idempotency conflict' using errcode='P0001'; end if;
  return to_jsonb(prior);
 end if;
 -- Consistent order avoids deadlocks; locks serialize refunds/edits with allocation.
 perform 1 from franchise_order_accounts where branch_id=p_branch and partner_id=p_partner order by order_id for update;
 select coalesce(sum(entitlement-paid_out),0),count(*) filter(where (closed or paid_out<>0) and (not coalesce(reconciled,false) or branch_changed or refund_unresolved or (status='paid' and fulfillment_status='cancelled' and cash_net>0) or coalesce(refund_status,'') in ('pending','processing','failed','unknown')))
 into total,blocked from franchise_order_finances where branch_id=p_branch and partner_id=p_partner;
 if blocked>0 then raise exception 'Reconcile orders and refunds before payout' using errcode='P0001'; end if;
 if total<=0 or total<>p_expected then raise exception 'Balance changed; reload report' using errcode='P0001'; end if;
 if p_paid_at>now()+interval '5 minutes' or length(trim(p_reference))<3 then raise exception 'Invalid payout confirmation'; end if;
 insert into franchise_payouts(id,branch_id,partner_id,amount,bank_reference,paid_at,created_by) values(p_id,p_branch,p_partner,total,trim(p_reference),p_paid_at,p_actor) returning * into prior;
 insert into franchise_payout_items(payout_id,order_id,amount) select p_id,order_id,entitlement-paid_out from franchise_order_finances where branch_id=p_branch and partner_id=p_partner and entitlement<>paid_out;
 return to_jsonb(prior);
end $$;
revoke all on function franchise_report(timestamptz,timestamptz,uuid[],uuid,integer),franchise_set_terms(uuid,uuid,integer,integer,text,text),franchise_reconcile(uuid,numeric,text,text,text,text),franchise_record_payout(uuid,uuid,uuid,numeric,text,timestamptz,text) from public,anon,authenticated;
grant execute on function franchise_report(timestamptz,timestamptz,uuid[],uuid,integer),franchise_set_terms(uuid,uuid,integer,integer,text,text),franchise_reconcile(uuid,numeric,text,text,text,text),franchise_record_payout(uuid,uuid,uuid,numeric,text,timestamptz,text) to service_role;
create function public.franchise_payout_detail(p_id uuid,p_branches uuid[]) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('payout',to_jsonb(p),'items',coalesce((select jsonb_agg(jsonb_build_object('order_id',i.order_id,'order_number',o.order_number,'amount',i.amount) order by i.order_id) from franchise_payout_items i join kaspi_orders o on o.id=i.order_id where i.payout_id=p.id),'[]'::jsonb))
 from franchise_payouts p where p.id=p_id and (coalesce(cardinality(p_branches),0)=0 or p.branch_id=any(p_branches));
$$;
revoke all on function franchise_payout_detail(uuid,uuid[]) from public,anon,authenticated;
grant execute on function franchise_payout_detail(uuid,uuid[]) to service_role;

commit;

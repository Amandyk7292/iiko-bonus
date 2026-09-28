begin;
alter table franchise_branch_terms add column settlement_model integer not null default 1 check(settlement_model in(1,2));
alter table franchise_order_accounts add column settlement_model integer not null default 1 check(settlement_model in(1,2));
alter table kaspi_orders add column provider_payment_confirmed_at timestamptz;
update kaspi_orders set provider_payment_confirmed_at=payment_reconciled_at
 where payment_method='forte_card' and status in('paid','refunded') and payment_reconciled_at is not null
 and lower(replace(provider_status,'_','')) in ('successful','succeeded','fullypaid','closed','refunded','voided');
create or replace function public.capture_franchise_order() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare terms franchise_branch_terms%rowtype;
begin
 select * into terms from franchise_branch_terms where branch_id=new.branch_id and effective_at<=clock_timestamp() order by effective_at desc limit 1;
 if terms.partner_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('franchise-payout:'||new.branch_id||':'||terms.partner_id,0));
 end if;
 insert into franchise_order_accounts(order_id,branch_id,partner_id,terms_id,commission_bps,bonus_compensation_bps,delivery_recipient,settlement_model)
 values(new.id,new.branch_id,terms.partner_id,terms.id,coalesce(terms.commission_bps,0),coalesce(terms.bonus_compensation_bps,0),coalesce(terms.delivery_recipient,'platform'),coalesce(terms.settlement_model,2));
 return new;
end $$;
create or replace function public.franchise_set_terms(p_branch uuid,p_partner uuid,p_commission integer,p_bonus integer,p_delivery text,p_actor text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('franchise-terms:'||p_branch,0));
 insert into franchise_branch_terms(branch_id,partner_id,commission_bps,bonus_compensation_bps,delivery_recipient,created_by,settlement_model)
 values(p_branch,p_partner,case when p_partner is null then 0 else 400 end,p_bonus,'partner',p_actor,2) returning id into result;
 return result;
end $$;
-- New terms apply only to future orders; captured historical terms remain intact.
insert into franchise_branch_terms(branch_id,partner_id,commission_bps,bonus_compensation_bps,delivery_recipient,created_by,settlement_model)
 select branch_id,partner_id,400,bonus_compensation_bps,'partner','settlement-model-v2',2 from
 (select distinct on(branch_id) * from franchise_branch_terms order by branch_id,effective_at desc) t where partner_id is not null;

create view franchise_order_finances_v3 with(security_invoker=true) as
with evidence as (
 select f.order_id,
 coalesce(f.reconciled and (b.checked_at is null or f.reconciled_at>b.checked_at),false) as manual_verified,
 coalesce((o.provider_payment_confirmed_at is not null) or (f.was_paid and (o.payment_method='personal_account' or f.cash_amount=0)) or
 (b.signature=f.current_signature and b.payment_status in('paid','refunded') and b.issue='ok'),false) as payment_confirmed,
 (coalesce(f.refund_status,'') in('pending','processing','failed','unknown') or f.refund_unresolved or
 (f.status='refunded' and coalesce(f.refund_status,'')<>'succeeded' and lower(coalesce(o.provider_status,'')) not in('refunded','voided') and not coalesce(b.signature=f.current_signature and b.refund_status='confirmed',false))) as refund_review,
 coalesce(b.signature=f.current_signature and b.issue not in('ok','unavailable') and b.checked_at>=coalesce(o.provider_payment_confirmed_at,'-infinity'::timestamptz),false) as bank_discrepancy,
 case when exists(select 1 from delivery_jobs j where j.order_id=o.id) then
  case when exists(select 1 from delivery_jobs j where j.order_id=o.id and (j.budget_final_cost is null or j.currency<>'KZT')) then null
   else (select sum(j.budget_final_cost) from delivery_jobs j where j.order_id=o.id) end
 when o.fulfillment_type='delivery' then null else 0 end::numeric(14,2) as delivery_actual_cost
 from franchise_order_finances f join kaspi_orders o on o.id=f.order_id left join franchise_bank_checks b on b.order_id=f.order_id
), ready as (
 select e.*, ((f.was_paid and (not e.payment_confirmed or e.refund_review)) or e.bank_discrepancy) and not e.manual_verified as payment_review,
 a.settlement_model
 from evidence e join franchise_order_finances f on f.order_id=e.order_id join franchise_order_accounts a on a.order_id=e.order_id
)
select f.order_id,f.branch_id,f.partner_id,f.terms_id,f.commission_bps,f.bonus_compensation_bps,f.delivery_recipient,f.payment_recipient,f.acquiring_fee,f.bank_reference,f.reconciled_signature,f.reconciled_at,f.reconciled_by,f.created_at,f.order_number,f.customer_id,f.ordered_at,f.status,f.fulfillment_status,f.refund_status,f.refund_unresolved,f.branch_changed,f.cash_amount,f.bonus_spent,f.discount_amount,f.delivery_fee,f.cash_refunded,f.bonus_restored,f.delivery_refunded,f.paid_out,f.was_paid,f.cash_net,f.bonus_net,f.delivery_net,f.current_signature,f.platform_commission,f.bonus_compensation,
case when r.settlement_model=2 or f.partner_id is null then
 not r.payment_review and not f.branch_changed and not r.refund_review
 and (f.partner_id is null or r.delivery_actual_cost is not null)
 else f.reconciled end as reconciled,
f.closed,
case when r.settlement_model=2 and f.partner_id is not null then
 (case when f.status='paid' and f.fulfillment_status='completed' then
  (case when f.payment_recipient='platform' then f.cash_net else 0 end)-f.platform_commission+f.bonus_compensation
  else 0 end) - case when f.closed then coalesce(r.delivery_actual_cost,0) else 0 end
 else f.entitlement end::numeric(14,2) as entitlement,
r.settlement_model,r.payment_confirmed,r.manual_verified as payment_statement_confirmed,r.payment_review,r.delivery_actual_cost,
(r.settlement_model=2 and f.partner_id is not null and r.delivery_actual_cost is null) as delivery_cost_pending,
case when r.delivery_actual_cost is null then null else r.delivery_actual_cost-f.delivery_net end as delivery_net_cost
from franchise_order_finances f join ready r on r.order_id=f.order_id;
revoke all on franchise_order_finances_v3 from public,anon,authenticated;
grant select on franchise_order_finances_v3 to service_role;
create or replace function public.franchise_report_v2(p_from timestamptz,p_to timestamptz,p_branches uuid[],p_branch uuid default null,p_offset integer default 0,p_partner uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_to<=p_from or p_to-p_from>interval '367 days' or p_offset<0 then raise exception 'Invalid report period'; end if;
 with allowed as (select * from franchise_order_finances_v3 where (p_partner is null or partner_id=p_partner) and (coalesce(cardinality(p_branches),0)=0 or branch_id=any(p_branches)) and (p_branch is null or branch_id=p_branch)),
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
 count(*) filter(where payment_review) as unverified,
 coalesce(sum(delivery_actual_cost),0) as delivery_actual_cost, count(*) filter(where delivery_cost_pending) as delivery_unknown,
 coalesce(sum(delivery_actual_cost-delivery_net),0) as delivery_net_cost
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

create or replace function public.franchise_record_payout(p_id uuid,p_branch uuid,p_partner uuid,p_expected numeric,p_reference text,p_paid_at timestamptz,p_actor text)
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
 into total,blocked from franchise_order_finances_v3 where branch_id=p_branch and partner_id=p_partner;
 if blocked>0 then raise exception 'Reconcile orders and refunds before payout' using errcode='P0001'; end if;
 if total<=0 or total<>p_expected then raise exception 'Balance changed; reload report' using errcode='P0001'; end if;
 if p_paid_at>now()+interval '5 minutes' or length(trim(p_reference))<3 then raise exception 'Invalid payout confirmation'; end if;
 insert into franchise_payouts(id,branch_id,partner_id,amount,bank_reference,paid_at,created_by) values(p_id,p_branch,p_partner,total,trim(p_reference),p_paid_at,p_actor) returning * into prior;
 insert into franchise_payout_items(payout_id,order_id,amount) select p_id,order_id,entitlement-paid_out from franchise_order_finances_v3 where branch_id=p_branch and partner_id=p_partner and entitlement<>paid_out;
 return to_jsonb(prior);
end $$;
create or replace function franchise_month_preview(p_branch uuid,p_partner uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_month<>date_trunc('month',p_month)::date then raise exception 'Invalid month'; end if;
 with latest as (
 select distinct on(i.order_id) i.* from franchise_month_items i join franchise_month_closures c on c.id=i.closure_id
 where c.branch_id=p_branch and c.partner_id is not distinct from p_partner order by i.order_id,c.month desc
 ), entries as (
 select f.*,l.entitlement as previous_entitlement,l.cash_net as previous_cash_net,
 l.order_id is not null as adjustment,
 md5(concat_ws('|',f.current_signature,f.entitlement,f.cash_net,f.acquiring_fee,f.payment_recipient,f.reconciled,f.refund_unresolved,f.delivery_actual_cost)) as closing_signature
 from franchise_order_finances_v3 f left join latest l on l.order_id=f.order_id
 where f.branch_id=p_branch and f.partner_id is not distinct from p_partner
 and f.ordered_at < ((p_month+interval '1 month')::timestamp at time zone 'Asia/Almaty')
 and (l.order_id is not null or f.ordered_at >= (p_month::timestamp at time zone 'Asia/Almaty'))
 ), changed as (
 select e.* from entries e left join latest l on l.order_id=e.order_id
 where not e.adjustment or e.closing_signature<>l.signature
 )
 select jsonb_build_object('month',p_month,'branch_id',p_branch,'partner_id',p_partner,
 'blocked',count(*) filter(where (was_paid and (not coalesce(reconciled,false) or not closed))  or branch_changed or refund_unresolved or coalesce(refund_status,'') in ('pending','processing','failed','unknown') or (status='paid' and fulfillment_status='cancelled' and cash_net>0)),
 'entitlement',coalesce(sum(entitlement-coalesce(previous_entitlement,0)),0),
 'cash_net',coalesce(sum(case when was_paid then cash_net else 0 end-coalesce(previous_cash_net,0)),0),
 'signature',md5(coalesce(string_agg(order_id::text||closing_signature,',' order by order_id),'')),
 'items',coalesce(jsonb_agg(jsonb_build_object('order_id',order_id,'order_number',order_number,
 'adjustment',adjustment,'entitlement',entitlement,'cash_net',case when was_paid then cash_net else 0 end,
 'delta',entitlement-coalesce(previous_entitlement,0),'cash_delta',case when was_paid then cash_net else 0 end-coalesce(previous_cash_net,0),
 'signature',closing_signature,'delivery_actual_cost',delivery_actual_cost,'delivery_net_cost',delivery_net_cost,'settlement_model',settlement_model,'cash_amount',cash_amount,'cash_refunded',cash_refunded,
 'acquiring_fee',acquiring_fee,'platform_commission',platform_commission,'bonus_compensation',bonus_compensation,
 'payment_recipient',payment_recipient,'bank_reference',bank_reference,'status',status,'fulfillment_status',fulfillment_status) order by ordered_at,order_id),'[]'::jsonb)) into result from changed;
 return result;
end $$;

create function franchise_bank_queue() returns table(order_id uuid,signature text)
language sql stable security definer set search_path=public,pg_temp as $$
 select f.order_id,f.current_signature from franchise_order_finances_v3 f
 join kaspi_orders o on o.id=f.order_id left join franchise_bank_checks b on b.order_id=f.order_id
 where o.payment_method='forte_card' and f.payment_review
 and (b.checked_at is null or b.checked_at<now()-interval '1 hour' or (b.issue='ok' and b.signature<>f.current_signature))
 order by b.checked_at nulls first,f.ordered_at desc limit 10;
$$;
revoke all on function franchise_bank_queue() from public,anon,authenticated;
grant execute on function franchise_bank_queue() to service_role;
create or replace function franchise_order_drilldown(p_from timestamptz,p_to timestamptz,p_branches uuid[],p_branch uuid,p_partner uuid,p_metric text,p_offset integer)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with rows as (
 select f.order_id,f.order_number,f.ordered_at,f.status,f.fulfillment_status,f.cash_amount,f.cash_refunded,f.cash_net,
 f.payment_confirmed,f.payment_review,f.delivery_actual_cost,f.delivery_cost_pending,o.cancellation_reason,o.payment_method,l.name as branch,
 b.checked_at,b.payment_status as bank_payment,b.refund_status as bank_refund,b.issue as bank_issue,
 case when b.signature=f.current_signature and b.checked_at>now()-interval '24 hours' then true else false end as bank_check_current
 from franchise_order_finances_v3 f join kaspi_orders o on o.id=f.order_id
 left join bulka_locations l on l.id=f.branch_id left join franchise_bank_checks b on b.order_id=f.order_id
 where f.ordered_at>=p_from and f.ordered_at<p_to
 and (coalesce(cardinality(p_branches),0)=0 or f.branch_id=any(p_branches))
 and (p_branch is null or f.branch_id=p_branch or (p_branch='00000000-0000-0000-0000-000000000000' and f.branch_id is null)) and (p_partner is null or f.partner_id=p_partner)
 and case p_metric when 'paid' then f.was_paid when 'buyers' then f.was_paid
 when 'completed' then f.was_paid and f.fulfillment_status='completed'
 when 'cancelled' then f.fulfillment_status='cancelled' or f.status in ('failed','expired','cancelled')
 when 'refunded' then f.cash_refunded>0 or f.status='refunded'
 when 'issues' then f.payment_review or f.delivery_cost_pending
 else p_metric='orders' end
 ) select jsonb_build_object('total',(select count(*) from rows),'orders',coalesce((select jsonb_agg(to_jsonb(x)) from
 (select * from rows order by ordered_at desc,order_id limit 25 offset p_offset) x),'[]'::jsonb));
$$;
create trigger lock_franchise_delivery before insert or update or delete on delivery_jobs for each row execute function lock_franchise_refund();
create trigger lock_franchise_bank_check before insert or update or delete on franchise_bank_checks for each row execute function lock_franchise_refund();
commit;

begin;
create view public.franchise_order_finances with (security_invoker=true) as
with base as (
 select a.*,o.order_number,o.customer_id,o.created_at as ordered_at,o.status,o.fulfillment_status,o.refund_status,
 exists(select 1 from order_partial_refunds r where r.order_id=o.id and r.status in ('pending','processing')) as refund_unresolved,
 o.branch_id is distinct from a.branch_id as branch_changed,
 coalesce(o.amount,0)::numeric as cash_amount,coalesce(o.bonus_spent,0)::numeric as bonus_spent,
 coalesce(o.discount_amount,0)::numeric as discount_amount,coalesce(o.delivery_fee,0)::numeric as delivery_fee,
 case when o.status='refunded' then coalesce(o.amount,0) else least(coalesce(o.amount,0),greatest(0,coalesce(o.partially_refunded_amount,0))) end as cash_refunded,
 case when o.status='refunded' then coalesce(o.bonus_spent,0) else least(coalesce(o.bonus_spent,0),coalesce((select sum(spent_bonus_restored) from order_partial_refund_adjustments where order_id=o.id),0)) end as bonus_restored,
 case when o.status='refunded' then coalesce(o.delivery_fee,0) else least(coalesce(o.delivery_fee,0),coalesce((select sum(i.refund_amount) from order_partial_refund_items i join order_partial_refunds r on r.id=i.refund_id where r.order_id=o.id and r.status='succeeded' and i.line_key='__delivery_fee__'),0)) end as delivery_refunded,
 coalesce((select sum(i.amount) from franchise_payout_items i where i.order_id=o.id),0) as paid_out
 from franchise_order_accounts a join kaspi_orders o on o.id=a.order_id
), net as (
 select *,status in ('paid','refunded') as was_paid,
 greatest(0,cash_amount-cash_refunded) as cash_net,
 greatest(0,bonus_spent-bonus_restored) as bonus_net,
 greatest(0,delivery_fee-delivery_refunded) as delivery_net,
 md5(concat_ws('|',status,fulfillment_status,cash_amount,cash_refunded,bonus_spent,bonus_restored,delivery_fee,delivery_refunded,branch_changed,refund_unresolved,coalesce(refund_status,''))) as current_signature
 from base
), calculated as (
 select *,round(greatest(0,cash_net-delivery_net)*commission_bps/10000,2) as platform_commission,
 round(bonus_net*bonus_compensation_bps/10000,2) as bonus_compensation,
 reconciled_signature=current_signature and acquiring_fee is not null and not branch_changed as reconciled,
 (status='refunded' or (status='paid' and fulfillment_status in ('completed','cancelled'))) as closed
 from net
)
select *,case when partner_id is null or not closed then 0 else
 (case when status='paid' and fulfillment_status='completed' then
   (case when payment_recipient='platform' then cash_net else 0 end)
   - case when delivery_recipient='platform' then delivery_net else 0 end
   - platform_commission + bonus_compensation else 0 end)
 - case when payment_recipient='platform' then coalesce(acquiring_fee,0) else 0 end end::numeric(14,2) as entitlement
from calculated;
revoke all on public.franchise_order_finances from public,anon,authenticated;
grant select on public.franchise_order_finances to service_role;
commit;

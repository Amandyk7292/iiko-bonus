-- migration-safety: allow-destructive reason=Replace role CHECK atomically with a superset that adds read-only franchisee; no rows or existing roles removed.
begin;
alter table admin_user_profiles drop constraint admin_user_profiles_role_check;
alter table admin_user_profiles add constraint admin_user_profiles_role_check check(role in
 ('owner','branch_manager','operator','marketer','courier','editor','viewer','cashier','franchisee'));
create table franchise_portal_users (
 username text primary key references admin_user_profiles(username),
 partner_id uuid not null references franchise_partners(id),
 created_by text not null, updated_at timestamptz not null default now()
);
create table franchise_bank_checks (
 order_id uuid primary key references kaspi_orders(id),
 checked_at timestamptz not null default now(), checked_by text not null,
 signature text not null, payment_status text not null, refund_status text not null,
 issue text not null, provider_status text
);
create table franchise_month_closures (
 id uuid primary key default gen_random_uuid(), branch_id uuid not null references bulka_locations(id),
 partner_id uuid references franchise_partners(id), month date not null,
 snapshot jsonb not null, closed_by text not null, closed_at timestamptz not null default now(),
 unique nulls not distinct(branch_id,partner_id,month)
);
create table franchise_month_items (
 closure_id uuid not null references franchise_month_closures(id),
 order_id uuid not null references kaspi_orders(id),
 entitlement numeric(14,2) not null, cash_net numeric(14,2) not null,
 signature text not null, adjustment boolean not null, snapshot jsonb not null,
 primary key(closure_id,order_id)
);
alter table franchise_portal_users enable row level security;
alter table franchise_bank_checks enable row level security;
alter table franchise_month_closures enable row level security;
alter table franchise_month_items enable row level security;
revoke all on franchise_portal_users,franchise_bank_checks,franchise_month_closures,franchise_month_items from public,anon,authenticated;
grant select,insert,update on franchise_portal_users,franchise_bank_checks to service_role;
grant select on franchise_month_closures,franchise_month_items to service_role;
create policy portal_service on franchise_portal_users for all to service_role using(true) with check(true);
create policy bank_checks_service on franchise_bank_checks for all to service_role using(true) with check(true);
create policy month_read on franchise_month_closures for select to service_role using(true);
create policy month_items_read on franchise_month_items for select to service_role using(true);

create function franchise_month_preview(p_branch uuid,p_partner uuid,p_month date)
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
 md5(concat_ws('|',f.current_signature,f.entitlement,f.cash_net,f.acquiring_fee,f.payment_recipient,f.reconciled,f.refund_unresolved)) as closing_signature
 from franchise_order_finances f left join latest l on l.order_id=f.order_id
 where f.branch_id=p_branch and f.partner_id is not distinct from p_partner
 and f.ordered_at < ((p_month+interval '1 month')::timestamp at time zone 'Asia/Almaty')
 and (l.order_id is not null or f.ordered_at >= (p_month::timestamp at time zone 'Asia/Almaty'))
 ), changed as (
 select e.* from entries e left join latest l on l.order_id=e.order_id
 where not e.adjustment or e.closing_signature<>l.signature
 )
 select jsonb_build_object('month',p_month,'branch_id',p_branch,'partner_id',p_partner,
 'blocked',count(*) filter(where (was_paid and (not coalesce(reconciled,false) or not closed)) or exists(select 1 from franchise_bank_checks b where b.order_id=changed.order_id and b.issue<>'ok' and b.checked_at>coalesce(changed.reconciled_at,'-infinity'::timestamptz)) or branch_changed or refund_unresolved or coalesce(refund_status,'') in ('pending','processing','failed','unknown') or (status='paid' and fulfillment_status='cancelled' and cash_net>0)),
 'entitlement',coalesce(sum(entitlement-coalesce(previous_entitlement,0)),0),
 'cash_net',coalesce(sum(case when was_paid then cash_net else 0 end-coalesce(previous_cash_net,0)),0),
 'signature',md5(coalesce(string_agg(order_id::text||closing_signature,',' order by order_id),'')),
 'items',coalesce(jsonb_agg(jsonb_build_object('order_id',order_id,'order_number',order_number,
 'adjustment',adjustment,'entitlement',entitlement,'cash_net',case when was_paid then cash_net else 0 end,
 'delta',entitlement-coalesce(previous_entitlement,0),'cash_delta',case when was_paid then cash_net else 0 end-coalesce(previous_cash_net,0),
 'signature',closing_signature,'cash_amount',cash_amount,'cash_refunded',cash_refunded,
 'acquiring_fee',acquiring_fee,'platform_commission',platform_commission,'bonus_compensation',bonus_compensation,
 'payment_recipient',payment_recipient,'bank_reference',bank_reference,'status',status,'fulfillment_status',fulfillment_status) order by ordered_at,order_id),'[]'::jsonb)) into result from changed;
 return result;
end $$;

create function franchise_close_month(p_branch uuid,p_partner uuid,p_month date,p_signature text,p_actor text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare preview jsonb; result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('franchise-close:'||p_branch,0));
 if p_month>=date_trunc('month',now() at time zone 'Asia/Almaty')::date then raise exception 'Month is not finished' using errcode='P0001'; end if;
 if exists(select 1 from franchise_month_closures where branch_id=p_branch and partner_id is not distinct from p_partner and month>=p_month) then raise exception 'Month already closed or out of order' using errcode='P0001'; end if;
 if exists(select 1 from franchise_month_closures where branch_id=p_branch and partner_id is not distinct from p_partner) and
 (select max(month)+interval '1 month' from franchise_month_closures where branch_id=p_branch and partner_id is not distinct from p_partner)<>p_month then raise exception 'Close months consecutively' using errcode='P0001'; end if;
 -- Same row locks as refunds and manual reconciliation; the snapshot is atomic.
 perform 1 from franchise_order_accounts where branch_id=p_branch order by order_id for update;
 preview:=franchise_month_preview(p_branch,p_partner,p_month);
 if (preview->>'blocked')::int>0 or preview->>'signature'<>p_signature then raise exception 'Resolve discrepancies and reload preview' using errcode='P0001'; end if;
 insert into franchise_month_closures(branch_id,partner_id,month,snapshot,closed_by)
 values(p_branch,p_partner,p_month,preview,p_actor) returning id into result;
 insert into franchise_month_items(closure_id,order_id,entitlement,cash_net,signature,adjustment,snapshot)
 select result,(x->>'order_id')::uuid,(x->>'entitlement')::numeric,(x->>'cash_net')::numeric,x->>'signature',(x->>'adjustment')::boolean,x
 from jsonb_array_elements(preview->'items') x;
 return result;
end $$;
revoke all on function franchise_month_preview(uuid,uuid,date),franchise_close_month(uuid,uuid,date,text,text) from public,anon,authenticated;
grant execute on function franchise_month_preview(uuid,uuid,date),franchise_close_month(uuid,uuid,date,text,text) to service_role;
commit;

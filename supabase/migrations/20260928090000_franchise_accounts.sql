begin;
create table public.franchise_partners (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 2 and 160),
 created_at timestamptz not null default now(), created_by text not null
);
create table public.franchise_branch_terms (
 id uuid primary key default gen_random_uuid(), branch_id uuid not null references bulka_locations(id),
 partner_id uuid references franchise_partners(id), effective_at timestamptz not null default clock_timestamp(),
 commission_bps integer not null check(commission_bps between 0 and 10000),
 bonus_compensation_bps integer not null check(bonus_compensation_bps between 0 and 10000),
 delivery_recipient text not null check(delivery_recipient in ('platform','partner')),
 created_by text not null, unique(branch_id,effective_at)
);
create index franchise_terms_lookup on franchise_branch_terms(branch_id,effective_at desc);
create table public.franchise_order_accounts (
 order_id uuid primary key references kaspi_orders(id), branch_id uuid references bulka_locations(id),
 partner_id uuid references franchise_partners(id), terms_id uuid references franchise_branch_terms(id),
 commission_bps integer not null default 0, bonus_compensation_bps integer not null default 0,
 delivery_recipient text not null default 'platform',
 payment_recipient text not null default 'platform' check(payment_recipient in ('platform','partner')),
 acquiring_fee numeric(14,2) check(acquiring_fee>=0), bank_reference text,
 reconciled_signature text, reconciled_at timestamptz, reconciled_by text,
 created_at timestamptz not null default now()
);
create index franchise_accounts_branch on franchise_order_accounts(branch_id,partner_id);
create table public.franchise_reconciliations (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references franchise_order_accounts(order_id),
 acquiring_fee numeric(14,2) not null, payment_recipient text not null, bank_reference text not null,
 signature text not null, created_at timestamptz not null default now(), created_by text not null
);
create table public.franchise_payouts (
 id uuid primary key, branch_id uuid not null references bulka_locations(id), partner_id uuid not null references franchise_partners(id),
 amount numeric(14,2) not null check(amount>0), bank_reference text not null unique,
 paid_at timestamptz not null, created_at timestamptz not null default now(), created_by text not null
);
create table public.franchise_payout_items (
 payout_id uuid not null references franchise_payouts(id), order_id uuid not null references franchise_order_accounts(order_id),
 amount numeric(14,2) not null, primary key(payout_id,order_id)
);
create index franchise_payout_items_order on franchise_payout_items(order_id);
-- Existing orders remain company-owned. No historical ownership is inferred.
insert into franchise_order_accounts(order_id,branch_id) select id,branch_id from kaspi_orders;
create function public.capture_franchise_order() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare terms franchise_branch_terms%rowtype;
begin
 select * into terms from franchise_branch_terms where branch_id=new.branch_id and effective_at<=clock_timestamp() order by effective_at desc limit 1;
 if terms.partner_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('franchise-payout:'||new.branch_id||':'||terms.partner_id,0));
 end if;
 insert into franchise_order_accounts(order_id,branch_id,partner_id,terms_id,commission_bps,bonus_compensation_bps,delivery_recipient)
 values(new.id,new.branch_id,terms.partner_id,terms.id,coalesce(terms.commission_bps,0),coalesce(terms.bonus_compensation_bps,0),coalesce(terms.delivery_recipient,'platform'));
 return new;
end $$;
create trigger capture_franchise_order after insert on kaspi_orders for each row execute function capture_franchise_order();
-- Serialize order changes against payout calculation; no customer-facing network calls.
create function public.lock_franchise_order() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from franchise_order_accounts where order_id=new.id for update;
 return new;
end $$;
create trigger lock_franchise_order before update on kaspi_orders for each row execute function lock_franchise_order();
create function public.lock_franchise_refund() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid; doc jsonb;
begin
 doc=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='order_partial_refund_items' then
  select order_id into target from order_partial_refunds where id=(doc->>'refund_id')::uuid;
 else target=(doc->>'order_id')::uuid;
 end if;
 perform 1 from franchise_order_accounts where order_id=target for update;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger lock_franchise_refund before insert or update or delete on order_partial_refunds for each row execute function lock_franchise_refund();
create trigger lock_franchise_refund before insert or update or delete on order_partial_refund_items for each row execute function lock_franchise_refund();
create trigger lock_franchise_refund before insert or update or delete on order_partial_refund_adjustments for each row execute function lock_franchise_refund();
revoke all on function lock_franchise_refund() from public,anon,authenticated;
do $$ declare tab text; begin
 foreach tab in array array['franchise_partners','franchise_branch_terms','franchise_order_accounts','franchise_reconciliations','franchise_payouts','franchise_payout_items'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('revoke all on public.%I from public,anon,authenticated',tab);
 execute format('grant all on public.%I to service_role',tab);
 end loop;
end $$;
revoke all on function capture_franchise_order(),lock_franchise_order() from public,anon,authenticated;
commit;

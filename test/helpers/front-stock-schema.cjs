const { readFileSync } = require('node:fs');

module.exports = async function createFrontStockSchema(db) {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table bulka_locations(id uuid primary key, active boolean default true,
      pickup_slot_capacity integer default 10, delivery_slot_capacity integer default 10, preorder_slot_capacity integer default 10);
    create table kaspi_orders(id uuid primary key, branch_id uuid, order_number bigint, status text default 'paid',
      kitchen_status text default 'queued', fulfillment_status text default 'new', refund_status text, cart_items jsonb default '[]',
      subtotal numeric default 35, discount_amount numeric default 0, bonus_spent numeric default 0);
    create table order_partial_refunds(id uuid primary key, order_id uuid, status text);
    create table custom_products(id uuid primary key);
    create table order_partial_refund_items(refund_id uuid, product_id text, quantity integer);
    create table branch_product_inventory(id uuid default gen_random_uuid(), branch_id uuid, product_id text, product_name text,
      source_quantity integer, manual_stop boolean default false, source text default 'iiko', last_synced_at timestamptz,
      preparation_minutes integer, updated_at timestamptz default now(), primary key(branch_id,product_id));
    create table inventory_reservations(id uuid default gen_random_uuid(), customer_id uuid, client_request_id uuid,
      branch_id uuid, product_id text, quantity integer, status text, expires_at timestamptz,
      order_id uuid, updated_at timestamptz default now());
    create table fulfillment_slot_reservations(id uuid default gen_random_uuid(), order_id uuid, branch_id uuid,
      fulfillment_type text, scheduled_at timestamptz, status text, expires_at timestamptz, updated_at timestamptz default now());
    create table loyalty_reservations(id uuid default gen_random_uuid(), order_id text, status text);
    create table gift_card_pos_reservations(branch_id uuid,iiko_order_id text,status text);`);
  const initial = readFileSync(
    'supabase/migrations/20260729090000_inventory_reservation_integrity.sql',
    'utf8',
  );
  await db.exec(
    initial.slice(0, initial.indexOf('drop function if exists public.reserve_fulfillment_slot')),
  );
  for (const migration of [
    '20260909230000_cashier_inventory',
    '20260909232000_front_inventory_sync',
    '20260910003000_cashier_inventory_guardrails',
    '20260910013000_online_stock_buffer',
    '20260910130000_front_shared_stock_guard',
    '20260910131000_front_stock_reconciliation',
    '20260910133000_front_reservation_settlement',
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}.sql`, 'utf8'));
};

const { readFileSync } = require('node:fs');
module.exports = async (db) => {
  await require('./front-stock-schema.cjs')(db);
  await db.exec(`alter table kaspi_orders add column fulfillment_type text default 'pickup',
    add column preorder_fulfillment_type text, add column courier_id uuid,
    add column courier_dispatch_status text, add column courier_dispatch_requested_at timestamptz,
    add column courier_dispatch_completed_at timestamptz, add column courier_dispatch_next_attempt_at timestamptz,
    add column courier_dispatch_error text, add column updated_at timestamptz default now(),
    add column created_at timestamptz default now(), add column staff_accepted_by text,
    add column preparation_minutes integer,add column promised_ready_at timestamptz,
    add column kitchen_started_at timestamptz,add column staff_accepted_at timestamptz,
    add column staff_accepted_session_jti_hash text,add column staff_accepted_installation_id text,
    add column courier_dispatch_provider text,add column courier_dispatch_attempts integer,
    add column kitchen_ready_at timestamptz,add column handed_to_courier_at timestamptz,
    add column delivery_status text,add column fulfilled_at timestamptz,
    add column cancellation_reason text,add column last_error text;
    create table delivery_jobs(id uuid default gen_random_uuid(),order_id uuid references kaspi_orders(id));`);
  for (const migration of [
    '20260910140000_preorder_pickup_and_receipt_dispatch',
    '20260910143000_front_tablet_stock_control',
    '20260910144000_fractional_inventory',
    '20260910145000_tablet_fulfillment',
  ])
    await db.exec(readFileSync('supabase/migrations/' + migration + '.sql', 'utf8'));
};

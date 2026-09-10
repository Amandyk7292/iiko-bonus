const { readFileSync } = require('node:fs');
module.exports = async (db) => {
  await db.exec(`create table customers(id uuid primary key);
    alter table kaspi_orders add column customer_id uuid,add column client_request_id uuid,
      add column amount numeric default 35,add column delivery_fee numeric default 0,
      add column partially_refunded_amount numeric default 0,add column refund_requested_at timestamptz,
      add column refund_error text;
    alter table order_partial_refunds alter column id set default gen_random_uuid(),
      add column idempotency_key uuid,add column processor_token uuid,add column amount numeric,
      add column reason text,add column requested_by text,add column created_at timestamptz default now(),
      add column completed_at timestamptz,add column error text;
    alter table order_partial_refund_items add column line_key text,add column product_name text,
      add column unit_amount numeric,add column refund_amount numeric;`);
  let sql = readFileSync(
    'supabase/migrations/20260728223000_analytics_substitution_workflow.sql',
    'utf8',
  );
  await db.exec(
    sql.slice(
      sql.indexOf('create table if not exists public.order_substitution_requests'),
      sql.indexOf('create index if not exists order_substitution_requests_order_idx'),
    ),
  );
  sql = readFileSync('supabase/migrations/20260729130000_order_substitution_execution.sql', 'utf8');
  await db.exec(sql.slice(0, sql.indexOf('create or replace function')));
  await db.exec(readFileSync('supabase/migrations/20260910146000_fractional_refunds.sql', 'utf8'));
};

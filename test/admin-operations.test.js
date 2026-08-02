const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('admin operations migration is mirrored and contains the support SLA contract', () => {
  const root = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260723120000_admin_operations_realtime.sql',
    ),
    'utf8',
  );
  const hosted = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260723120000_admin_operations_realtime.sql',
    ),
    'utf8',
  );

  assert.equal(root, hosted);
  assert.match(root, /create table if not exists public\.customer_support_messages/);
  assert.match(root, /first_responded_at timestamptz/);
  assert.match(root, /last_message_preview text/);
  assert.match(root, /customer_support_sla_queue_idx/);
  assert.match(root, /sync_customer_support_request_from_message/);
  assert.match(root, /create or replace function public\.get_admin_stats_scoped/);
  assert.match(root, /grant execute on function public\.get_admin_stats_scoped/);
});

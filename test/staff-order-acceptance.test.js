const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260813110000_staff_order_acceptance_reminder.sql',
  ),
  'utf8',
);

test('acceptance migration records an immutable first human acknowledgement', () => {
  assert.match(migration, /add column if not exists staff_acceptance_requested_at timestamptz/i);
  assert.match(migration, /add column if not exists staff_accepted_at timestamptz/i);
  assert.match(migration, /add column if not exists staff_accepted_by varchar\(160\)/i);
  assert.match(migration, /old\.kitchen_status = 'queued' and new\.kitchen_status = 'preparing'/i);
  assert.match(migration, /staff acceptance audit is immutable/i);
  assert.match(migration, /set staff_acceptance_requested_at = new\.created_at/i);
});

test('sixty-second reminder is durable, one-shot, branch scoped, and TTL bounded', () => {
  assert.match(migration, /create table if not exists public\.staff_push_reminder_outbox/i);
  assert.match(migration, /source_outbox_id uuid not null unique/i);
  assert.match(
    migration,
    /reminder_sequence smallint not null default 1 check \(reminder_sequence = 1\)/i,
  );
  assert.match(migration, /new\.created_at \+ interval '60 seconds'/i);
  assert.match(migration, /expires_at <= due_at \+ interval '14 minutes'/i);
  assert.match(migration, /device\.platform = 'ios'/i);
  assert.doesNotMatch(migration, /device\.last_seen_at/i);
  assert.match(migration, /orders\.kitchen_status = 'queued'/i);
  assert.match(migration, /create or replace function public\.begin_staff_push_reminder_dispatch/i);
});

test('acceptance cannot lock reminder rows and terminal outcomes enter durable alert health', () => {
  assert.match(migration, /drop trigger if exists kaspi_orders_resolve_staff_push_reminder/i);
  assert.doesNotMatch(migration, /create trigger kaspi_orders_resolve_staff_push_reminder/i);
  assert.match(migration, /create trigger staff_push_reminder_outbox_enqueue_terminal_alert/i);
  assert.match(migration, /'reminder_delivery_failed', 'reminder_delivery_uncertain'/i);
  assert.doesNotMatch(migration, /create or replace function public\.claim_staff_order_alerts_v2/i);
  assert.doesNotMatch(
    migration,
    /create or replace function public\.validate_staff_order_alert_claim_v2/i,
  );
  assert.match(migration, /create or replace function public\.claim_staff_order_alerts_v3/i);
  assert.match(
    migration,
    /create or replace function public\.validate_staff_order_alert_claim_v3/i,
  );
});

test('reminder storage and SECURITY DEFINER entry points are service-role only', () => {
  assert.match(
    migration,
    /alter table public\.staff_push_reminder_outbox enable row level security/i,
  );
  assert.match(
    migration,
    /alter table public\.staff_push_reminder_deliveries enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all on public\.staff_push_reminder_outbox,[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.maintain_staff_order_acceptance_audit\(\),[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.claim_staff_push_reminder_deliveries\(integer\),[\s\S]*to service_role/i,
  );
  for (const definition of migration.matchAll(
    /create or replace function[\s\S]*?security definer[\s\S]*?set search_path = ([^\n]+)/gi,
  )) {
    assert.equal(definition[1].trim(), 'public, pg_temp');
  }
});

test('runtime worker emits reminders through the established native staff route', () => {
  const service = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'staff-push.service.js'),
    'utf8',
  );
  const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const alerts = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'staff-order-alert.service.js'),
    'utf8',
  );
  assert.match(service, /async function flushStaffPushReminders/);
  assert.match(service, /type: 'staff\.order\.new'/);
  assert.match(service, /reminderSequence: String/);
  assert.match(service, /:reminder:\$\{row\.reminder_sequence \|\| 1\}/);
  assert.match(server, /flushStaffPushReminders\(100\)/);
  assert.match(alerts, /'reminder_delivery_failed'/);
  assert.match(alerts, /'reminder_delivery_uncertain'/);
});

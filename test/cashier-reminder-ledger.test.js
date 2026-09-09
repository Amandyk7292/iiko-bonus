const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table kaspi_orders(id uuid primary key, status text, kitchen_status text, fulfillment_status text);
    create table staff_push_reminder_outbox(id uuid primary key, order_id uuid,
      reminder_sequence smallint default 1 check(reminder_sequence=1), status text, due_at timestamptz,
      expires_at timestamptz, snapshotted_at timestamptz, sent_at timestamptz, last_error text, updated_at timestamptz);
    create table staff_push_reminder_deliveries(id uuid primary key, reminder_id uuid, status text,
      attempt_count smallint, next_attempt_at timestamptz, locked_at timestamptz, lease_token uuid,
      provider_message_id text, sent_at timestamptz, last_error text, updated_at timestamptz);
    create function claim_staff_push_reminder_deliveries(integer) returns void language sql as 'select';`);
  await db.exec(readFileSync('supabase/migrations/20260909231000_recurring_cashier_reminders.sql', 'utf8'));
});
test.after(() => db.close());
async function fixture({ accepted = false, sending = false } = {}) {
  const id = randomUUID();
  await db.query('insert into kaspi_orders values($1,$2,$3,$4)', [id, 'paid', accepted ? 'preparing' : 'queued', accepted ? 'preparing' : 'new']);
  await db.query("insert into staff_push_reminder_outbox(id,order_id,reminder_sequence,status,updated_at) values($1,$1,1,'sent',now()-interval '4 seconds')", [id]);
  await db.query("insert into staff_push_reminder_deliveries(id,reminder_id,status,attempt_count) values($1,$1,$2,1)", [id, sending ? 'dispatching' : 'sent']);
  return id;
}
test('rearms every three seconds without queuing duplicate cycles', async () => {
  const id = await fixture();
  await db.exec('select rearm_staff_push_reminders(); select rearm_staff_push_reminders();');
  let row = (await db.query('select * from staff_push_reminder_outbox where id=$1', [id])).rows[0];
  assert.equal(row.reminder_sequence, 2); assert.equal(row.status, 'queued');
  assert.equal(Date.parse(row.expires_at) - Date.parse(row.due_at), 15000);
  await db.query("update staff_push_reminder_outbox set status='sent',updated_at=now() where id=$1", [id]);
  await db.query("update staff_push_reminder_deliveries set status='sent' where id=$1", [id]);
  await db.exec('select rearm_staff_push_reminders()');
  row = (await db.query('select * from staff_push_reminder_outbox where id=$1', [id])).rows[0];
  assert.equal(row.reminder_sequence, 2);
  await db.query("update staff_push_reminder_outbox set updated_at=now()-interval '3 seconds' where id=$1", [id]);
  await db.exec('select rearm_staff_push_reminders()');
  assert.equal((await db.query('select reminder_sequence from staff_push_reminder_outbox where id=$1', [id])).rows[0].reminder_sequence, 3);
});
test('accepted/cancelled orders and an in-flight provider call never rearm', async () => {
  const accepted = await fixture({ accepted: true }), sending = await fixture({ sending: true }), cancelled = await fixture();
  await db.query("update kaspi_orders set fulfillment_status='cancelled' where id=$1", [cancelled]);
  await db.exec('select rearm_staff_push_reminders()');
  for (const id of [accepted, sending, cancelled]) {
    assert.equal((await db.query('select reminder_sequence from staff_push_reminder_outbox where id=$1', [id])).rows[0].reminder_sequence, 1);
  }
});

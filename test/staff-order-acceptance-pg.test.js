const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { Client } = require('pg');

const connectionString = String(process.env.STAFF_PUSH_PG_TEST_URL || '').trim();
const pgTest =
  connectionString && process.env.STAFF_PUSH_PG_TEST_CONFIRM === 'isolated' ? test : test.skip;

const hash64 = (value) => crypto.createHash('sha256').update(value).digest('hex');

pgTest('PG acceptance race keeps the first audit and cancels a claimed reminder', async (t) => {
  const setup = new Client({ connectionString });
  const first = new Client({ connectionString });
  const second = new Client({ connectionString });
  await Promise.all([setup.connect(), first.connect(), second.connect()]);

  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const branchId = crypto.randomUUID();
  const cashier = `acceptance_${suffix}`;
  const session = hash64(`acceptance-session-${suffix}`);
  const installation = `ipad.accept.${suffix}`;
  const bcryptShape = `$2b$12$${'a'.repeat(53)}`;
  const operation = `staff-acceptance-pg-${suffix}`;
  const orderNumber = 910000000 + Number.parseInt(suffix.slice(0, 6), 16);
  let orderId;
  let raceOrderId;
  let alertOrderId;

  t.after(async () => {
    const orderIds = [orderId, raceOrderId, alertOrderId].filter(Boolean);
    if (orderIds.length) {
      await setup
        .query('delete from public.kaspi_orders where id = any($1::uuid[])', [orderIds])
        .catch(() => {});
    }
    await setup
      .query('delete from public.admin_sessions where jti_hash = $1', [session])
      .catch(() => {});
    await setup
      .query('delete from public.admin_user_profiles where username = $1', [cashier])
      .catch(() => {});
    await setup
      .query('delete from public.bulka_locations where id = $1', [branchId])
      .catch(() => {});
    await Promise.allSettled([setup.end(), first.end(), second.end()]);
  });

  await setup.query(
    `insert into public.bulka_locations(id, city, name, address)
     values ($1, 'Oral', 'Acceptance PG', 'Test')`,
    [branchId],
  );
  await setup.query(
    `insert into public.admin_user_profiles(username, display_name, role, branch_ids)
     values ($1, 'Acceptance cashier', 'cashier', array[$2::uuid])`,
    [cashier, branchId],
  );
  await setup.query(
    `insert into public.admin_staff_credentials(username, password_hash, auth_version)
     values ($1, $2, 1)`,
    [cashier, bcryptShape],
  );
  await setup.query(
    `insert into public.admin_sessions(
       jti_hash, admin_subject, role, branch_ids, auth_version, expires_at
     ) values ($1, $2, 'cashier', array[$3::uuid], 1, now() + interval '1 hour')`,
    [session, cashier, branchId],
  );
  await setup.query(`select * from public.register_staff_push_device($1, $2, 'ios', $3)`, [
    session,
    `token-acceptance-${suffix}-1234567890`,
    installation,
  ]);
  // Reminder eligibility is durable enrollment + current authorization. A
  // backgrounded iPad may have an old heartbeat but must still get the FCM
  // reminder when it reconnects within the notification TTL.
  await setup.query(
    `update public.staff_push_devices
     set last_seen_at = now() - interval '1 day'
     where session_jti_hash = $1 and installation_id = $2`,
    [session, installation],
  );
  const inserted = await setup.query(
    `insert into public.kaspi_orders(
       order_number, operation_id, amount, phone, status, branch_id,
       fulfillment_status, kitchen_status
     ) values ($1, $2, 1000, '+70000000000', 'paid', $3, 'new', 'queued')
     returning id`,
    [orderNumber, operation, branchId],
  );
  orderId = inserted.rows[0].id;
  const requestedAt = await setup.query(
    `select orders.staff_acceptance_requested_at, outbox.created_at,
            reminder.id as reminder_id, reminder.source_outbox_id,
            reminder.due_at, reminder.expires_at,
            reminder.snapshotted_at
     from public.kaspi_orders orders
     inner join public.staff_push_outbox outbox on outbox.order_id = orders.id
     inner join public.staff_push_reminder_outbox reminder
       on reminder.source_outbox_id = outbox.id
     where orders.id = $1`,
    [orderId],
  );
  assert.ok(requestedAt.rows[0].staff_acceptance_requested_at);
  assert.equal(
    Date.parse(requestedAt.rows[0].staff_acceptance_requested_at),
    Date.parse(requestedAt.rows[0].created_at),
  );
  assert.equal(requestedAt.rows[0].snapshotted_at, null);
  assert.equal(
    Date.parse(requestedAt.rows[0].due_at) - Date.parse(requestedAt.rows[0].created_at),
    60 * 1000,
  );
  assert.ok(
    Date.parse(requestedAt.rows[0].expires_at) -
      Date.parse(requestedAt.rows[0].staff_acceptance_requested_at) <=
      15 * 60 * 1000,
  );

  const beforeDue = await setup.query(
    `select * from public.claim_staff_push_reminder_deliveries(20)
     where order_id = $1`,
    [orderId],
  );
  assert.equal(beforeDue.rowCount, 0);

  await setup.query(
    `update public.staff_push_reminder_outbox
     set due_at = now() - interval '1 second', expires_at = now() + interval '10 minutes'
     where order_id = $1`,
    [orderId],
  );
  const claimed = await setup.query(
    `select * from public.claim_staff_push_reminder_deliveries(20)
     where order_id = $1`,
    [orderId],
  );
  assert.equal(claimed.rowCount, 1);
  assert.equal(claimed.rows[0].reminder_sequence, 1);
  assert.equal(claimed.rows[0].reminder_id, requestedAt.rows[0].reminder_id);
  assert.notEqual(claimed.rows[0].reminder_id, requestedAt.rows[0].source_outbox_id);
  const duplicateClaim = await setup.query(
    `select * from public.claim_staff_push_reminder_deliveries(20)
     where order_id = $1`,
    [orderId],
  );
  assert.equal(duplicateClaim.rowCount, 0);
  assert.equal(
    Number(
      (
        await setup.query(
          `select count(*) from public.staff_push_reminder_deliveries
           where reminder_id = $1`,
          [claimed.rows[0].reminder_id],
        )
      ).rows[0].count,
    ),
    1,
  );

  await first.query('begin');
  await second.query('begin');
  const winner = await first.query(
    `update public.kaspi_orders
     set kitchen_status = 'preparing', fulfillment_status = 'preparing',
         staff_accepted_at = now(), staff_accepted_by = $2,
         staff_accepted_session_jti_hash = $3,
         staff_accepted_installation_id = $4
     where id = $1 and kitchen_status = 'queued'
     returning staff_accepted_at, staff_accepted_by, staff_accepted_installation_id`,
    [orderId, cashier, session, installation],
  );
  const losingUpdate = second.query(
    `update public.kaspi_orders
     set kitchen_status = 'preparing', fulfillment_status = 'preparing',
         staff_accepted_at = now(), staff_accepted_by = 'second-cashier'
     where id = $1 and kitchen_status = 'queued'
     returning staff_accepted_at`,
    [orderId],
  );
  await first.query('commit');
  const loser = await losingUpdate;
  await second.query('commit');
  assert.equal(winner.rowCount, 1);
  assert.equal(loser.rowCount, 0);

  const persisted = await setup.query(
    `select staff_accepted_at, staff_accepted_by, staff_accepted_installation_id
     from public.kaspi_orders where id = $1`,
    [orderId],
  );
  assert.equal(persisted.rows[0].staff_accepted_by, cashier);
  assert.equal(persisted.rows[0].staff_accepted_installation_id, installation);
  await assert.rejects(
    () =>
      setup.query(`update public.kaspi_orders set staff_accepted_by = 'tampered' where id = $1`, [
        orderId,
      ]),
    /staff acceptance audit is immutable/i,
  );

  const beginAfterAcceptance = await setup.query(
    `select public.begin_staff_push_reminder_dispatch($1, $2) as state`,
    [claimed.rows[0].delivery_id, claimed.rows[0].lease_token],
  );
  assert.equal(beginAfterAcceptance.rows[0].state, 'skipped');
  const reminder = await setup.query(
    `select status from public.staff_push_reminder_outbox where order_id = $1`,
    [orderId],
  );
  assert.equal(reminder.rows[0].status, 'skipped');

  const racedInsert = await setup.query(
    `insert into public.kaspi_orders(
       order_number, operation_id, amount, phone, status, branch_id,
       fulfillment_status, kitchen_status
     ) values ($1, $2, 1000, '+70000000000', 'paid', $3, 'new', 'queued')
     returning id`,
    [orderNumber + 1, `${operation}-race`, branchId],
  );
  raceOrderId = racedInsert.rows[0].id;
  await setup.query(
    `update public.staff_push_reminder_outbox
     set due_at = now() - interval '1 second', expires_at = now() + interval '10 minutes'
     where order_id = $1`,
    [raceOrderId],
  );
  const raceClaim = await setup.query(
    `select * from public.claim_staff_push_reminder_deliveries(20)
     where order_id = $1`,
    [raceOrderId],
  );
  assert.equal(raceClaim.rowCount, 1);
  await Promise.all([
    first.query(`set lock_timeout = '3s'`),
    second.query(`set lock_timeout = '3s'`),
  ]);
  const [raceAcceptance, raceDispatch] = await Promise.all([
    first.query(
      `update public.kaspi_orders
       set kitchen_status = 'preparing', fulfillment_status = 'preparing',
           staff_accepted_at = now(), staff_accepted_by = $2,
           staff_accepted_session_jti_hash = $3,
           staff_accepted_installation_id = $4
       where id = $1 and kitchen_status = 'queued'
       returning staff_accepted_at`,
      [raceOrderId, cashier, session, installation],
    ),
    second.query(`select public.begin_staff_push_reminder_dispatch($1, $2) as state`, [
      raceClaim.rows[0].delivery_id,
      raceClaim.rows[0].lease_token,
    ]),
  ]);
  assert.equal(raceAcceptance.rowCount, 1);
  assert.match(raceDispatch.rows[0].state, /^(dispatching|skipped)$/);
  if (raceDispatch.rows[0].state === 'dispatching') {
    const completed = await setup.query(
      `select public.complete_staff_push_reminder_delivery(
         $1, $2, 'skipped', 'Order accepted during dispatch race', null, null
       ) as completed`,
      [raceClaim.rows[0].delivery_id, raceClaim.rows[0].lease_token],
    );
    assert.equal(completed.rows[0].completed, true);
  }

  const alertInsert = await setup.query(
    `insert into public.kaspi_orders(
       order_number, operation_id, amount, phone, status, branch_id,
       fulfillment_status, kitchen_status
     ) values ($1, $2, 1000, '+70000000000', 'paid', $3, 'new', 'queued')
     returning id`,
    [orderNumber + 2, `${operation}-alert`, branchId],
  );
  alertOrderId = alertInsert.rows[0].id;
  const terminalReminder = await setup.query(
    `update public.staff_push_reminder_outbox
     set status = 'failed', last_error = 'test terminal failure'
     where order_id = $1
     returning id`,
    [alertOrderId],
  );
  assert.equal(terminalReminder.rowCount, 1);
  const terminalAlert = await setup.query(
    `select id, alert_type, dedupe_key
     from public.staff_order_alerts
     where order_id = $1 and alert_type = 'reminder_delivery_failed'`,
    [alertOrderId],
  );
  assert.equal(terminalAlert.rowCount, 1);
  assert.equal(
    terminalAlert.rows[0].dedupe_key,
    `reminder-terminal:${terminalReminder.rows[0].id}:failed`,
  );
  const legacyAlertClaims = await setup.query(
    `select * from public.claim_staff_order_alerts_v2(200, 120)`,
  );
  assert.equal(
    legacyAlertClaims.rows.some((row) => row.alert_id === terminalAlert.rows[0].id),
    false,
  );
  const alertClaims = await setup.query(
    `select * from public.claim_staff_order_alerts_v3(200, 120)`,
  );
  const claimedAlert = alertClaims.rows.find((row) => row.alert_id === terminalAlert.rows[0].id);
  assert.ok(claimedAlert);
  const alertValid = await setup.query(
    `select public.validate_staff_order_alert_claim_v3($1, $2, 120) as valid`,
    [claimedAlert.alert_id, claimedAlert.lease_token],
  );
  assert.equal(alertValid.rows[0].valid, true);
});

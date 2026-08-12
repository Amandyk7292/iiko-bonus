const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { Client } = require('pg');

const connectionString = String(process.env.STAFF_PUSH_PG_TEST_URL || '').trim();
const pgTest =
  connectionString && process.env.STAFF_PUSH_PG_TEST_CONFIRM === 'isolated' ? test : test.skip;

const hash64 = (value) => crypto.createHash('sha256').update(value).digest('hex');

pgTest(
  'PG16 staff push closes registration races, bounds age and rechecks acceptance',
  async (t) => {
    const setup = new Client({ connectionString });
    const orderTransaction = new Client({ connectionString });
    const registrationTransaction = new Client({ connectionString });
    await Promise.all([
      setup.connect(),
      orderTransaction.connect(),
      registrationTransaction.connect(),
    ]);

    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const branchA = crypto.randomUUID();
    const branchB = crypto.randomUUID();
    const cashierA = `cashier_${suffix}_a`;
    const cashierB = `cashier_${suffix}_b`;
    const sessionA = hash64(`session-a-${suffix}`);
    const sessionB = hash64(`session-b-${suffix}`);
    const bcryptShape = `$2b$12$${'a'.repeat(53)}`;
    const operation = (name) => `staff-push-pg-${suffix}-${name}`;
    const orderNumberStart = 900000000 + Number.parseInt(suffix.slice(0, 6), 16);
    let orderNumberOffset = 0;
    const insertPaidOrder = async (client, name, branchId, fulfillmentStatus) => {
      orderNumberOffset += 1;
      return client.query(
        `insert into public.kaspi_orders(
         order_number, operation_id, amount, phone, status, branch_id,
         fulfillment_status, kitchen_status
       ) values ($1, $2, 1000, '+70000000000', 'paid', $3, $4, 'queued')
       returning id`,
        [orderNumberStart + orderNumberOffset, operation(name), branchId, fulfillmentStatus],
      );
    };

    t.after(async () => {
      await setup
        .query('delete from public.kaspi_orders where operation_id like $1', [
          `staff-push-pg-${suffix}-%`,
        ])
        .catch(() => undefined);
      await setup
        .query('delete from public.admin_sessions where jti_hash = any($1::text[])', [
          [sessionA, sessionB],
        ])
        .catch(() => undefined);
      await setup
        .query('delete from public.admin_user_profiles where username = any($1::text[])', [
          [cashierA, cashierB],
        ])
        .catch(() => undefined);
      await setup
        .query('delete from public.bulka_locations where id = any($1::uuid[])', [
          [branchA, branchB],
        ])
        .catch(() => undefined);
      await Promise.allSettled([
        setup.end(),
        orderTransaction.end(),
        registrationTransaction.end(),
      ]);
    });

    await setup.query(
      `insert into public.bulka_locations(id, city, name, address)
     values ($1, 'Oral', 'PG A', 'Test A'), ($2, 'Oral', 'PG B', 'Test B')`,
      [branchA, branchB],
    );
    await setup.query(
      `insert into public.admin_user_profiles(username, display_name, role, branch_ids)
     values ($1, 'PG cashier A', 'cashier', array[$2::uuid]),
            ($3, 'PG cashier B', 'cashier', array[$4::uuid])`,
      [cashierA, branchA, cashierB, branchB],
    );
    await setup.query(
      `insert into public.admin_staff_credentials(username, password_hash, auth_version)
     values ($1, $2, 1), ($3, $2, 1)`,
      [cashierA, bcryptShape, cashierB],
    );
    await setup.query(
      `insert into public.admin_sessions(
       jti_hash, admin_subject, role, branch_ids, auth_version, expires_at
     ) values
       ($1, $2, 'cashier', array[$3::uuid], 1, now() + interval '1 hour'),
       ($4, $5, 'cashier', array[$6::uuid], 1, now() + interval '1 hour')`,
      [sessionA, cashierA, branchA, sessionB, cashierB, branchB],
    );

    // Force the READ COMMITTED write-skew: the paid trigger runs before the
    // uncommitted registration exists, while registration runs before the
    // uncommitted paid outbox is visible.
    await orderTransaction.query('begin');
    const raceOrder = await insertPaidOrder(orderTransaction, 'race', branchA, 'new');
    await registrationTransaction.query('begin');
    await registrationTransaction.query(
      `select * from public.register_staff_push_device($1, $2, 'ios', $3)`,
      [sessionA, `token-race-${suffix}-1234567890`, `ipad.race.${suffix}`],
    );
    // Coverage episodes use a branch-specific lock and registration uses its
    // own enrollment lock, so both transactions can finish without global
    // serialization while initially missing each other's uncommitted row.
    await registrationTransaction.query('commit');
    await orderTransaction.query('commit');

    const beforeReconcile = await setup.query(
      `select count(*)::integer as count
     from public.staff_push_deliveries delivery
     inner join public.staff_push_outbox outbox on outbox.id = delivery.outbox_id
     where outbox.order_id = $1`,
      [raceOrder.rows[0].id],
    );
    assert.equal(beforeReconcile.rows[0].count, 0);

    const reconciled = await setup.query(
      `select * from public.claim_staff_push_deliveries_v2(20)
     where order_id = $1`,
      [raceOrder.rows[0].id],
    );
    assert.equal(reconciled.rowCount, 1);
    assert.ok(Date.parse(reconciled.rows[0].expires_at) > Date.now());

    const registeredAgain = await setup.query(
      `select * from public.register_staff_push_device($1, $2, 'ios', $3)`,
      [sessionA, `token-race-${suffix}-0987654321`, `ipad.race.${suffix}`],
    );
    assert.equal(registeredAgain.rowCount, 1, 'registration upsert remains executable on PG16');
    await setup.query(
      `update public.staff_push_devices
       set last_seen_at = now() - interval '91 seconds'
       where session_jti_hash = $1`,
      [sessionA],
    );
    assert.equal(
      (await setup.query('select public.branch_has_active_staff_ipad($1) as active', [branchA]))
        .rows[0].active,
      false,
    );
    const heartbeat = await setup.query(
      `select public.touch_staff_push_device_heartbeat($1, 'ios', $2) as touched`,
      [sessionA, `ipad.race.${suffix}`],
    );
    assert.equal(heartbeat.rows[0].touched, true);
    assert.equal(
      (await setup.query('select public.branch_has_active_staff_ipad($1) as active', [branchA]))
        .rows[0].active,
      true,
    );
    assert.equal(
      (
        await setup.query(
          `select public.touch_staff_push_device_heartbeat($1, 'ios', $2) as touched`,
          [sessionA, `wrong.${suffix}`],
        )
      ).rows[0].touched,
      false,
    );
    await setup.query(
      'update public.admin_staff_credentials set auth_version = 2 where username = $1',
      [cashierA],
    );
    assert.equal(
      (await setup.query('select public.branch_has_active_staff_ipad($1) as active', [branchA]))
        .rows[0].active,
      false,
    );
    await setup.query(
      'update public.admin_staff_credentials set auth_version = 1 where username = $1',
      [cashierA],
    );
    await setup.query(
      `update public.admin_sessions set expires_at = now() - interval '1 second'
       where jti_hash = $1`,
      [sessionA],
    );
    assert.equal(
      (await setup.query('select public.branch_has_active_staff_ipad($1) as active', [branchA]))
        .rows[0].active,
      false,
    );
    await setup.query(
      `update public.admin_sessions set expires_at = now() + interval '1 hour'
       where jti_hash = $1`,
      [sessionA],
    );

    await setup.query(
      `update public.kaspi_orders set fulfillment_status = 'accepted' where id = $1`,
      [raceOrder.rows[0].id],
    );
    const acceptedBegin = await setup.query(
      `select public.begin_staff_push_delivery_dispatch_v2($1, $2) as state`,
      [reconciled.rows[0].delivery_id, reconciled.rows[0].lease_token],
    );
    assert.equal(acceptedBegin.rows[0].state, 'skipped');

    // Branch B has no device yet. Registration must attach the 14-minute-old
    // order (~one minute remaining), but not expired or already accepted work.
    const orders = {};
    for (const [name, status] of [
      ['fresh', 'new'],
      ['expired', 'new'],
      ['accepted', 'accepted'],
    ]) {
      const inserted = await insertPaidOrder(setup, name, branchB, status);
      orders[name] = inserted.rows[0].id;
    }
    await setup.query(
      `update public.staff_push_outbox
     set created_at = now() - interval '14 minutes',
         expires_at = now() + interval '1 minute'
     where order_id = $1`,
      [orders.fresh],
    );
    await setup.query(
      `update public.staff_push_outbox
     set created_at = now() - interval '16 minutes',
         expires_at = now() - interval '1 minute'
     where order_id = $1`,
      [orders.expired],
    );
    await setup.query(`select * from public.register_staff_push_device($1, $2, 'ios', $3)`, [
      sessionB,
      `token-late-${suffix}-1234567890`,
      `ipad.late.${suffix}`,
    ]);

    const attached = await setup.query(
      `select outbox.order_id, delivery.status, outbox.expires_at
     from public.staff_push_deliveries delivery
     inner join public.staff_push_outbox outbox on outbox.id = delivery.outbox_id
     inner join public.staff_push_devices device on device.id = delivery.device_id
     where device.session_jti_hash = $1`,
      [sessionB],
    );
    assert.deepEqual(
      attached.rows.map((row) => row.order_id),
      [orders.fresh],
    );
    const remainingMs = Date.parse(attached.rows[0].expires_at) - Date.now();
    assert.ok(remainingMs > 0 && remainingMs <= 60 * 1000);

    // Payment snapshots only a fully current cashier enrollment. An active
    // row whose session/auth has expired is sanitized and never attached.
    await setup.query(
      `update public.admin_sessions set expires_at = now() - interval '1 second'
       where jti_hash = $1`,
      [sessionB],
    );
    const unauthorizedPaid = await insertPaidOrder(setup, 'unauthorized-paid', branchB, 'new');
    const unauthorizedDeliveries = await setup.query(
      `select count(*)::integer as count
       from public.staff_push_deliveries delivery
       inner join public.staff_push_outbox outbox on outbox.id = delivery.outbox_id
       where outbox.order_id = $1`,
      [unauthorizedPaid.rows[0].id],
    );
    assert.equal(unauthorizedDeliveries.rows[0].count, 0);
    assert.equal(
      (await setup.query('select public.sanitize_stale_staff_push_devices(1000) as count')).rows[0]
        .count,
      1,
    );
    const sanitized = await setup.query(
      `select active, revoked_at is not null as revoked,
              token = 'staff-device-revoked:' || id::text as tombstoned
       from public.staff_push_devices where session_jti_hash = $1`,
      [sessionB],
    );
    assert.deepEqual(sanitized.rows[0], { active: false, revoked: true, tombstoned: true });
    await setup.query(
      `update public.admin_sessions set expires_at = now() + interval '1 hour'
       where jti_hash = $1`,
      [sessionB],
    );
    await setup.query(`select * from public.register_staff_push_device($1, $2, 'ios', $3)`, [
      sessionB,
      `token-late-${suffix}-0987654321`,
      `ipad.late.${suffix}`,
    ]);

    await setup.query(
      `update public.kaspi_orders set fulfillment_status = 'pending' where id = $1`,
      [orders.fresh],
    );
    const pendingClaim = await setup.query(
      `select * from public.claim_staff_push_deliveries_v2(20)
     where order_id = $1`,
      [orders.fresh],
    );
    assert.equal(pendingClaim.rowCount, 1, 'a pending paid order is attached and claimable');

    const terminalOrders = {};
    for (const name of ['failed-with-sent', 'uncertain-with-sent', 'failed-without-sent']) {
      terminalOrders[name] = (await insertPaidOrder(setup, name, branchB, 'new')).rows[0].id;
    }
    for (const name of ['failed-with-sent', 'uncertain-with-sent']) {
      await setup.query(
        `update public.staff_push_deliveries
         set status = 'sent', sent_at = now()
         where outbox_id = (select id from public.staff_push_outbox where order_id = $1)`,
        [terminalOrders[name]],
      );
    }
    await setup.query(`update public.staff_push_outbox set status = 'failed' where order_id = $1`, [
      terminalOrders['failed-with-sent'],
    ]);
    await setup.query(
      `update public.staff_push_outbox set status = 'uncertain' where order_id = $1`,
      [terminalOrders['uncertain-with-sent']],
    );
    await setup.query(
      `update public.staff_push_deliveries set status = 'failed'
       where outbox_id = (select id from public.staff_push_outbox where order_id = $1)`,
      [terminalOrders['failed-without-sent']],
    );
    await setup.query(`update public.staff_push_outbox set status = 'failed' where order_id = $1`, [
      terminalOrders['failed-without-sent'],
    ]);
    const terminalAlerts = await setup.query(
      `select order_id, alert_type from public.staff_order_alerts
       where order_id = any($1::uuid[])
       order by order_id, alert_type`,
      [Object.values(terminalOrders)],
    );
    assert.deepEqual(
      terminalAlerts.rows.map((row) => [row.order_id, row.alert_type]),
      [
        [terminalOrders['uncertain-with-sent'], 'delivery_uncertain'],
        [terminalOrders['failed-without-sent'], 'delivery_failed'],
      ].sort(([left], [right]) => left.localeCompare(right)),
    );

    // A later requeue and real failure is a new durable terminal episode;
    // repeating the same terminal status is not.
    await setup.query(`update public.staff_push_outbox set status = 'queued' where order_id = $1`, [
      terminalOrders['failed-without-sent'],
    ]);
    await setup.query(`update public.staff_push_outbox set status = 'failed' where order_id = $1`, [
      terminalOrders['failed-without-sent'],
    ]);
    const terminalEpisodes = await setup.query(
      `select alert.id, alert.status, alert.dedupe_key
       from public.staff_order_alerts alert
       where alert.order_id = $1 and alert.alert_type = 'delivery_failed'
       order by alert.created_at, alert.id`,
      [terminalOrders['failed-without-sent']],
    );
    assert.equal(terminalEpisodes.rowCount, 2);
    const staleLease = crypto.randomUUID();
    await setup.query(
      `update public.staff_order_alerts
       set status = 'processing', lease_token = $2, locked_at = now()
       where id = $1`,
      [terminalEpisodes.rows[0].id, staleLease],
    );
    const staleEpisodeValid = await setup.query(
      `select public.validate_staff_order_alert_claim($1, $2, 120) as valid`,
      [terminalEpisodes.rows[0].id, staleLease],
    );
    assert.equal(staleEpisodeValid.rows[0].valid, false);
    assert.equal(
      (
        await setup.query(`select status from public.staff_order_alerts where id = $1`, [
          terminalEpisodes.rows[0].id,
        ])
      ).rows[0].status,
      'resolved',
    );
    await setup.query(`update public.staff_push_outbox set status = 'failed' where order_id = $1`, [
      terminalOrders['failed-without-sent'],
    ]);
    const repeatTerminal = await setup.query(
      `select count(*)::integer as count,
              max(outbox.terminal_alert_episode)::integer as episode
       from public.staff_order_alerts alert
       inner join public.staff_push_outbox outbox on outbox.order_id = alert.order_id
       where alert.order_id = $1 and alert.alert_type = 'delivery_failed'`,
      [terminalOrders['failed-without-sent']],
    );
    assert.deepEqual(repeatTerminal.rows[0], { count: 2, episode: 2 });

    // SLA uses outbox.created_at, the durable paid-transition timestamp.
    const sla119 = await insertPaidOrder(setup, 'sla119', branchB, 'new');
    await setup.query(
      `update public.staff_push_outbox
       set created_at = now() - interval '119 seconds',
           expires_at = now() - interval '119 seconds' + interval '15 minutes'
       where order_id = $1`,
      [sla119.rows[0].id],
    );
    await setup.query('select public.enqueue_due_staff_order_alerts(120)');
    assert.equal(
      Number(
        (
          await setup.query(
            `select count(*) from public.staff_order_alerts
             where order_id = $1 and alert_type = 'order_unaccepted'`,
            [sla119.rows[0].id],
          )
        ).rows[0].count,
      ),
      0,
    );
    await setup.query(
      `update public.staff_push_outbox
       set created_at = now() - interval '120 seconds',
           expires_at = now() - interval '120 seconds' + interval '15 minutes'
       where order_id = $1`,
      [sla119.rows[0].id],
    );
    await setup.query('select public.enqueue_due_staff_order_alerts(120)');
    assert.equal(
      Number(
        (
          await setup.query(
            `select count(*) from public.staff_order_alerts
             where order_id = $1 and alert_type = 'order_unaccepted'`,
            [sla119.rows[0].id],
          )
        ).rows[0].count,
      ),
      1,
    );

    const claimedAlert = await setup.query(
      `select * from public.claim_staff_order_alerts(50, 120)
       where order_id = $1 and alert_type = 'order_unaccepted'`,
      [sla119.rows[0].id],
    );
    assert.equal(claimedAlert.rowCount, 1);
    await setup.query(
      `update public.kaspi_orders
       set fulfillment_status = 'preparing', kitchen_status = 'preparing'
       where id = $1`,
      [sla119.rows[0].id],
    );
    const acceptedAlert = await setup.query(
      `select public.validate_staff_order_alert_claim($1, $2, 120) as valid`,
      [claimedAlert.rows[0].alert_id, claimedAlert.rows[0].lease_token],
    );
    assert.equal(acceptedAlert.rows[0].valid, false);

    // One open no-iPad alert exists per branch outage, regardless of how many
    // paid orders arrive. Restoring enrollment resolves it; losing the last
    // token opens exactly one new episode.
    const episodeTotal = async () =>
      Number(
        (
          await setup.query(
            `select count(*) from public.staff_order_alert_branch_episodes
             where branch_id = $1`,
            [branchA],
          )
        ).rows[0].count,
      );
    const baselineEpisodes = await episodeTotal();
    await setup.query('select public.deactivate_invalid_staff_push_token($1)', [
      `token-race-${suffix}-0987654321`,
    ]);
    const outageA = await insertPaidOrder(setup, 'outage-a', branchA, 'new');
    await insertPaidOrder(setup, 'outage-b', branchA, 'new');
    await setup.query('select public.enqueue_due_staff_order_alerts(120)');
    const activeEpisodeCount = async () =>
      Number(
        (
          await setup.query(
            `select count(*) from public.staff_order_alert_branch_episodes
             where branch_id = $1 and resolved_at is null`,
            [branchA],
          )
        ).rows[0].count,
      );
    assert.equal(await activeEpisodeCount(), 1);
    await setup.query(`select * from public.register_staff_push_device($1, $2, 'ios', $3)`, [
      sessionA,
      `token-restored-${suffix}-1234567890`,
      `ipad.race.${suffix}`,
    ]);
    await setup.query('select public.enqueue_due_staff_order_alerts(120)');
    assert.equal(await activeEpisodeCount(), 0);
    await setup.query('select public.deactivate_invalid_staff_push_token($1)', [
      `token-restored-${suffix}-1234567890`,
    ]);
    await setup.query('select public.enqueue_due_staff_order_alerts(120)');
    assert.equal(await activeEpisodeCount(), 1);
    assert.equal(await episodeTotal(), baselineEpisodes + 2);
    assert.ok(outageA.rows[0].id);
    const detectedIncident = await setup.query(
      `select alert.event_at
       from public.staff_order_alert_branch_episodes episode
       inner join public.staff_order_alerts alert on alert.id = episode.alert_id
       where episode.branch_id = $1 and episode.resolved_at is null`,
      [branchA],
    );
    assert.ok(
      Date.now() - Date.parse(detectedIncident.rows[0].event_at) < 10_000,
      'coverage-loss event time reflects detection, not an old order payment',
    );

    const activeIncident = await setup.query(
      `select alert_id
       from public.staff_order_alert_branch_episodes
       where branch_id = $1 and resolved_at is null`,
      [branchA],
    );
    await setup.query(
      `update public.staff_order_alerts
       set status = 'sent', sent_at = now() - interval '31 days',
           updated_at = now() - interval '31 days'
       where id = $1`,
      [activeIncident.rows[0].alert_id],
    );

    // Terminal alert history is retained for 30 days and then removed in a
    // bounded batch. Historical branch episodes cascade with their alert.
    const expiredAlert = await setup.query(
      `insert into public.staff_order_alerts(
         order_id, branch_id, order_number, alert_type, status, dedupe_key,
         event_at, resolved_at, updated_at
       ) values (
         $1, $2, $3, 'no_active_ipad', 'resolved', $4,
         now() - interval '31 days', now() - interval '31 days',
         now() - interval '31 days'
       ) returning id`,
      [
        outageA.rows[0].id,
        branchA,
        orderNumberStart + orderNumberOffset,
        `retention-expired-${suffix}`,
      ],
    );
    await setup.query(
      `insert into public.staff_order_alert_branch_episodes(
         branch_id, alert_type, alert_id, opened_at, resolved_at, updated_at
       ) values (
         $1, 'no_active_ipad', $2,
         now() - interval '31 days', now() - interval '31 days',
         now() - interval '31 days'
       )`,
      [branchA, expiredAlert.rows[0].id],
    );
    const retainedAlert = await setup.query(
      `insert into public.staff_order_alerts(
         order_id, branch_id, order_number, alert_type, status, dedupe_key,
         event_at, sent_at, updated_at
       ) values (
         $1, $2, $3, 'order_unaccepted', 'sent', $4,
         now() - interval '29 days', now() - interval '29 days',
         now() - interval '29 days'
       ) returning id`,
      [
        outageA.rows[0].id,
        branchA,
        orderNumberStart + orderNumberOffset,
        `retention-current-${suffix}`,
      ],
    );
    await setup.query('select public.enqueue_due_staff_order_alerts(120)');
    const retentionState = await setup.query(
      `select
         exists(select 1 from public.staff_order_alerts where id = $1) as expired_alert,
         exists(select 1 from public.staff_order_alert_branch_episodes where alert_id = $1)
           as expired_episode,
         exists(select 1 from public.staff_order_alerts where id = $2) as retained_alert,
         exists(select 1 from public.staff_order_alerts where id = $3)
           as active_incident_alert`,
      [expiredAlert.rows[0].id, retainedAlert.rows[0].id, activeIncident.rows[0].alert_id],
    );
    assert.deepEqual(retentionState.rows[0], {
      expired_alert: false,
      expired_episode: false,
      retained_alert: true,
      active_incident_alert: true,
    });
  },
);

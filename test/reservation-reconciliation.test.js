const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ReservationReconciliationService,
} = require('../src/services/reservation-reconciliation.service');
const {
  registerWorker,
  runMonitoredWorker,
  workerSnapshot,
} = require('../src/services/operational-health.service');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('reservation reconciliation clamps the batch and normalizes RPC counters', async () => {
  const calls = [];
  const events = [];
  const service = new ReservationReconciliationService({
    db: {
      rpc: async (name, params) => {
        calls.push([name, params]);
        return {
          data: {
            candidates: '3',
            ordersReleased: 2,
            inventoryReservationsReleased: '4',
            slotReservationsReleased: 2,
          },
          error: null,
        };
      },
    },
    loggerInstance: { info: (details) => events.push(details) },
  });

  const summary = await service.reconcileClosedOrders({ limit: 50_000 });

  assert.deepEqual(calls, [['reconcile_closed_order_reservations', { p_limit: 1000 }]]);
  assert.deepEqual(summary, {
    candidates: 3,
    ordersReleased: 2,
    inventoryReservationsReleased: 4,
    slotReservationsReleased: 2,
  });
  assert.equal(events[0].event, 'closed_order_reservations_reconciled');
});

test('reservation reconciliation failures are visible in monitored worker health', async () => {
  const databaseError = Object.assign(new Error('database unavailable'), { code: '08006' });
  const service = new ReservationReconciliationService({
    db: { rpc: async () => ({ data: null, error: databaseError }) },
    loggerInstance: { info: () => undefined },
  });
  const workerName = 'test-reservation-reconciliation-failure';
  registerWorker(workerName, { intervalMs: 1000 });

  await runMonitoredWorker(workerName, () => service.reconcileClosedOrders());

  const worker = workerSnapshot().find((entry) => entry.name === workerName);
  assert.equal(worker.runs, 1);
  assert.equal(worker.failures, 1);
  assert.equal(worker.lastErrorCode, 'RESERVATION_RECONCILIATION_FAILED');
});

test('database reconciliation locks, rechecks and idempotently releases both reservation types', () => {
  const sql = read(
    'supabase/migrations/20260808120000_closed_order_reservation_reconciliation.sql',
  );

  assert.match(sql, /status in \('active', 'committed'\)/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(candidate\.order_id::text, 0\)\)/i);
  assert.match(sql, /from public\.kaspi_orders as orders[\s\S]*for update;/i);
  assert.match(sql, /payment_status in \('refunded', 'failed', 'expired'\)/i);
  assert.match(sql, /'Срок оплаты истёк', 'Оплата не прошла'/u);
  assert.match(
    sql,
    /coalesce\(order_updated_at, '-infinity'::timestamptz\)[\s\S]*> now\(\) - interval '5 minutes'/i,
  );
  assert.equal(
    (
      sql.match(
        /where order_id = candidate\.order_id and status in \('active', 'committed'\);/gi,
      ) || []
    ).length,
    2,
  );
  assert.match(sql, /set status = 'released', updated_at = now\(\)/i);
  assert.match(sql, /'inventoryReservationsReleased', total_inventory_released/i);
  assert.match(sql, /'slotReservationsReleased', total_slots_released/i);
  assert.match(sql, /grant execute[\s\S]*to service_role;/i);
});

test('server registers reservation reconciliation as a critical monitored worker', () => {
  const server = read('src/server.js');

  assert.match(
    server,
    /runMonitoredWorker\('reservation-reconciliation', reconcileClosedOrderReservations\)/,
  );
  assert.match(server, /registerWorker\('reservation-reconciliation',[\s\S]{0,180}?critical: true/);
  assert.match(server, /RESERVATION_RECONCILIATION_INTERVAL_MS/);
});

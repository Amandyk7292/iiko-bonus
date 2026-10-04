const test = require('node:test');
const assert = require('node:assert/strict');
const { createDigestWorker } = require('../src/services/branch-photo-digest-worker.service');

// Durable store boundary: several worker instances share the same persisted rows.
function harness({
  sendTime = '09:00',
  ownerUserId = 'owner',
  parts = ['Сводка'],
  generateFailure = false,
} = {}) {
  const state = {
    settings: { sendTime, timeZone: 'Asia/Oral', ownerUserId },
    snapshots: new Map(),
    rows: [],
    disabled: new Set(),
    cooldown: 0,
    sequence: 0,
    allowed: true,
    completeFailure: false,
    markFailure: false,
  };
  const calls = { generate: [], sent: [], failed: [] };
  let time = Date.parse('2026-10-06T04:00:00Z');
  const store = {
    async getSettings() {
      return state.settings;
    },
    async digestExists(date) {
      return state.snapshots.has(date);
    },
    async enqueueDigest(date, messages) {
      if (state.snapshots.has(date)) return { enqueued: false, count: 0 };
      state.snapshots.set(date, messages.slice());
      for (const [partIndex, text] of messages.entries())
        state.rows.push({
          id: `row-${state.rows.length}`,
          reportDate: date,
          partIndex,
          text,
          chatId: '12345',
          recipientId: 'recipient',
          status: 'pending',
          due: 0,
        });
      return { enqueued: true, count: messages.length };
    },
    async claimDeliveries(limit, { now }) {
      assert.equal(limit, 1);
      const at = now.getTime();
      for (const row of state.rows)
        if (row.status === 'sending' && row.leaseUntil <= at) row.status = 'uncertain';
      if (state.cooldown > at) return [];
      const row = state.rows.find(
        (item) =>
          ['pending', 'retry'].includes(item.status) &&
          item.due <= at &&
          !state.disabled.has(item.recipientId),
      );
      if (!row) return [];
      row.status = 'sending';
      row.leaseUntil = at + 90000;
      row.leaseToken = `lease-${++state.sequence}`;
      return [{ ...row }];
    },
    async deliveryAuthorized(id, token) {
      const row = state.rows.find((item) => item.id === id);
      return state.allowed && row.leaseToken === token && !state.disabled.has(row.recipientId);
    },
    async completeDelivery(id, token, messageId) {
      if (state.completeFailure) throw new Error('acknowledgement unavailable');
      const row = state.rows.find((item) => item.id === id);
      assert.equal(row.leaseToken, token);
      assert.ok(messageId);
      row.status = 'sent';
      return true;
    },
    async failDelivery(id, token, outcome, { now }) {
      calls.failed.push(outcome);
      if (state.markFailure) throw new Error('state unavailable');
      const row = state.rows.find((item) => item.id === id);
      assert.equal(row.leaseToken, token);
      row.status = outcome.uncertain ? 'uncertain' : outcome.permanent ? 'failed' : 'retry';
      if (outcome.retryAfter) {
        row.due = now.getTime() + outcome.retryAfter * 1000;
        state.cooldown = Math.max(state.cooldown, row.due);
      }
      return true;
    },
    async disableRecipient(id) {
      state.disabled.add(id);
      for (const row of state.rows)
        if (row.recipientId === id && ['pending', 'retry', 'sending'].includes(row.status))
          row.status = 'failed';
      return true;
    },
    async getUnresolvedDeliveryCounts() {
      const rows = state.rows.filter(
        (row) => state.allowed && !state.disabled.has(row.recipientId),
      );
      return {
        uncertain: rows.filter((row) => row.status === 'uncertain').length,
        failed: rows.filter((row) => row.status === 'failed').length,
      };
    },
  };
  const generate = async (date) => {
    calls.generate.push(date);
    if (generateFailure) throw new Error('report read unavailable');
    return { parts };
  };
  const worker = (send = async () => ({ status: 'sent', messageId: 1 }), extra = {}) =>
    createDigestWorker({
      store,
      generate,
      db: {},
      now: () => new Date(time),
      sendMessage: async (...args) => {
        calls.sent.push(args);
        return send(...args);
      },
      ...extra,
    });
  return {
    state,
    calls,
    store,
    worker,
    setTime: (at) => {
      time = Date.parse(at);
    },
  };
}

test('worker schedules previous calendar day at09:00, persists once, and does not resend after restart', async () => {
  const h = harness();
  h.setTime('2026-10-06T03:59:59Z');
  assert.equal((await h.worker().tick()).enqueued, false);
  assert.deepEqual(h.calls.generate, []);
  h.setTime('2026-10-06T04:00:00Z');
  const first = await h.worker().tick();
  assert.equal(first.date, '2026-10-05');
  assert.equal(first.enqueued, true);
  assert.equal(first.delivered, 1);
  await h.worker().tick();
  assert.deepEqual(h.calls.generate, ['2026-10-05']);
  assert.equal(h.calls.sent.length, 1);
});

test('midnight scheduling uses calendar yesterday before04:00 and bootstrap waits for an owner', async () => {
  const h = harness({ sendTime: '00:00', ownerUserId: null });
  h.setTime('2026-12-31T19:00:00Z');
  await h.worker().tick();
  assert.equal(h.state.snapshots.size, 0);
  h.state.settings.ownerUserId = 'owner';
  const result = await h.worker().tick();
  assert.equal(result.date, '2026-12-31');
  assert.deepEqual(h.calls.generate, ['2026-12-31']);
});

test('database generation failure never enqueues or sends a false outage summary', async () => {
  const h = harness({ generateFailure: true });
  await assert.rejects(h.worker().tick(), /report read unavailable/);
  assert.equal(h.state.snapshots.size, 0);
  assert.deepEqual(h.calls.sent, []);
});

test('known429 holds all queued parts through the durable cooldown and survives worker restart', async () => {
  const h = harness({ parts: ['первая', 'вторая'] });
  const result = await h
    .worker(async () => ({ status: 'retryable', retryAfterSeconds: 120 }))
    .tick();
  assert.equal(result.retried, 1);
  assert.equal(h.calls.sent.length, 1);
  h.setTime('2026-10-06T04:01:59Z');
  await h.worker().tick();
  assert.equal(h.calls.sent.length, 1);
  h.setTime('2026-10-06T04:02:00Z');
  const resumed = await h.worker().tick();
  assert.equal(resumed.delivered, 2);
  assert.deepEqual(
    h.calls.sent.map((args) => args[1]),
    ['первая', 'первая', 'вторая'],
  );
  assert.equal(h.calls.generate.length, 1);
});

test('403 disables the recipient while definitive other failures fail only their part', async () => {
  const forbidden = harness({ parts: ['первая', 'вторая'] });
  const result = await forbidden.worker(async () => ({ status: 'forbidden' })).tick();
  assert.equal(result.disabled, 1);
  assert.equal(forbidden.calls.sent.length, 1);
  assert.ok(forbidden.state.disabled.has('recipient'));
  const failed = harness({ parts: ['первая', 'вторая'] });
  let n = 0;
  await assert.rejects(
    failed
      .worker(async () =>
        ++n === 1 ? { status: 'failed', errorCode: 400 } : { status: 'sent', messageId: 2 },
      )
      .tick(),
    { code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_FAILED', failed: 1 },
  );
  assert.deepEqual(
    failed.state.rows.map((row) => row.status),
    ['failed', 'sent'],
  );
  assert.equal(failed.state.disabled.size, 0);
});

test('uncertain network, provider outcome, and cancelled sends are never retried automatically', async () => {
  for (const send of [
    async () => {
      throw new Error('network dropped');
    },
    async () => ({ status: 'uncertain' }),
    async () => ({ status: 'cancelled' }),
  ]) {
    const h = harness();
    await assert.rejects(h.worker(send).tick(), {
      code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_FAILED',
      uncertain: 1,
    });
    h.setTime('2026-10-07T03:00:00Z');
    await assert.rejects(h.worker().tick(), {
      code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_FAILED',
      uncertain: 1,
    });
    assert.equal(h.calls.sent.length, 1);
    assert.equal(h.state.rows[0].status, 'uncertain');
  }
});

test('a successful send with failed acknowledgement stays uncertain even if state persistence also fails', async () => {
  const h = harness();
  h.state.completeFailure = true;
  h.state.markFailure = true;
  await assert.rejects(h.worker().tick(), /acknowledgement unavailable/);
  assert.equal(h.calls.sent.length, 1);
  h.state.completeFailure = false;
  h.state.markFailure = false;
  h.setTime('2026-10-06T04:01:31Z');
  await assert.rejects(h.worker().tick(), {
    code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_FAILED',
    uncertain: 1,
  });
  assert.equal(h.calls.sent.length, 1);
  assert.equal(h.state.rows[0].status, 'uncertain');
});

test('authorization is checked just before send and a removed recipient is not contacted', async () => {
  const h = harness();
  h.state.allowed = false;
  const result = await h.worker().tick();
  assert.equal(result.skipped, 1);
  assert.equal(h.calls.sent.length, 0);
  assert.equal(h.state.rows[0].status, 'failed');
});

test('overlapping ticks on the same worker do not send or enqueue concurrently', async () => {
  const h = harness();
  let release;
  const worker = h.worker(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = worker.tick();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await worker.tick(), { skipped: true, reason: 'busy' });
  release({ status: 'sent', messageId: 1 });
  assert.equal((await first).delivered, 1);
  assert.equal(h.calls.sent.length, 1);
});

test('claimed sends from a crashed worker become uncertain instead of being reclaimed', async () => {
  const h = harness();
  await h.store.enqueueDigest('2026-10-05', ['ранее отправлялось']);
  await h.store.claimDeliveries(1, { now: new Date('2026-10-06T04:00:00Z') });
  h.setTime('2026-10-06T04:01:31Z');
  await assert.rejects(h.worker().tick(), {
    code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_FAILED',
    uncertain: 1,
  });
  assert.equal(h.calls.sent.length, 0);
  assert.equal(h.state.rows[0].status, 'uncertain');
});

test('unresolved definitive failures keep health failed after restart without resending', async () => {
  const h = harness();
  await assert.rejects(h.worker(async () => ({ status: 'failed' })).tick(), {
    code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_FAILED',
    failed: 1,
  });
  await assert.rejects(h.worker().tick(), {
    code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_FAILED',
    failed: 1,
  });
  assert.equal(h.calls.sent.length, 1);
});

test('unavailable or malformed unresolved delivery counts never report healthy status', async () => {
  for (const getUnresolvedDeliveryCounts of [
    async () => {
      throw new Error('delivery state unavailable');
    },
    async () => ({ uncertain: null, failed: 0 }),
  ]) {
    const h = harness();
    h.setTime('2026-10-06T03:00:00Z');
    const worker = h.worker(undefined, { store: { ...h.store, getUnresolvedDeliveryCounts } });
    await assert.rejects(worker.tick());
    assert.equal(h.calls.sent.length, 0);
  }
});

test('shutdown finishes the current delivery and leaves later parts queued for restart', async () => {
  const h = harness({ parts: ['первая', 'вторая'] });
  let finishSend;
  let started;
  const sending = new Promise((resolve) => {
    started = resolve;
  });
  const worker = h.worker(
    () =>
      new Promise((resolve) => {
        finishSend = resolve;
        started();
      }),
  );
  const activeTick = worker.tick();
  await sending;
  worker.stop();
  assert.deepEqual(await worker.tick(), { skipped: true, reason: 'stopping' });
  assert.deepEqual(h.state.rows.map((row) => row.status), ['sending', 'pending']);
  finishSend({ status: 'sent', messageId: 1 });
  assert.equal((await activeTick).delivered, 1);
  assert.deepEqual(h.state.rows.map((row) => row.status), ['sent', 'pending']);
  assert.equal(h.state.sequence, 1, 'shutdown does not claim the second part');
  assert.deepEqual(await worker.tick(), { skipped: true, reason: 'stopping' });
  assert.equal((await h.worker().tick()).delivered, 1);
  assert.deepEqual(h.calls.sent.map((args) => args[1]), ['первая', 'вторая']);
});

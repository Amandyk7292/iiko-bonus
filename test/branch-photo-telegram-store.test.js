const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const store = require('../src/services/branch-photo-telegram-store.service');
const { fixture, NOW } = require('./helpers/photo-report-telegram-fixture.cjs');
const user = (id, username) => ({ id, chatId: id, username, private: true });
const later = (f, seconds) => ({ ...f.options, now: new Date(NOW.getTime() + seconds * 1000) });
async function admin(f, id = '202', name = 'manager_a') {
  await store.observeUser(user(id, name), f.options);
  return store.addAdmin('101', name, f.options);
}
test('owner bootstrap requires trusted private sender, configured ID and username; recycling never transfers rights', async (t) => {
  const f = await fixture(t, { bindOwner: false });
  await assert.rejects(
    store.observeUser({ ...user('101', 'amandyk7292'), private: false }, f.options),
    { code: 'PHOTO_REPORT_TELEGRAM_INVALID' },
  );
  await assert.rejects(
    store.observeUser({ ...user('101', 'amandyk7292'), chatId: '999' }, f.options),
    { code: 'PHOTO_REPORT_TELEGRAM_INVALID' },
  );
  await assert.rejects(
    store.observeUser({ ...user('101', 'amandyk7292'), isBot: true }, f.options),
    { code: 'PHOTO_REPORT_TELEGRAM_INVALID' },
  );
  assert.equal((await store.observeUser(user('999', 'amandyk7292'), f.options)).role, 'user');
  assert.equal((await store.getSettings(f.options)).ownerUserId, null);
  assert.equal((await store.observeUser(user('101', 'wrong_owner'), f.options)).role, 'user');
  assert.equal((await store.getSettings(f.options)).ownerUserId, null);
  const attempts = await Promise.all([
    store.observeUser(user('101', 'amandyk7292'), f.options),
    store.observeUser(user('999', 'amandyk7292'), f.options),
  ]);
  assert.deepEqual(
    attempts.map((u) => u.role),
    ['owner', 'user'],
  );
  assert.equal((await store.getSettings(f.options)).ownerUserId, '101');
  await store.observeUser(user('101', 'owner_new'), f.options);
  assert.equal((await store.observeUser(user('999', 'owner_new'), f.options)).role, 'user');
  await assert.rejects(store.setSendTime('999', '10:30', f.options), {
    code: 'PHOTO_REPORT_TELEGRAM_OWNER_REQUIRED',
  });
  assert.equal((await store.setSendTime('101', '10:30', f.options)).sendTime, '10:30');
  assert.equal(
    (
      await store.observeUser(user('888', 'replacement'), {
        ...f.options,
        ownerUserId: '888',
        ownerUsername: 'replacement',
      })
    ).role,
    'user',
  );
  await assert.rejects(
    f.pg.query('update photo_report_telegram_state set owner_user_id=$1', ['999']),
    /immutable/,
  );
});
test('owner-only admin grants bind immutable IDs, pending grants wait for start, and removed users remain removed', async (t) => {
  const f = await fixture(t);
  const pending = await store.addAdmin('101', '@Manager_A', f.options);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.userId, null);
  assert.equal(
    (await store.addAdmin('101', 'manager_a', f.options)).recipientId,
    pending.recipientId,
  );
  assert.equal((await store.observeUser(user('202', 'manager_a'), f.options)).role, 'admin');
  const bound = (await store.listAdmins('101', f.options)).find((r) => r.role === 'admin');
  assert.equal(bound.recipientId, pending.recipientId);
  assert.equal(bound.userId, '202');
  for (const method of [
    () => store.addAdmin('202', 'outsider1', f.options),
    () => store.removeAdmin('202', 'amandyk7292', f.options),
    () => store.listAdmins('202', f.options),
    () => store.setSendTime('202', '12:00', f.options),
  ])
    await assert.rejects(method(), { code: 'PHOTO_REPORT_TELEGRAM_OWNER_REQUIRED' });
  await store.observeUser(user('202', 'manager_b'), f.options);
  assert.equal((await store.observeUser(user('303', 'manager_a'), f.options)).role, 'user');
  assert.equal(
    (await store.listAdmins('101', f.options)).find((r) => r.role === 'admin').userId,
    '202',
  );
  await assert.rejects(
    f.pg.query('update photo_report_telegram_recipients set user_id=$1 where id=$2', [
      '303',
      bound.recipientId,
    ]),
    /immutable/,
  );
  assert.equal((await store.removeAdmin('101', 'manager_b', f.options)).removed, true);
  assert.equal((await store.observeUser(user('202', 'manager_b'), f.options)).role, 'user');
  assert.equal((await store.removeAdmin('101', 'manager_b', f.options)).removed, false);
  assert.equal(
    (await store.addAdmin('101', 'manager_a', f.options)).userId,
    '303',
    'a new explicit grant can approve the new nickname holder',
  );
  await assert.rejects(store.removeAdmin('101', 'amandyk7292', f.options), {
    code: 'PHOTO_REPORT_TELEGRAM_OWNER_PROTECTED',
  });
  assert.equal((await store.addAdmin('101', 'amandyk7292', f.options)).role, 'owner');
});
test('polling leases are atomic, survive restarts and never let stale workers rewind offset or mutate commands', async (t) => {
  const f = await fixture(t);
  const leaseA = randomUUID(),
    leaseB = randomUUID();
  const results = await Promise.all([
    store.acquirePollingLease(leaseA, f.options),
    store.acquirePollingLease(leaseB, f.options),
  ]);
  assert.deepEqual(results, [0, null]);
  assert.equal(await store.renewPollingLease(leaseB, f.options), false);
  assert.equal(await store.claimBotUpdate(50, leaseA, f.options), 'claimed');
  assert.equal(await store.advancePollingLease(leaseA, 40, f.options), true);
  assert.equal(await store.acquirePollingLease(leaseB, later(f, 91)), 40);
  assert.equal(await store.advancePollingLease(leaseA, 999, later(f, 91)), false);
  assert.equal(await store.releasePollingLease(leaseA, later(f, 91)), false);
  assert.equal(
    await store.claimBotUpdate(50, leaseB, later(f, 91)),
    'claimed',
    'unfinished processing resumes after lease takeover',
  );
  await assert.rejects(
    store.addAdmin('101', 'manager_a', { ...later(f, 91), leaseId: leaseA, updateId: 50 }),
    { code: 'PHOTO_REPORT_TELEGRAM_LEASE_LOST' },
  );
  const result = await store.addAdmin('101', 'manager_a', {
    ...later(f, 91),
    leaseId: leaseB,
    updateId: 50,
  });
  assert.equal(result.status, 'pending');
  assert.equal(await store.completeBotUpdate(50, leaseB, later(f, 91)), true);
  assert.equal(await store.acquirePollingLease(leaseB, later(f, 92)), 51);
  assert.equal(await store.claimBotUpdate(50, leaseB, later(f, 92)), 'completed');
  assert.equal(await store.advancePollingLease(leaseB, 20, later(f, 92)), true);
  assert.equal(await store.acquirePollingLease(leaseB, later(f, 92)), 51);
  assert.equal(await store.releasePollingLease(leaseB, later(f, 92)), true);
  assert.equal(await store.acquirePollingLease(leaseA, later(f, 92)), 51);
});
test('prepared multipart replies resume exact parts after definite429 and never replay ambiguous sends', async (t) => {
  const f = await fixture(t);
  const leaseA = randomUUID(),
    leaseB = randomUUID();
  await store.acquirePollingLease(leaseA, f.options);
  assert.equal(await store.claimBotUpdate(100, leaseA, f.options), 'claimed');
  assert.equal(
    await store.prepareBotReply(100, leaseA, ['Первая часть', 'Вторая часть'], {
      ...f.options,
      requiresReportAccess: true,
    }),
    true,
  );
  assert.equal(await store.claimBotUpdate(100, leaseA, f.options), 'prepared');
  assert.deepEqual(await store.getBotReply(100, leaseA, f.options), {
    parts: ['Первая часть', 'Вторая часть'],
    requiresReportAccess: true,
    notBefore: null,
    partIndex: 0,
  });
  assert.equal(await store.markBotReplyAttempted(100, leaseA, f.options), true);
  assert.equal(await store.advanceBotReplyPart(100, leaseA, f.options), true);
  assert.equal((await store.getBotReply(100, leaseA, f.options)).partIndex, 1);
  assert.equal(await store.markBotReplyAttempted(100, leaseA, f.options), true);
  assert.equal(
    await store.markBotReplyRetryable(100, leaseA, { ...f.options, retryAfter: 120 }),
    true,
  );
  await store.enqueueDigest('2026-10-04', ['Digest delayed by command429'], f.options);
  assert.deepEqual(await store.claimDeliveries(1, later(f, 119)), []);
  assert.equal(await store.markBotReplyAttempted(100, leaseA, later(f, 119)), false);
  await store.acquirePollingLease(leaseB, later(f, 121));
  assert.equal(await store.claimBotUpdate(100, leaseB, later(f, 121)), 'prepared');
  assert.equal((await store.getBotReply(100, leaseB, later(f, 121))).partIndex, 1);
  assert.equal(
    (await store.getBotReply(100, leaseB, later(f, 121))).requiresReportAccess,
    true,
    'cached report sensitivity survives restart and429 independently of message text',
  );
  assert.equal(await store.markBotReplyAttempted(100, leaseB, later(f, 121)), true);
  assert.equal(await store.advanceBotReplyPart(100, leaseB, later(f, 121)), true);
  assert.equal(await store.getBotReply(100, leaseB, later(f, 121)), null);
  assert.equal(await store.acquirePollingLease(leaseB, later(f, 121)), 101);
  await store.claimBotUpdate(101, leaseB, later(f, 121));
  await store.prepareBotReply(101, leaseB, 'Ответ уже мог уйти', later(f, 121));
  assert.equal((await store.getBotReply(101, leaseB, later(f, 121))).requiresReportAccess, false);
  await store.markBotReplyAttempted(101, leaseB, later(f, 121));
  await store.acquirePollingLease(leaseA, later(f, 212));
  assert.equal(await store.claimBotUpdate(101, leaseA, later(f, 212)), 'reply_attempted');
  assert.equal(await store.markBotReplyAttempted(101, leaseA, later(f, 212)), false);
  await store.completeBotUpdate(101, leaseA, later(f, 212));
  assert.equal(await store.acquirePollingLease(leaseA, later(f, 212)), 102);
});
test('daily digest snapshot fanout is persistent and idempotent under concurrent replicas and restart', async (t) => {
  const f = await fixture(t);
  await admin(f);
  await store.addAdmin('101', 'not_started', f.options);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => store.enqueueDigest('2026-10-04', ['A', 'B'], f.options)),
  );
  assert.equal(results.filter((r) => r.enqueued).length, 1);
  assert.equal(
    results.reduce((sum, r) => sum + r.count, 0),
    4,
  );
  assert.equal(await store.digestExists('2026-10-04', f.options), true);
  assert.equal(await store.digestExists('2026-10-03', f.options), false);
  assert.deepEqual(await store.enqueueDigest('2026-10-04', ['Replacement'], f.options), {
    enqueued: false,
    count: 0,
  });
  assert.deepEqual(
    (await f.pg.query('select parts from photo_report_telegram_digests')).rows[0].parts,
    ['A', 'B'],
  );
  await store.observeUser(user('303', 'not_started'), f.options);
  assert.deepEqual(await store.enqueueDigest('2026-10-04', ['Replacement'], f.options), {
    enqueued: false,
    count: 0,
  });
  assert.equal(
    (await f.pg.query('select count(*)::int n from photo_report_telegram_outbox')).rows[0].n,
    4,
  );
  await assert.rejects(store.enqueueDigest('2026-10-03', ['Missed older run'], f.options), {
    code: 'PHOTO_REPORT_TELEGRAM_INVALID',
  });
  await assert.rejects(store.enqueueDigest('2026-10-05', ['Future run'], f.options), {
    code: 'PHOTO_REPORT_TELEGRAM_INVALID',
  });
});
test('delivery leases prevent duplicates, preserve part order and put expired or ambiguous sends in uncertain state', async (t) => {
  const f = await fixture(t);
  await store.enqueueDigest('2026-10-04', ['A', 'B'], f.options);
  const [first, duplicate] = await Promise.all([
    store.claimDeliveries(10, f.options),
    store.claimDeliveries(10, f.options),
  ]);
  assert.equal(first.length, 1, 'only the first part is claimed for this recipient');
  assert.equal(duplicate.length, 0);
  const row = first[0];
  assert.equal(await store.deliveryAuthorized(row.id, row.leaseToken, f.options), true);
  assert.equal(await store.completeDelivery(row.id, randomUUID(), '1', f.options), false);
  assert.equal(await store.completeDelivery(row.id, row.leaseToken, '1', f.options), true);
  const second = (await store.claimDeliveries(10, f.options))[0];
  assert.equal(second.partIndex, 1);
  assert.equal(
    await store.failDelivery(second.id, second.leaseToken, { uncertain: true }, f.options),
    true,
  );
  assert.deepEqual(await store.claimDeliveries(10, later(f, 1000)), []);
  assert.equal(
    (await f.pg.query('select status from photo_report_telegram_outbox where id=$1', [second.id]))
      .rows[0].status,
    'uncertain',
  );
  await store.enqueueDigest('2026-10-05', ['C'], {
    ...f.options,
    now: new Date('2026-10-06T04:00:00Z'),
  });
  const expired = (
    await store.claimDeliveries(1, { ...f.options, now: new Date('2026-10-06T04:00:00Z') })
  )[0];
  assert.deepEqual(
    await store.claimDeliveries(1, { ...f.options, now: new Date('2026-10-06T04:01:31Z') }),
    [],
  );
  assert.equal(
    await store.deliveryAuthorized(expired.id, expired.leaseToken, {
      ...f.options,
      now: new Date('2026-10-06T04:01:31Z'),
    }),
    false,
  );
  assert.equal(
    (await f.pg.query('select status from photo_report_telegram_outbox where id=$1', [expired.id]))
      .rows[0].status,
    'uncertain',
  );
});
test('429 retry deadline pauses all replicas and other recipients; permanent errors do not remove valid admins', async (t) => {
  const f = await fixture(t);
  await admin(f);
  await store.enqueueDigest('2026-10-04', ['A'], f.options);
  const row = (await store.claimDeliveries(1, f.options))[0];
  assert.equal(
    await store.failDelivery(row.id, row.leaseToken, { retryAfter: 300 }, f.options),
    true,
  );
  assert.deepEqual(await store.claimDeliveries(10, later(f, 299)), []);
  assert.equal(
    Date.parse((await store.getSettings(f.options)).deliveryNotBefore),
    NOW.getTime() + 300000,
  );
  const retry = await store.claimDeliveries(10, later(f, 300));
  assert.equal(retry.length, 2);
  assert.equal(
    await store.failDelivery(retry[0].id, retry[0].leaseToken, { permanent: true }, later(f, 300)),
    true,
  );
  assert.equal(
    (await store.listAdmins('101', f.options)).filter((r) => r.status === 'active').length,
    2,
  );
  assert.equal(await store.disableRecipient(retry[1].recipientId, later(f, 300)), true);
  assert.equal(
    await store.deliveryAuthorized(retry[1].id, retry[1].leaseToken, later(f, 300)),
    false,
  );
  const disabled = (await store.listAdmins('101', f.options)).find(
    (r) => r.recipientId === retry[1].recipientId,
  );
  assert.equal(disabled.status, 'disabled');
  await store.observeUser(user(disabled.userId, disabled.username), later(f, 301));
  assert.equal(
    (await store.listAdmins('101', f.options)).find((r) => r.recipientId === disabled.recipientId)
      .status,
    'active',
  );
});
test('removing pending/active admins cancels even claimed deliveries before send and blocks future fanout', async (t) => {
  const f = await fixture(t);
  const recipient = await admin(f);
  await store.enqueueDigest('2026-10-04', ['A', 'B'], f.options);
  const rows = await store.claimDeliveries(10, f.options);
  const target = rows.find((r) => r.recipientId === recipient.recipientId);
  assert.ok(target);
  await store.removeAdmin('101', 'manager_a', f.options);
  assert.equal(await store.deliveryAuthorized(target.id, target.leaseToken, f.options), false);
  assert.equal(await store.completeDelivery(target.id, target.leaseToken, '1', f.options), false);
  assert.equal(
    (
      await f.pg.query(
        "select count(*)::int n from photo_report_telegram_outbox where recipient_id=$1 and status<>'cancelled'",
        [recipient.recipientId],
      )
    ).rows[0].n,
    0,
  );
  const pending = await store.addAdmin('101', 'manager_b', f.options);
  assert.equal((await store.removeAdmin('101', 'manager_b', f.options)).removed, true);
  assert.equal((await store.observeUser(user('303', 'manager_b'), f.options)).role, 'user');
  assert.equal(
    (
      await f.pg.query('select user_id from photo_report_telegram_recipients where id=$1', [
        pending.recipientId,
      ])
    ).rows[0].user_id,
    null,
  );
  assert.equal(
    (
      await store.enqueueDigest('2026-10-05', ['Next day'], {
        ...f.options,
        now: new Date('2026-10-06T04:00:00Z'),
      })
    ).count,
    1,
  );
});
test('unresolved delivery counts expose crash-expired sends and retain active failures without resurrecting cancelled history', async (t) => {
  const f = await fixture(t);
  const recipient = await admin(f);
  await store.enqueueDigest('2026-10-04', ['A'], f.options);
  const rows = await store.claimDeliveries(10, f.options);
  const failed = rows.find((r) => r.recipientId === recipient.recipientId);
  const crashed = rows.find((r) => r.recipientId !== recipient.recipientId);
  await store.failDelivery(failed.id, failed.leaseToken, { permanent: true }, f.options);
  assert.deepEqual(await store.getUnresolvedDeliveryCounts(later(f, 91)), {
    uncertain: 1,
    failed: 1,
  });
  assert.deepEqual(
    await store.getUnresolvedDeliveryCounts(later(f, 86400)),
    { uncertain: 1, failed: 1 },
    'historical unresolved deliveries remain visible after restart/day rollover',
  );
  assert.deepEqual(
    await store.claimDeliveries(10, later(f, 86400)),
    [],
    'status reporting never resends an unresolved message',
  );
  await store.disableRecipient(recipient.recipientId, later(f, 92));
  assert.equal(
    (await f.pg.query('select status from photo_report_telegram_outbox where id=$1', [failed.id]))
      .rows[0].status,
    'cancelled',
  );
  await store.observeUser(user('202', 'manager_a'), later(f, 93));
  assert.deepEqual(
    await store.getUnresolvedDeliveryCounts(later(f, 93)),
    { uncertain: 1, failed: 0 },
    'unblocking never resurrects a403/disabled recipient failure',
  );
  await store.removeAdmin('101', 'manager_a', later(f, 94));
  await store.addAdmin('101', 'manager_a', later(f, 95));
  assert.deepEqual(await store.getUnresolvedDeliveryCounts(later(f, 95)), {
    uncertain: 1,
    failed: 0,
  });
  await store.completeDelivery(crashed.id, crashed.leaseToken, '1', later(f, 96));
  assert.deepEqual(await store.getUnresolvedDeliveryCounts(later(f, 96)), {
    uncertain: 0,
    failed: 0,
  });
});
test('settings validation, ID precision and private RLS/RPC privileges are enforced without storing bot tokens', async (t) => {
  const f = await fixture(t);
  assert.equal((await store.getSettings(f.options)).sendTime, '09:00');
  for (const bad of ['24:00', '9:00', '09:60', '09:00:01'])
    assert.throws(() => store.setSendTime('101', bad, f.options), {
      code: 'PHOTO_REPORT_TELEGRAM_INVALID',
    });
  assert.equal((await store.setSendTime('101', '23:59', f.options)).sendTime, '23:59');
  await assert.rejects(
    store.observeUser(user(Number.MAX_SAFE_INTEGER + 1, 'manager_a'), f.options),
    { code: 'PHOTO_REPORT_TELEGRAM_INVALID' },
  );
  assert.throws(() => store.enqueueDigest('2026-02-30', ['A'], f.options), {
    code: 'PHOTO_REPORT_TELEGRAM_INVALID',
  });
  assert.throws(() => store.enqueueDigest('2026-10-04', ['x'.repeat(4097)], f.options), {
    code: 'PHOTO_REPORT_TELEGRAM_INVALID',
  });
  assert.throws(() => store.claimDeliveries(101, f.options), {
    code: 'PHOTO_REPORT_TELEGRAM_INVALID',
  });
  const privileges = (
    await f.pg.query(`select
    has_table_privilege('anon','photo_report_telegram_users','select') as anon_users,
    has_table_privilege('authenticated','photo_report_telegram_outbox','update') as authenticated_outbox,
    has_function_privilege('anon','observe_photo_report_telegram_user(text,text,text,text,text,timestamptz)','execute') as anon_observe,
    has_function_privilege('authenticated','claim_photo_report_telegram_deliveries(integer,timestamptz)','execute') as authenticated_claim,
    has_function_privilege('service_role','claim_photo_report_telegram_deliveries(integer,timestamptz)','execute') as service_claim`)
  ).rows[0];
  assert.deepEqual(privileges, {
    anon_users: false,
    authenticated_outbox: false,
    anon_observe: false,
    authenticated_claim: false,
    service_claim: true,
  });
  assert.equal(
    (
      await f.pg.query(
        "select count(*)::int n from information_schema.columns where table_name like 'photo_report_telegram_%' and column_name like '%token%'",
      )
    ).rows[0].n,
    1,
    'only random outbox lease tokens, never the Telegram bot credential, enter the database',
  );
});

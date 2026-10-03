const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const realtime = require('../src/services/realtime.service');
const { createAdminStream, openAdminStream } = require('../src/services/admin-realtime.service');
const {
  createAdminSession,
  revokeAdminSession,
  revokeAdminSessionsForSubject,
} = require('../src/services/admin-session.service');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const drain = async () => {
  for (let i = 0; i < 4; i++) await new Promise(setImmediate);
};
function stream(admin, handler = openAdminStream, query = {}) {
  const req = Object.assign(new EventEmitter(), { admin, query });
  const frames = [];
  const res = {
    status() {},
    set() {},
    write(text) {
      frames.push(text);
    },
    end() {
      this.writableEnded = true;
    },
  };
  handler(req, res);
  return { req, res, frames, body: () => frames.join('') };
}
async function session(subject = crypto.randomUUID()) {
  const admin = { sub: subject, jti: crypto.randomUUID(), role: 'owner', branchIds: [] };
  const expiresAt = new Date(Date.now() + 60000);
  await createAdminSession({ jti: admin.jti, subject, role: admin.role, branchIds: [], expiresAt });
  return { ...admin, sessionExpiresAt: expiresAt.toISOString() };
}

test('revocation closes live streams immediately and discards queued private events', async (t) => {
  t.after(() => realtime.resetForTests());
  const admin = await session();
  const view = stream(admin);
  await drain();
  assert.match(view.body(), /connected/);
  realtime.publish('transaction.created', { marker: 'before-revocation' });
  await revokeAdminSession(admin.jti);
  const atRevoke = view.body();
  realtime.publish('transaction.created', { marker: 'after-revocation' });
  await drain();
  assert.equal(view.res.writableEnded, true);
  assert.equal(view.body(), atRevoke);
  assert.doesNotMatch(view.body(), /after-revocation/);
  assert.equal(realtime.activeConnections(), 0);
});

test('subject revocation closes all of its streams while another administrator remains connected', async (t) => {
  t.after(() => realtime.resetForTests());
  const subject = crypto.randomUUID();
  const first = stream(await session(subject));
  const second = stream(await session(subject));
  const other = stream(await session());
  await drain();
  await revokeAdminSessionsForSubject(subject);
  assert.equal(first.res.writableEnded, true);
  assert.equal(second.res.writableEnded, true);
  assert.notEqual(other.res.writableEnded, true);
  assert.equal(realtime.activeConnections(), 1);
});

test('every frame uses current role and branch assignments, including a selected single branch', async (t) => {
  t.after(() => realtime.resetForTests());
  let current = { sub: 'operator', jti: 'test', role: 'operator', branchIds: [A, B] };
  const handler = createAdminStream({ validateSession: async () => current });
  const selected = stream({ ...current, selectedBranchId: A, selectedBranchIds: [A] }, handler);
  const all = stream(current, handler);
  await drain();
  realtime.publish('order.updated', { marker: 'allowed' }, { adminOnly: true, branchId: A });
  realtime.publish('order.updated', { marker: 'other-selected' }, { adminOnly: true, branchId: B });
  await drain();
  assert.match(selected.body(), /allowed/);
  assert.doesNotMatch(selected.body(), /other-selected/);
  current = { ...current, branchIds: [B] };
  realtime.publish('order.updated', { marker: 'removed-branch' }, { adminOnly: true, branchId: A });
  realtime.publish(
    'order.updated',
    { marker: 'retained-branch' },
    { adminOnly: true, branchId: B },
  );
  await drain();
  assert.equal(selected.res.writableEnded, true);
  assert.doesNotMatch(all.body(), /removed-branch/);
  assert.match(all.body(), /retained-branch/);
  current = { ...current, role: 'courier' };
  realtime.publish('order.updated', { marker: 'removed-area' }, { adminOnly: true, branchId: B });
  await drain();
  assert.doesNotMatch(all.body(), /removed-area/);
  current = { ...current, role: 'iiko_dashboard' };
  realtime.publish(
    'delivery.updated',
    { marker: 'no-events-access' },
    { adminOnly: true, branchId: B },
  );
  await drain();
  assert.equal(all.res.writableEnded, true);
  assert.doesNotMatch(all.body(), /no-events-access/);
});

test('a full history replays in order and authorization failures discard queued frames', async (t) => {
  t.after(() => realtime.resetForTests());
  for (let i = 0; i < 250; i++) realtime.publish('transaction.created', { index: i });
  let authorized = true;
  const admin = { role: 'owner', sub: 'replay' };
  const view = stream(
    admin,
    createAdminStream({ validateSession: async () => (authorized ? admin : null) }),
    { lastEventId: '0' },
  );
  await drain();
  assert.notEqual(view.res.writableEnded, true);
  assert.equal((view.body().match(/event: transaction.created/g) || []).length, 250);
  assert.ok(view.body().indexOf('"index":0') < view.body().indexOf('"index":249'));
  assert.ok(view.body().indexOf('"index":249') < view.body().indexOf('event: connected'));
  authorized = false;
  realtime.publish('transaction.created', { marker: 'revoked-in-database' });
  await drain();
  assert.equal(view.res.writableEnded, true);
  assert.doesNotMatch(view.body(), /revoked-in-database/);
});

test('unavailable authorization fails closed and expired streams close without waiting for an event', async (t) => {
  t.after(() => realtime.resetForTests());
  const unavailable = stream(
    { role: 'owner' },
    createAdminStream({
      validateSession: async () => {
        throw new Error('database unavailable');
      },
    }),
  );
  await drain();
  assert.equal(unavailable.res.writableEnded, true);
  assert.doesNotMatch(unavailable.body(), /event: connected/);
  const view = stream(
    { role: 'owner', sessionExpiresAt: new Date(Date.now() + 100).toISOString() },
    createAdminStream({ validateSession: async (admin) => admin }),
  );
  await drain();
  assert.match(view.body(), /connected/);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(view.res.writableEnded, true);
  assert.equal(realtime.activeConnections(), 0);
});

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  createAdminSession,
  revokeAdminSession,
  revokeAdminSessionsForSubject,
  sessionHash,
  validateAdminSession,
} = require('../src/services/admin-session.service');

test('admin sessions are hashed, revocable and expire server-side', async () => {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60_000);
  const payload = {
    jti,
    sub: 'operator@example.test',
    role: 'operator',
    branchIds: ['branch-from-token'],
  };

  assert.notEqual(sessionHash(jti), jti);
  await createAdminSession({
    jti,
    subject: payload.sub,
    role: payload.role,
    branchIds: ['branch-from-session'],
    expiresAt,
    ip: '127.0.0.1',
    userAgent: 'test',
  });

  const active = await validateAdminSession(payload);
  assert.equal(active.role, 'operator');
  assert.deepEqual(active.branchIds, ['branch-from-session']);

  const expired = await validateAdminSession(payload, {
    now: () => new Date(expiresAt.getTime() + 1),
  });
  assert.equal(expired, null);

  await revokeAdminSession(jti);
  assert.equal(await validateAdminSession(payload), null);
});

test('admin session cannot be reused for another subject', async () => {
  const jti = crypto.randomUUID();
  await createAdminSession({
    jti,
    subject: 'admin-a',
    role: 'admin',
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(
    await validateAdminSession({
      jti,
      sub: 'admin-b',
      role: 'admin',
    }),
    null,
  );
});

test('password reset can revoke every active session for one cashier', async () => {
  const subject = 'cashier.aktau';
  const payloads = [];
  for (let index = 0; index < 2; index += 1) {
    const jti = crypto.randomUUID();
    payloads.push({ jti, sub: subject, role: 'cashier' });
    await createAdminSession({
      jti,
      subject,
      role: 'cashier',
      branchIds: ['11111111-1111-4111-8111-111111111111'],
      expiresAt: new Date(Date.now() + 60_000),
    });
  }
  await revokeAdminSessionsForSubject(subject);
  for (const payload of payloads) {
    assert.equal(await validateAdminSession(payload), null);
  }
});

test('cashier session requires its current credential version and profile', async () => {
  const jti = crypto.randomUUID();
  const subject = 'cashier.aktau';
  const session = {
    admin_subject: subject,
    role: 'cashier',
    branch_ids: ['11111111-1111-4111-8111-111111111111'],
    auth_version: 1,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
  };
  const rows = {
    admin_sessions: session,
    admin_user_profiles: {
      role: 'cashier',
      branch_ids: session.branch_ids,
      active: true,
    },
    admin_staff_credentials: { auth_version: 1 },
  };
  const db = {
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: rows[table] || null, error: null }),
      };
    },
  };
  const payload = { jti, sub: subject, role: 'cashier' };

  assert.equal((await validateAdminSession(payload, { db, useLocal: false }))?.role, 'cashier');
  rows.admin_staff_credentials.auth_version = 2;
  assert.equal(await validateAdminSession(payload, { db, useLocal: false }), null);
  rows.admin_staff_credentials.auth_version = 1;
  rows.admin_user_profiles = null;
  assert.equal(await validateAdminSession(payload, { db, useLocal: false }), null);
});

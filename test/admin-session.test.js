const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  createAdminSession,
  revokeAdminSession,
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

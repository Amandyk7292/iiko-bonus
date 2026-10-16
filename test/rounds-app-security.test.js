const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { rounds } = require('../src/services/rounds.service');
const { signAdminToken } = require('../src/services/auth.service');
const { createAdminSession, revokeAdminSession } = require('../src/services/admin-session.service');
const { ADMIN_ROLES } = require('../src/middlewares/auth.middleware');
const app = require('../src/app');
test('actual application restricts inspection administration to owner/admin and keeps staff login separate', async () => {
  const original = rounds.dashboard;
  let captured;
  rounds.dashboard = async (admin) => {
    captured = admin;
    return { branches: [], inspectors: [], rounds: [] };
  };
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const tokens = [];
  try {
    for (const role of ADMIN_ROLES) {
      const jti = randomUUID(),
        username = `rounds-test-${role}`;
      const token = signAdminToken({ username, role }, { jti });
      await createAdminSession({ jti, subject: username, role, expiresAt: null });
      tokens.push(jti);
      const headers = { authorization: `Bearer ${token}` };
      const response = await fetch(`${url}/admin/api/rounds?from=2026-10-16&to=2026-10-16`, {
        headers,
      });
      assert.equal(response.status, ['owner', 'admin'].includes(role) ? 200 : 403, role);
      const mutation = await fetch(`${url}/admin/api/rounds/inspectors`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(
        mutation.status,
        ['owner', 'admin'].includes(role) ? 400 : 403,
        `${role} mutation`,
      );
      if (role === 'owner') {
        const branchId = randomUUID();
        const scoped = await fetch(`${url}/admin/api/rounds?from=2026-10-16&to=2026-10-16`, {
          headers: { ...headers, 'x-bulka-branch-id': branchId },
        });
        assert.equal(scoped.status, 200);
        assert.equal(captured.selectedBranchId, branchId);
        const staff = await fetch(`${url}/api/rounds/session`, {
          headers: { cookie: `bulka_admin=${token}` },
        });
        assert.equal(staff.status, 401);
      }
    }
    const response = await fetch(`${url}/admin/api/rounds?from=2026-10-16&to=2026-10-16`, {
      headers: { cookie: `bulka_rounds_session=${'X'.repeat(43)}` },
    });
    assert.equal(response.status, 401);
  } finally {
    rounds.dashboard = original;
    for (const jti of tokens) await revokeAdminSession(jti);
    await new Promise((resolve) => server.close(resolve));
  }
});

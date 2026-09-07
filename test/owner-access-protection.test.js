const assert = require('node:assert/strict');
const test = require('node:test');
const { registerAccessAdminRoutes } = require('../src/routes/admin/access.routes');

test('owner cannot demote, disable or branch-restrict their own account', async () => {
  let update;
  registerAccessAdminRoutes({
    get() {}, post() {},
    put(path, ...handlers) { if (path === '/admin/api/access/:username') update = handlers.at(-1); },
  });
  assert.equal(typeof update, 'function');
  for (const change of [
    { role: 'viewer' }, { active: false },
    { branchIds: ['11111111-1111-4111-8111-111111111111'] },
  ]) {
    let status, body;
    await update({
      admin: { username: 'admin', role: 'owner' }, params: { username: 'Admin' },
      body: { role: 'owner', active: true, branchIds: [], ...change },
    }, { status(value) { status = value; return this; }, json(value) { body = value; } });
    assert.equal(status, 409);
    assert.equal(body.code, 'OWNER_SELF_ACCESS_PROTECTED');
  }
});

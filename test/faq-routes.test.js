const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { faq } = require('../src/services/faq.service');
const { createAdminSession } = require('../src/services/admin-session.service');
const { signAdminToken } = require('../src/services/auth.service');
const audit = require('../src/services/admin-audit.service');

const writes = [];
const previousAudit = audit.writeAdminAudit;
audit.writeAdminAudit = async (req, statusCode) => writes.push({ ...req.adminAudit, statusCode });
const app = require('../src/app');
test.after(() => {
  audit.writeAdminAudit = previousAudit;
});

const id = 'fa010000-0000-4000-8000-000000000001';
const item = {
  id,
  questionRu: 'Вопрос',
  answerRu: 'Ответ',
  questionKk: '',
  answerKk: '',
  sortOrder: 0,
  isActive: true,
};
const { id: _id, ...input } = item;
const publicItem = { id, question: 'Вопрос', answer: 'Ответ', sortOrder: 0 };

async function tokenFor(role) {
  const jti = randomUUID();
  const username = `faq-test-${role}`;
  await createAdminSession({
    jti,
    subject: username,
    role,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return signAdminToken({ username, role, branchIds: [] }, { jti });
}

test('FAQ is public under the production router; management respects sessions, roles, CSRF and validation', async (t) => {
  const calls = [];
  for (const [method, result] of [
    ['listPublic', [publicItem]],
    ['listAdmin', [item]],
    ['create', item],
    ['update', item],
    ['hide', { ...item, isActive: false }],
  ]) {
    t.mock.method(faq, method, async (...args) => {
      calls.push({ method, args });
      return result;
    });
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method = 'GET', token, body, headers = {} } = {}) =>
    fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  const response = await request('/api/public/faq');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { success: true, items: [publicItem] });
  assert.equal(calls[0].args[0], 'ru');
  assert.equal((await request('/api/public/faq?lang=kk')).status, 200);
  assert.equal(calls[1].args[0], 'kk');
  for (const query of ['lang=en', 'lang=ru&lang=kk', 'lang[]=ru']) {
    const rejected = await request(`/api/public/faq?${query}`);
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, 'VALIDATION_ERROR');
  }
  assert.equal((await request('/admin/api/faq')).status, 401);
  assert.equal((await request('/admin/api/faq', { method: 'POST', body: input })).status, 401);

  for (const role of ['owner', 'admin', 'editor', 'marketer']) {
    const token = await tokenFor(role);
    const list = await request('/admin/api/faq', { token });
    assert.equal(list.status, 200, role);
    assert.deepEqual(await list.json(), { success: true, items: [item] });
    const created = await request('/admin/api/faq', { token, method: 'POST', body: input });
    assert.equal(created.status, 201, role);
    assert.deepEqual(await created.json(), { success: true, item });
    assert.equal(
      (await request(`/admin/api/faq/${id}`, { token, method: 'PUT', body: input })).status,
      200,
      role,
    );
    const hidden = await request(`/admin/api/faq/${id}`, { token, method: 'DELETE' });
    assert.equal(hidden.status, 200, role);
    assert.equal((await hidden.json()).item.isActive, false);
  }
  for (const role of [
    'viewer',
    'cashier',
    'operator',
    'branch_manager',
    'courier',
    'franchisee',
    'whatsapp_operator',
    'iiko_dashboard',
  ]) {
    const token = await tokenFor(role);
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const path = ['PUT', 'DELETE'].includes(method) ? `/admin/api/faq/${id}` : '/admin/api/faq';
      assert.equal(
        (
          await request(path, {
            token,
            method,
            ...(['POST', 'PUT'].includes(method) ? { body: input } : {}),
          })
        ).status,
        403,
        `${role} ${method}`,
      );
    }
  }
  const token = await tokenFor('owner');
  assert.equal(
    (
      await request('/admin/api/faq', {
        method: 'POST',
        body: input,
        headers: { Cookie: `bulka_admin=${token}` },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/admin/api/faq', {
        method: 'POST',
        body: input,
        headers: { Cookie: `bulka_admin=${token}`, Origin: base },
      })
    ).status,
    201,
  );
  const writesBeforeInvalid = calls.filter((call) =>
    ['create', 'update', 'hide'].includes(call.method),
  ).length;
  for (const [path, method, body] of [
    ['/admin/api/faq', 'POST', { ...input, answerRu: '<script>x</script>' }],
    [`/admin/api/faq/${id}`, 'PUT', { isActive: true }],
    ['/admin/api/faq/bad-id', 'PUT', input],
    [`/admin/api/faq/${id}`, 'DELETE', { isActive: true }],
  ]) {
    const rejected = await request(path, { token, method, body });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, 'VALIDATION_ERROR');
  }
  assert.equal(
    calls.filter((call) => ['create', 'update', 'hide'].includes(call.method)).length,
    writesBeforeInvalid,
  );
  assert.ok(
    writes.some(
      (write) =>
        write.actionCode === 'faq.created' && write.targetId === id && write.statusCode === 201,
    ),
  );
  assert.ok(writes.some((write) => write.actionCode === 'faq.hidden' && write.statusCode === 200));
});

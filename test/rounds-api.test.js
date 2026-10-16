const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { randomUUID } = require('node:crypto');
const { createRoundsRouter } = require('../src/routes/rounds.routes');
const { roundSummary, createRoundsService } = require('../src/services/rounds.service');
const { createRoundsAccess, hash, csrf } = require('../src/services/rounds-access.service');
const c = require('../src/contracts/rounds.contract');
const token = 'X'.repeat(43),
  csrfToken = csrf(token);
const inspector = {
  id: randomUUID(),
  name: 'Алия',
  username: 'rounds.test',
  city: 'Актау',
  branch_ids: [randomUUID()],
  active: true,
};
const actor = { inspector, sessionId: randomUUID(), csrfToken };
async function withApi(service, work, mediaService) {
  const app = express();
  app.use(express.json());
  app.use(createRoundsRouter({ service, mediaService }));
  app.use((error, _req, res, _next) =>
    res
      .status(error.statusCode || 500)
      .json({ success: false, error: error.message, code: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await work(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
const authenticated = {
  resolve: async (value) => {
    assert.equal(value, token);
    return actor;
  },
};
const cookie = `bulka_rounds_session=${token}`;
test('login sets isolated HttpOnly cookie, returns CSRF but never leaks session token', async () => {
  await withApi(
    { login: async () => ({ token, inspector: { id: inspector.id }, csrfToken }) },
    async (url) => {
      const response = await fetch(`${url}/api/rounds/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'rounds.test', password: 'test-password' }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('set-cookie'), /HttpOnly/);
      assert.match(response.headers.get('set-cookie'), /Path=\/api\/rounds/);
      assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
      const body = await response.json();
      assert.equal(body.csrfToken, csrfToken);
      assert.equal(body.token, undefined);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    },
  );
});
test('unauthenticated multipart is rejected before parsing or accessing media service', async () => {
  let called = false;
  await withApi(
    {
      resolve: async () => {
        throw Object.assign(new Error('Войдите'), { statusCode: 401 });
      },
    },
    async (url) => {
      const response = await fetch(`${url}/api/rounds/tasks/${randomUUID()}/media`, {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=missing' },
        body: 'malformed multipart',
      });
      assert.equal(response.status, 401);
      assert.equal(called, false);
    },
    {
      uploadMedia: async () => {
        called = true;
      },
    },
  );
});
test('valid multipart reaches upload after authorization, and excess parts fail safely', async () => {
  let uploads = 0;
  await withApi(
    authenticated,
    async (url) => {
      const target = `${url}/api/rounds/tasks/${randomUUID()}/media`;
      const body = new FormData();
      body.append('file', new Blob(['jpeg'], { type: 'image/jpeg' }), 'camera.jpg');
      const headers = { cookie, 'x-csrf-token': csrfToken };
      const response = await fetch(target, { method: 'POST', headers, body });
      assert.equal(response.status, 200);
      assert.equal(uploads, 1);
      const extra = new FormData();
      extra.append('file', new Blob(['jpeg'], { type: 'image/jpeg' }), 'camera.jpg');
      extra.append('unexpected', 'field');
      assert.equal((await fetch(target, { method: 'POST', headers, body: extra })).status, 400);
      assert.equal(uploads, 1);
    },
    {
      uploadMedia: async (_service, _actor, _task, file) => {
        uploads++;
        assert.equal(file.mimetype, 'image/jpeg');
        return { media: { id: randomUUID() } };
      },
    },
  );
});
test('global upload slots reject excess concurrent bodies and are released after processing', async () => {
  let arrived,
    immediate = false;
  const waiting = [],
    firstThree = new Promise((resolve) => {
      arrived = resolve;
    });
  await withApi(
    authenticated,
    async (url) => {
      const upload = () => {
        const body = new FormData();
        body.append('file', new Blob(['jpeg'], { type: 'image/jpeg' }), 'camera.jpg');
        return fetch(`${url}/api/rounds/tasks/${randomUUID()}/media`, {
          method: 'POST',
          headers: { cookie, 'x-csrf-token': csrfToken },
          body,
        });
      };
      const active = [upload(), upload(), upload()];
      try {
        await firstThree;
        const excess = await upload();
        assert.equal(excess.status, 503);
        assert.equal((await excess.json()).code, 'ROUNDS_UPLOAD_BUSY');
      } finally {
        immediate = true;
        waiting.forEach((resolve) => resolve({ media: {} }));
      }
      assert.deepEqual(
        (await Promise.all(active)).map((r) => r.status),
        [200, 200, 200],
      );
      assert.equal((await upload()).status, 200);
    },
    {
      uploadMedia: async () => {
        if (immediate) return { media: {} };
        return new Promise((resolve) => {
          waiting.push(resolve);
          if (waiting.length === 3) arrived();
        });
      },
    },
  );
});
test('mutation needs CSRF and cross-site requests are rejected before actions', async () => {
  let completed = 0;
  await withApi(
    {
      ...authenticated,
      complete: async () => {
        completed++;
        return { round: { status: 'completed' } };
      },
    },
    async (url) => {
      const target = `${url}/api/rounds/tasks/${randomUUID()}/complete`;
      const options = {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      };
      assert.equal((await fetch(target, options)).status, 403);
      assert.equal(
        (
          await fetch(target, {
            ...options,
            headers: {
              ...options.headers,
              'x-csrf-token': csrfToken,
              'sec-fetch-site': 'cross-site',
            },
          })
        ).status,
        403,
      );
      const response = await fetch(target, {
        ...options,
        headers: { ...options.headers, 'x-csrf-token': csrfToken },
      });
      assert.equal(response.status, 200);
      assert.equal(completed, 1);
    },
  );
});
test('session DTO has no password/session fields and list requires valid date', async () => {
  await withApi({ ...authenticated, list: async () => ({ rounds: [] }) }, async (url) => {
    const response = await fetch(`${url}/api/rounds/session`, { headers: { cookie } });
    const body = await response.json();
    assert.deepEqual(body.inspector.branchIds, inspector.branch_ids);
    assert.equal(body.inspector.password_hash, undefined);
    assert.equal(body.sessionId, undefined);
    assert.equal((await fetch(`${url}/api/rounds?date=bad`, { headers: { cookie } })).status, 400);
  });
});
test('status and late flag are derived from tasks, completion and deadline', () => {
  const r = {
    id: randomUUID(),
    deadline: '2026-10-16T10:00:00Z',
    tasks: [{ completed_at: null }],
    branch: {},
    inspector: {},
  };
  const now = new Date('2026-10-16T11:00:00Z');
  assert.equal(roundSummary(r, now).status, 'overdue');
  assert.equal(roundSummary({ ...r, deadline: '2026-10-16T12:00:00Z' }, now).status, 'pending');
  assert.equal(
    roundSummary(
      { ...r, tasks: [{ completed_at: now }, {}], deadline: '2026-10-16T12:00:00Z' },
      now,
    ).status,
    'in_progress',
  );
  assert.equal(roundSummary({ ...r, completed_at: now }, now).status, 'completed');
  assert.equal(roundSummary({ ...r, completed_at: now }, now).completedLate, true);
  assert.equal(
    roundSummary({ ...r, completed_at: now, cancelled_at: now }, now).status,
    'cancelled',
  );
});
function fakeDb(answer) {
  return {
    from(table) {
      const filters = [];
      const chain = {
        then(resolve, reject) {
          return Promise.resolve(answer(table, filters)).then(resolve, reject);
        },
      };
      for (const method of [
        'select',
        'eq',
        'in',
        'gte',
        'lte',
        'order',
        'limit',
        'maybeSingle',
        'single',
        'update',
        'gt',
        'delete',
      ])
        chain[method] = (...args) => {
          filters.push([method, ...args]);
          return chain;
        };
      return chain;
    },
  };
}
test('staff round and media reads deny another inspector and removed branch access', async () => {
  let r = {
    id: randomUUID(),
    inspector_id: randomUUID(),
    branch_id: inspector.branch_ids[0],
    branch: {},
    tasks: [],
  };
  const db = fakeDb((table) => ({
    data:
      table === 'inspection_rounds'
        ? r
        : table === 'inspection_media'
          ? { id: 'media', task_id: 'task' }
          : table === 'inspection_tasks'
            ? { round_id: r.id }
            : null,
  }));
  const service = createRoundsService({ db });
  await assert.rejects(service.detail(actor, r.id), { statusCode: 404 });
  await assert.rejects(service.readMedia(actor, 'media'), { statusCode: 404 });
  r = { ...r, inspector_id: inspector.id, branch_id: randomUUID() };
  await assert.rejects(service.detail(actor, r.id), { statusCode: 404 });
  await assert.rejects(
    service.adminDetail({ role: 'owner', selectedBranchId: randomUUID() }, r.id),
    { statusCode: 404 },
  );
});
test('session rolling extension uses only hash and refuses expired/deleted credentials', async () => {
  const now = new Date('2026-10-16T00:00:00Z');
  let expired = false,
    deleted = false,
    update;
  const db = fakeDb((table, calls) => {
    if (table === 'inspection_inspectors') return { data: inspector };
    const mutation = calls.find(([method]) => method === 'update');
    if (mutation) {
      update = mutation[1];
      return { data: deleted ? null : { id: actor.sessionId } };
    }
    assert.ok(
      calls.some((call) => call[0] === 'eq' && call[1] === 'token_hash' && call[2] === hash(token)),
    );
    return {
      data: {
        id: actor.sessionId,
        inspector_id: inspector.id,
        expires_at: expired ? '2026-10-15' : '2026-10-20',
      },
    };
  });
  const access = createRoundsAccess({ db, now: () => now });
  const resolved = await access.resolve(token);
  assert.equal(resolved.csrfToken, csrfToken);
  assert.equal(update.expires_at, '2026-11-15T00:00:00.000Z');
  expired = true;
  await assert.rejects(access.resolve(token), { statusCode: 401 });
  expired = false;
  deleted = true;
  await assert.rejects(access.resolve(token), { statusCode: 401 });
});
test('contracts reject unknown secrets, empty scopes, duplicate branches and overlong range', () => {
  assert.equal(
    c.inspectorCreate.safeParse({ name: 'Имя', city: 'Актау', branchIds: [] }).success,
    false,
  );
  assert.equal(c.inspectorPatch.safeParse({ password: 'untrusted' }).success, false);
  assert.equal(
    c.inspectorCreate.safeParse({
      name: 'Имя',
      city: 'Актау',
      branchIds: [inspector.id, inspector.id],
    }).success,
    false,
  );
  assert.equal(c.rangeQuery.safeParse({ from: '2026-01-01', to: '2026-03-01' }).success, false);
});

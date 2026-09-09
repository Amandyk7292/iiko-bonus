const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { frontInventorySnapshotSchema } = require('../src/contracts/front-inventory.contract');

function stub(t, path, exports) {
  const id = require.resolve(path),
    previous = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  });
}
function snapshot() {
  return {
    terminalId: randomUUID(),
    terminalGroupId: randomUUID(),
    sessionId: randomUUID(),
    sequence: 1,
    capturedAt: new Date().toISOString(),
    items: [{ productId: randomUUID(), productName: 'Хот дог', quantity: 5 }],
  };
}
test('Front contract rejects branch overrides, repeated IDs and invalid full snapshots', () => {
  const value = snapshot();
  assert.equal(frontInventorySnapshotSchema.safeParse(value).success, true);
  for (const payload of [
    { ...value, branchId: randomUUID() },
    { ...value, items: [value.items[0], value.items[0]] },
    { ...value, items: [{ ...value.items[0], productId: 'Хот-дог' }] },
    { ...value, items: [{ ...value.items[0], quantity: -1 }] },
    { ...value, items: [{ ...value.items[0], quantity: 1.5 }] },
    {
      ...value,
      items: Array.from({ length: 451 }, () => ({ ...value.items[0], productId: randomUUID() })),
    },
  ])
    assert.equal(frontInventorySnapshotSchema.safeParse(payload).success, false);
});
test('Front updates derive product scope from the authenticated branch, never from names', async (t) => {
  const branchId = randomUUID(),
    calls = [],
    events = [];
  let changed = true;
  stub(t, '../src/config/supabase', {
    supabase: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { applied: true, changed } };
      },
    },
  });
  stub(t, '../src/services/iiko-city-profile.service', {
    getIikoClientForBranch: async (id) => {
      assert.equal(id, branchId);
      return { profileKey: 'astana' };
    },
  });
  stub(t, '../src/services/realtime.service', { publish: (...args) => events.push(args) });
  const serviceId = require.resolve('../src/services/front-inventory.service');
  const previous = require.cache[serviceId];
  delete require.cache[serviceId];
  t.after(() => {
    if (previous) require.cache[serviceId] = previous;
    else delete require.cache[serviceId];
  });
  const service = require(serviceId),
    value = snapshot();
  await service.applyFrontInventorySnapshot(branchId, value);
  assert.equal(calls[0].args.p_branch_id, branchId);
  assert.equal(calls[0].args.p_items[0].productId, `astana:${value.items[0].productId}`);
  assert.equal(events[0][2].branchId, branchId);
  changed = false;
  await service.applyFrontInventorySnapshot(branchId, { ...value, sequence: 2 });
  assert.equal(events.length, 1, 'heartbeats do not force catalog reloads');
  await assert.rejects(
    () =>
      service.applyFrontInventorySnapshot(branchId, {
        ...value,
        capturedAt: new Date(Date.now() - 180_000).toISOString(),
      }),
    { statusCode: 409 },
  );
  assert.equal(calls.length, 2);
  assert.equal(service.frontSyncStatus(null).configured, false);
  assert.equal(
    service.frontSyncStatus({ last_seen_at: new Date(Date.now() - 46_000).toISOString() })
      .connected,
    false,
  );
});
test('Front snapshot route requires branch credentials even in compatibility mode', async () => {
  const router = require('../src/routes/front-inventory.routes');
  const route = router.stack.find((layer) => layer.route).route;
  const auth = route.stack.find((layer) => layer.handle.name === 'branchPosAuthMiddleware');
  assert.ok(auth);
  let status,
    next = false;
  await auth.handle(
    { headers: {}, body: snapshot() },
    {
      status(value) {
        status = value;
        return this;
      },
      json() {},
    },
    () => {
      next = true;
    },
  );
  assert.equal(status, 401);
  assert.equal(next, false);
});

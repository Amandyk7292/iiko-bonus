const test = require('node:test');
const assert = require('node:assert/strict');
const writes = [];
const storage = {
  async upload(name) {
    writes.push(name);
    return { error: null };
  },
  getPublicUrl(name) {
    return { data: { publicUrl: `https://example.com/${name}` } };
  },
};
require.cache[require.resolve('../src/config/supabase')] = {
  exports: {
    supabase: {
      storage: { from: () => storage },
      from() {
        throw new Error('Unexpected database request');
      },
    },
  },
};
require.cache[require.resolve('../src/services/iiko-city-profile.service')] = {
  exports: {
    getIikoClientForBranch: async () => ({ profileKey: 'default' }),
    invalidateAllIikoCaches() {
      assert.fail('A photo must not invalidate raw iiko data');
    },
  },
};
require.cache[require.resolve('../src/utils/image.util')] = {
  exports: {
    optimizeUploadedImage: async (buffer) => ({ buffer, mime: 'image/jpeg', extension: 'jpg' }),
  },
};
const service = require('../src/services/menu.service');
const realtime = require('../src/services/realtime.service');
const { adminMutationSchemas } = require('../src/contracts/admin-mutations.contract');
const { registerMenuAdminRoutes } = require('../src/routes/admin/menu.routes');
const routes = [];
registerMenuAdminRoutes({
  post: (paths, ...handlers) => routes.push({ paths, handlers }),
  get() {},
  patch() {},
  delete() {},
});
const handler = routes
  .find(
    (route) => Array.isArray(route.paths) && route.paths.includes('/admin/api/menu/upload-photo'),
  )
  .handlers.at(-1);
const response = () => ({
  locals: {},
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
const request = (targetType = 'product', profileKey = 'default') => ({
  path: '/admin/api/menu/upload-photo',
  admin: { selectedBranchId: 'a' },
  body: { targetType, targetId: 'cake', profileKey },
  file: { buffer: Buffer.from('photo') },
  detectedImageType: { mime: 'image/jpeg' },
});

for (const type of ['product', 'category'])
  test(`photo upload waits for ${type} binding before success and publishes once`, async (t) => {
    let finish;
    const gate = new Promise((resolve) => {
      finish = resolve;
    });
    let patch;
    t.mock.method(
      service,
      type === 'product' ? 'setProductOverride' : 'setCategoryOverride',
      async (...args) => {
        patch = args;
        await gate;
      },
    );
    const events = [];
    t.mock.method(realtime, 'publish', (...args) => events.push(args));
    const res = response();
    const pending = handler(request(type), res);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(res.body, undefined);
    assert.equal(events.length, 0);
    assert.equal(patch[0], 'cake');
    assert.deepEqual(patch[2], { profileKey: 'default' });
    finish();
    await pending;
    assert.equal(res.body.success, true);
    assert.equal(res.body.imageUrl, patch[1].custom_image_url);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0][2], { broadcast: true });
    assert.equal(res.locals.clientDataPublished, true);
  });

test('wrong profile rejects before storing a file', async () => {
  const before = writes.length;
  const res = response();
  await handler(request('product', 'astana'), res);
  assert.equal(res.statusCode, 409);
  assert.equal(writes.length, before);
});
test('binding failure cannot be reported as a successful upload', async (t) => {
  t.mock.method(service, 'setProductOverride', async () => {
    throw new Error('database unavailable');
  });
  t.mock.method(console, 'error', () => {});
  t.mock.method(realtime, 'publish', () => assert.fail('must not publish an unsaved photo'));
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
});
test('photo contract requires the target and profile and rejects unsupported fields', () => {
  const schema = adminMutationSchemas.menuPhotoUpload.body;
  assert.equal(schema.safeParse(request().body).success, true);
  for (const body of [
    {},
    { ...request().body, targetType: 'other' },
    { ...request().body, profileKey: undefined },
    { ...request().body, price: 1 },
  ]) {
    assert.equal(schema.safeParse(body).success, false);
  }
});

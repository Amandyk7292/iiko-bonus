const test = require('node:test');
const assert = require('node:assert/strict');
const values = new Map();
let fail = false;
require.cache[require.resolve('../src/config/supabase')] = {
  exports: {
    supabase: {
      from(table) {
        assert.equal(table, 'settings');
        return {
          select() {
            return {
              eq(_field, key) {
                return {
                  async maybeSingle() {
                    return {
                      data: values.has(key) ? { value: values.get(key) } : null,
                      error: fail ? new Error('offline') : null,
                    };
                  },
                };
              },
            };
          },
          async upsert(row) {
            if (fail) return { error: new Error('offline') };
            values.set(row.key, row.value);
            return { error: null };
          },
        };
      },
    },
  },
};
require.cache[require.resolve('../src/services/iiko-city-profile.service')] = {
  exports: {
    getIikoClientForBranch: async (branch) => ({
      profileKey: branch === 'astana' ? 'astana' : 'default',
    }),
  },
};
const { registerPriceLabelRoutes } = require('../src/routes/admin/price-label.routes');
const { adminMutationSchemas } = require('../src/contracts/admin-mutations.contract');
const routes = {};
registerPriceLabelRoutes({
  get: (_path, ...handlers) => {
    routes.get = handlers.at(-1);
  },
  post: (_path, ...handlers) => {
    routes.post = handlers.at(-1);
  },
});
const response = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(data) {
    this.data = data;
    return this;
  },
});
test('label settings persist by city and reject an outdated city', async () => {
  values.clear();
  const req = {
    admin: { selectedBranchId: 'aktau' },
    body: { profileKey: 'default', background: '#123abc', includeQr: true },
  };
  const saved = response();
  await routes.post(req, saved);
  assert.equal(saved.statusCode, 200);
  const read = response();
  await routes.get(req, read);
  assert.equal(read.data.background, '#123ABC');
  assert.equal(read.data.includeQr, true);
  const other = response();
  await routes.get({ admin: { selectedBranchId: 'astana' } }, other);
  assert.equal(other.data.includeQr, false);
  const mismatch = response();
  await routes.post({ ...req, admin: { selectedBranchId: 'astana' } }, mismatch);
  assert.equal(mismatch.statusCode, 409);
  fail = true;
  const error = response();
  await routes.post(req, error);
  assert.equal(error.statusCode, 503);
  fail = false;
});
test('label settings reject executable colors and non-boolean QR', () => {
  const body = adminMutationSchemas.priceLabelSettings.body;
  assert.equal(
    body.safeParse({ profileKey: 'default', background: '#792C14', includeQr: true }).success,
    true,
  );
  assert.equal(
    body.safeParse({ profileKey: 'default', background: 'red;evil', includeQr: true }).success,
    false,
  );
  assert.equal(
    body.safeParse({ profileKey: 'default', background: '#792C14', includeQr: 'false' }).success,
    false,
  );
});

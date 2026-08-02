const assert = require('node:assert/strict');
const test = require('node:test');

test('customer middleware enforces credential versions while preserving legacy sessions', async () => {
  const configPath = require.resolve('../src/config/supabase');
  const middlewarePath = require.resolve('../src/middlewares/customer-auth.middleware');
  const previousConfig = require.cache[configPath];
  const previousMiddleware = require.cache[middlewarePath];
  const previousSecret = process.env.CUSTOMER_JWT_SECRET;
  process.env.CUSTOMER_JWT_SECRET = 'c'.repeat(64);

  let credential = { auth_version: 2 };
  const customer = { id: 'customer-1', phone: '+77001234567', deleted_at: null };
  const supabase = {
    from(table) {
      const row = table === 'customers' ? customer : credential;
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
      };
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase },
  };
  delete require.cache[middlewarePath];

  try {
    const { signCustomerToken } = require('../src/services/auth.service');
    const { customerAuthMiddleware } = require('../src/middlewares/customer-auth.middleware');

    async function authorize(token) {
      let nextCalled = false;
      let responseStatus = 200;
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {
        status(value) {
          responseStatus = value;
          return this;
        },
        json(body) {
          return body;
        },
      };
      await customerAuthMiddleware(req, res, () => {
        nextCalled = true;
      });
      return { nextCalled, responseStatus, auth: req.customerAuth };
    }

    const matching = signCustomerToken(customer, { authVersion: 2 });
    assert.deepEqual(await authorize(matching), {
      nextCalled: true,
      responseStatus: 200,
      auth: { id: customer.id, phone: customer.phone },
    });

    const stale = signCustomerToken(customer, { authVersion: 1 });
    assert.equal((await authorize(stale)).responseStatus, 401);

    const prePassword = signCustomerToken(customer);
    assert.equal((await authorize(prePassword)).responseStatus, 401);

    credential = null;
    assert.equal((await authorize(prePassword)).nextCalled, true);
  } finally {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousMiddleware) require.cache[middlewarePath] = previousMiddleware;
    else delete require.cache[middlewarePath];
    if (previousSecret === undefined) delete process.env.CUSTOMER_JWT_SECRET;
    else process.env.CUSTOMER_JWT_SECRET = previousSecret;
  }
});

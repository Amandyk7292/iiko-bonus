const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const configPath = require.resolve('../src/config/supabase');
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: { supabase: {} },
};
const { supabase } = require('../src/config/supabase');
const { signRegistrationToken, signCustomerToken } = require('../src/services/auth.service');
const {
  phoneKey,
  claimBranch,
  finishRegistration,
} = require('../src/services/branch-signup.service');
const { registerBranchSignupRoutes } = require('../src/routes/public/branch-signup.routes');
const { registerBranchSignupAdminRoutes } = require('../src/routes/admin/branch-signup.routes');
const { directivesForPath } = require('../src/middlewares/content-security-policy.middleware');

test('old printed branch invitations redirect directly to current registration without attribution or OTP requests', async (t) => {
  const app = express();
  registerBranchSignupRoutes(app);
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ error: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(
    `${origin}/invite/90c3a8b5-9c7c-4407-bf7e-18d093da218f?redirect=https://example.com`,
    { redirect: 'manual' },
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/profile?register=1');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await response.text(), /WhatsApp|wa\.me|branch-invite-assets/);
  const invalid = await fetch(`${origin}/invite/not-a-uuid`, { redirect: 'manual' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('location'), null);

  const bookmarked = await fetch(`${origin}/branch-invite-assets/index.html`);
  assert.equal(bookmarked.status, 200);
  const html = await bookmarked.text();
  assert.match(html, /href="\/profile\?register=1"/);
  assert.doesNotMatch(html, /WhatsApp|wa\.me|<form|30 дней|рейтинге/);
});

test('obsolete invitation client only replaces its URL with current registration', () => {
  const script = fs.readFileSync(path.join(__dirname, '../public/branch-invite/app.js'), 'utf8');
  const destinations = [];
  vm.runInNewContext(script, {
    window: { location: { replace: (url) => destinations.push(url) } },
    fetch: () => assert.fail('invitation must not request or verify an OTP'),
    sessionStorage: {
      getItem: () => assert.fail('invitation must not restore obsolete WhatsApp state'),
      setItem: () => assert.fail('invitation must not persist obsolete WhatsApp state'),
    },
  });
  assert.deepEqual(destinations, ['/profile?register=1']);
});

test('attribution normalizes phone and uses a keyed hash without storing raw phone', async () => {
  assert.equal(phoneKey('87001234567'), phoneKey('+7 700 123 45 67'));
  assert.match(phoneKey('87001234567'), /^[a-f0-9]{64}$/);
  let passed;
  const db = {
    rpc: async (name, args) => {
      passed = { name, args };
      return { data: { status: 'saved' }, error: null };
    },
  };
  await claimBranch('87001234567', 'branch', { db });
  assert.equal(passed.args.p_phone, '+77001234567');
  await finishRegistration({ id: 'customer', phone: '+77001234567' }, { name: 'Test' }, { db });
  assert.equal(passed.name, 'finish_customer_registration');
  assert.equal(passed.args.p_customer_id, 'customer');
  assert.equal(passed.args.p_phone, undefined);
});
test('claim requires a verified registration token and rejects customer tokens', async () => {
  const routes = [];
  registerBranchSignupRoutes({
    use() {},
    get() {},
    post(path, ...handlers) {
      routes.push({ path, handlers });
    },
  });
  const auth = routes[0].handlers[1];
  for (const token of ['', signCustomerToken({ id: 'customer', phone: '+77001234567' })]) {
    let status;
    auth(
      { headers: { authorization: 'Bearer ' + token } },
      {
        status(n) {
          status = n;
          return this;
        },
        json() {},
      },
      () => assert.fail('must reject'),
    );
    assert.equal(status, 401);
  }
  const req = { headers: { authorization: 'Bearer ' + signRegistrationToken('+77001234567') } };
  let next = false;
  auth(req, {}, () => {
    next = true;
  });
  assert.equal(next, true);
  assert.equal(req.registrationAuth.phone, '+77001234567');
});
test('ranking uses server-authorized branch scope, not caller-supplied branches', async () => {
  const routes = [];
  registerBranchSignupAdminRoutes({
    get(path, ...handlers) {
      routes.push({ path, handlers });
    },
  });
  let args;
  supabase.rpc = async (_name, value) => {
    args = value;
    return { data: { items: [] } };
  };
  let result;
  await routes[0].handlers.at(-1)(
    {
      admin: { role: 'marketer', branchIds: ['allowed'] },
      query: { from: '2026-09-01', to: '2026-09-27' },
    },
    {
      json(data) {
        result = data;
      },
    },
  );
  assert.deepEqual(args.p_branches, ['allowed']);
  assert.equal(args.p_to, '2026-09-27T19:00:00.000Z');
  assert.deepEqual(result.items, []);
});
test('QR download outside authorized branches is blocked before database access', async () => {
  const routes = [];
  registerBranchSignupAdminRoutes({
    get(path, ...handlers) {
      routes.push({ path, handlers });
    },
  });
  let status;
  await routes[1].handlers.at(-1)(
    { admin: { role: 'marketer', branchIds: ['allowed'] }, params: { branch: 'other' } },
    {
      status(n) {
        status = n;
        return this;
      },
      end() {},
    },
  );
  assert.equal(status, 404);
});
test('invitation page only permits same-origin scripts and API connections', () => {
  const policy = directivesForPath('/invite/90c3a8b5-9c7c-4407-bf7e-18d093da218f');
  assert.deepEqual(policy.scriptSrc, ["'self'"]);
  assert.deepEqual(policy.connectSrc, ["'self'"]);
});

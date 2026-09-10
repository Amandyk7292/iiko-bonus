const test = require('node:test');
const assert = require('node:assert/strict');

function fixture(t, reason) {
  const restores = [];
  const stub = (path, exports) => {
    const id = require.resolve(path),
      saved = require.cache[id];
    require.cache[id] = { id, filename: id, loaded: true, exports };
    restores.push(() => {
      if (saved) require.cache[id] = saved;
      else delete require.cache[id];
    });
  };
  let options,
    removed = false;
  stub('@parse/node-apn', {
    Notification: class {},
    Provider: class {
      constructor(input) {
        options = input;
      }
      async send() {
        return { sent: [], failed: [{ device: 'fixture-token', response: { reason } }] };
      }
    },
  });
  stub('../src/utils/cert.util', { readSecretBuffer: () => Buffer.from('fixture') });
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    delete() {
      removed = true;
      return this;
    },
    in() {
      return this;
    },
    then(resolve) {
      return Promise.resolve({ data: [{ push_token: 'fixture-token' }] }).then(resolve);
    },
  };
  stub('../src/config/supabase', { supabase: { from: () => query } });
  const id = require.resolve('../src/services/wallet.service'),
    saved = require.cache[id];
  delete require.cache[id];
  const service = require(id);
  t.after(() => {
    if (saved) require.cache[id] = saved;
    else delete require.cache[id];
    for (const restore of restores.reverse()) restore();
  });
  return { service, options: () => options, removed: () => removed };
}

test('Wallet uses working IPv4 and keeps valid registrations for retry after transient APNs failure', async (t) => {
  const state = fixture(t, 'ServiceUnavailable');
  const result = await state.service.sendAppleWalletPush('fixture-customer');
  assert.equal(state.options().family, 4);
  assert.equal(state.options().production, true);
  assert.equal(result.retryable, true);
  assert.equal(state.removed(), false);
});
test('Wallet retires an invalid token without retrying it', async (t) => {
  const state = fixture(t, 'Unregistered');
  const result = await state.service.sendAppleWalletPush('fixture-customer');
  assert.equal(result.retryable, false);
  assert.equal(state.removed(), true);
});

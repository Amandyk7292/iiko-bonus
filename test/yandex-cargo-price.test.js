const assert = require('node:assert/strict');
const test = require('node:test');
const { assertCargoPrice, cargoPriceLimit } = require('../src/services/yandex-cargo-price');

const offer = (price, extra = {}) => ({
  pricing: {
    currency: 'KZT',
    offer: { price, valid_until: new Date(Date.now() + 60000).toISOString(), ...extra },
  },
});

test('Cargo permits a quote up to the approved limit, including VAT', () => {
  assert.equal(assertCargoPrice(offer('1960.400000'), 5000), 1960.4);
  assert.equal(assertCargoPrice(offer('4500', { price_with_vat: '5000' }), 5000), 5000);
  assert.throws(() => assertCargoPrice(offer('4900', { price_with_vat: '5684' }), 5000), {
    code: 'YANDEX_CARGO_PRICE_LIMIT_EXCEEDED',
    retryable: false,
  });
});

test('Cargo rejects missing or invalid price, currency, limit and expired offers', () => {
  for (const price of [null, undefined, '', 'NaN', 'Infinity', '-1', '0']) {
    assert.throws(() => assertCargoPrice(offer(price), 5000), {
      code: 'YANDEX_CARGO_PRICE_UNVERIFIED',
    });
  }
  assert.throws(
    () => assertCargoPrice({ pricing: { currency: 'RUB', offer: { price: '100' } } }, 5000),
    { code: 'YANDEX_CARGO_PRICE_UNVERIFIED' },
  );
  for (const limit of [null, '', 0, -1, Infinity, 'bad', 100001]) {
    assert.equal(cargoPriceLimit(limit), null);
    assert.throws(() => assertCargoPrice(offer('100'), limit), {
      code: 'YANDEX_CARGO_PRICE_LIMIT_REQUIRED',
    });
  }
  assert.throws(
    () => assertCargoPrice(offer('100', { valid_until: '2020-01-01T00:00:00Z' }), 5000),
    { code: 'YANDEX_CARGO_PRICE_EXPIRED' },
  );
});

test('Cargo sync never accepts an over-limit claim or creates another one', async (t) => {
  const replacements = [];
  const replace = (name, exports) => {
    const id = require.resolve(name);
    replacements.push([id, require.cache[id]]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };
  const job = {
    id: 'job',
    order_id: 'order',
    api_family: 'cargo_v2',
    external_claim_id: 'claim',
    provider_status: 'estimating',
    auto_accept: true,
    authorized_max_price: 5000,
  };
  replace('../src/config/supabase', {
    supabase: {
      from() {
        let updates;
        const builder = {
          update(value) {
            updates = value;
            return builder;
          },
          eq() {
            return builder;
          },
          select() {
            return builder;
          },
          async single() {
            Object.assign(job, updates);
            return { data: { ...job }, error: null };
          },
        };
        return builder;
      },
    },
  });
  const calls = [];
  replace('node-fetch', async (url) => {
    calls.push(url);
    assert.match(String(url), /claims\/info\?/);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ status: 'ready_for_approval', version: 3, ...offer('5001') }),
    };
  });
  const keys = {
    YANDEX_DELIVERY_ENABLED: 'true',
    YANDEX_DELIVERY_API_TOKEN: 'test-token',
    YANDEX_DELIVERY_SENDER_PHONE: '+77001234567',
    YANDEX_DELIVERY_MAX_PRICE_KZT: '5000',
  };
  const oldEnv = Object.fromEntries(Object.keys(keys).map((key) => [key, process.env[key]]));
  Object.assign(process.env, keys);
  const id = require.resolve('../src/services/yandex-delivery.service');
  replacements.push([id, require.cache[id]]);
  delete require.cache[id];
  t.after(() => {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const [key, value] of replacements.reverse()) {
      if (value) require.cache[key] = value;
      else delete require.cache[key];
    }
  });
  const service = require(id);
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(service.syncDeliveryJob({ ...job }), {
      code: 'YANDEX_CARGO_PRICE_LIMIT_EXCEEDED',
    });
  }
  assert.equal(calls.length, 2);
  assert.equal(job.provider_status, 'ready_for_approval');
  assert.equal(job.provider_price, 5001);
  assert.match(job.last_error, /5000/);
});

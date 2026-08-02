const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const loadService = (t, rpc) => {
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/commerce-marketing.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase: { rpc } },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });
  return require(servicePath);
};

test('promotion reservation lifecycle preserves status and fails closed on missing attach', async (t) => {
  const calls = [];
  const service = loadService(t, async (name, args) => {
    calls.push({ name, args });
    if (name === 'reserve_order_promotion') {
      return { data: { status: 'active', reservationId: 'reservation-1' }, error: null };
    }
    if (name === 'attach_order_promotion_reservation') {
      return { data: false, error: null };
    }
    if (name === 'consume_order_promotion_reservation') {
      return { data: { status: 'unavailable', reason: 'promotion_limit' }, error: null };
    }
    return { data: true, error: null };
  });

  const reserved = await service.reservePromotionForCheckout(
    { promotionId: 'promotion-1' },
    {
      customerId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
      ttlMinutes: 35,
    },
  );
  assert.equal(reserved.status, 'active');
  assert.equal(calls[0].args.p_ttl_minutes, 35);

  await assert.rejects(
    () =>
      service.attachPromotionReservation(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ),
    (error) => error.statusCode === 409 && /Резерв промокода истёк/.test(error.message),
  );

  const consumed = await service.consumePromotionReservation({
    id: '33333333-3333-4333-8333-333333333333',
    customer_id: '11111111-1111-4111-8111-111111111111',
    promo_code: 'BULKA10',
  });
  assert.deepEqual(consumed, { status: 'unavailable', reason: 'promotion_limit' });
});

test('marketing integrity migration serialises capacity and enforces referral max uses', () => {
  const sql = fs.readFileSync(
    path.resolve(
      __dirname,
      '../supabase/migrations/20260729110000_marketing_reservation_integrity.sql',
    ),
    'utf8',
  );
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('promotion-capacity:'/);
  assert.match(
    sql,
    /v_referral\.max_uses is not null and v_referral\.uses_count >= v_referral\.max_uses/,
  );
  assert.match(sql, /return jsonb_build_object\('status', 'limit_reached'\)/);
  assert.match(
    sql,
    /status = 'active' and expires_at > now\(\)/,
    'attach must not accept an expired active promotion reservation',
  );
  assert.match(
    sql,
    /'status', 'unavailable', 'reason', 'promotion_inactive'/,
    'late payment must not revive a disabled or ended promotion',
  );
  assert.match(
    sql,
    /and customer_id = p_customer_id\s+and client_request_id = p_client_request_id/,
    'promotion attachment must verify ownership of the order',
  );
  const consumeStart = sql.indexOf(
    'create or replace function public.consume_order_promotion_reservation',
  );
  const consumeSql = sql.slice(consumeStart, sql.indexOf('$$;', consumeStart) + 3);
  assert.ok(
    consumeSql.indexOf("pg_advisory_xact_lock(hashtext('promotion-capacity:'") <
      consumeSql.indexOf('for update;', consumeSql.indexOf('targeted_promotions promotion')),
    'consume must take the advisory lock before locking the promotion row',
  );
});

test('checkout controllers attach a promotion reservation only when a promotion was applied', () => {
  for (const controller of ['kaspi.controller.js', 'forte.controller.js']) {
    const source = fs.readFileSync(
      path.resolve(__dirname, `../src/controllers/${controller}`),
      'utf8',
    );
    assert.match(
      source,
      /if \(pricing\.promotionId\) \{\s+await attachPromotionReservation\(/,
      `${controller} must leave ordinary checkouts without a promotion reservation`,
    );
  }
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { normalizeAddressInput } = require('../src/services/address.service');
const {
  AKTAU_BOUNDS,
  insideAktauBounds,
  normalizeLanguage,
} = require('../src/services/geocode.service');
const { validateCheckout } = require('../src/services/checkout.service');
const { searchCustomers } = require('../src/services/customer.service');
const menuService = require('../src/services/menu.service');

test('saved delivery addresses are normalized and require map coordinates', () => {
  assert.deepEqual(
    normalizeAddressInput({
      label: '  Дом\u0000 ',
      address: '  11-й   микрорайон, 25  ',
      latitude: '43.654',
      longitude: '51.198',
      courierComment: ' Позвонить   заранее ',
      isDefault: true,
    }),
    {
      label: 'Дом',
      address: '11-й микрорайон, 25',
      city: 'Актау',
      latitude: 43.654,
      longitude: 51.198,
      entrance: null,
      floor: null,
      apartment: null,
      comment: 'Позвонить заранее',
      isDefault: true,
    },
  );
  assert.throws(
    () => normalizeAddressInput({ address: '11-й микрорайон, 25' }),
    /адрес на карте/,
  );
});

test('geocoding is bounded to Aktau and language input is allowlisted', () => {
  assert.equal(insideAktauBounds(43.65, 51.2), true);
  assert.equal(insideAktauBounds(AKTAU_BOUNDS.north + 0.01, 51.2), false);
  assert.equal(normalizeLanguage('kk-KZ,ru;q=0.9'), 'kk');
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('../../etc/passwd'), 'ru');
});

test('canonical seeded location UUIDs are accepted by checkout', () => {
  const branchId = '48f71218-aa08-51bf-a6d9-2497c4a1e55b';
  const result = validateCheckout(
    {
      orderType: 'pickup',
      branchId,
      scheduledAt: '2026-07-14T10:00:00+05:00',
    },
    [
      {
        name: 'Актау',
        points: [
          {
            id: branchId,
            name: 'ЖК Дукат',
            address: '17-й микрорайон, 1',
            hours: { daily: { open: '08:00', close: '24:00' } },
          },
        ],
      },
    ],
    {
      now: new Date('2026-07-13T12:00:00.000Z'),
      env: { ORDER_TIMEZONE_OFFSET_MINUTES: '300', ORDER_MIN_LEAD_MINUTES: '10' },
    },
  );
  assert.equal(result.branchId, branchId);
});

test('cashier search returns actionable validation errors for stale and forged codes', async (t) => {
  const previousSecret = process.env.BULKA_SECRET;
  process.env.BULKA_SECRET = 's'.repeat(32);
  t.after(() => {
    if (previousSecret === undefined) delete process.env.BULKA_SECRET;
    else process.env.BULKA_SECRET = previousSecret;
  });

  const staleWindow = Math.floor(Date.now() / 300000) - 2;
  await assert.rejects(
    () => searchCustomers(`BULKA-OTP-77771234567-${staleWindow}-0000000000000000`),
    (error) => error.statusCode === 400 && /истек/.test(error.message),
  );
  const currentWindow = Math.floor(Date.now() / 300000);
  await assert.rejects(
    () => searchCustomers(`BULKA-OTP-77771234567-${currentWindow}-0000000000000000`),
    (error) => error.statusCode === 401 && /поддельный/.test(error.message),
  );
  await assert.rejects(
    () => searchCustomers('CARD-not-a-card'),
    (error) => error.statusCode === 400 && /Wallet/.test(error.message),
  );
});

test('migration contains reusable reservations and the full cashier RPC contract', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '009_order_fulfillment.sql'),
    'utf8',
  );
  const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase_schema.sql'), 'utf8');
  for (const sql of [migration, schema]) {
    assert.match(sql, /preferred_language varchar\(2\)/);
    assert.match(sql, /create or replace function public\.consume_whatsapp_otp/);
    assert.match(sql, /for update;[\s\S]*delete from public\.whatsapp_sessions/);
    assert.match(sql, /create or replace function public\.reserve_loyalty_balance/);
    assert.match(sql, /create or replace function public\.commit_loyalty_reservation/);
    assert.match(sql, /create or replace function public\.cancel_loyalty_reservation/);
    assert.match(sql, /customer_id = p_customer_id,[\s\S]*status = 'active'/);
    assert.match(sql, /cancelled_at = null/);
  }
});

test('admin menu writes reject invalid prices, URLs and custom products before database access', async () => {
  await assert.rejects(
    () => menuService.setProductOverride('product-1', { custom_price: -1 }),
    (error) => error.statusCode === 400 && /цена/.test(error.message),
  );
  await assert.rejects(
    () => menuService.setCategoryOverride('category-1', { custom_image_url: 'http://example.test/a.jpg' }),
    (error) => error.statusCode === 400 && /HTTPS/.test(error.message),
  );
  await assert.rejects(
    () =>
      menuService.upsertCustomProduct({
        name: 'Товар',
        category_name: 'Категория',
        price: 0,
      }),
    (error) => error.statusCode === 400 && /цена/.test(error.message),
  );
});

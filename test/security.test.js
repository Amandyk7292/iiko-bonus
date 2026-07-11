const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { signCustomerToken, verifyToken } = require('../src/services/auth.service');
const { validateRuntimeConfig, shouldRunBots } = require('../src/config/env');
const { parseMoney } = require('../src/utils/money.util');
const { getTierInfo } = require('../src/utils/tier.util');
const {
  buildWhatsAppContact,
  normalizeWhatsAppBusinessPhone,
  resolveWhatsAppSenderDigits,
} = require('../src/utils/whatsapp.util');
const {
  assertTierSet,
  normalizeLanguage,
  validateTierPayload,
} = require('../src/services/tier.service');

test('customer token is signed, scoped and verifiable', () => {
  const previous = process.env.CUSTOMER_JWT_SECRET;
  process.env.CUSTOMER_JWT_SECRET = 'a'.repeat(64);
  try {
    const token = signCustomerToken({ id: 'customer-id', phone: '77001234567' });
    const payload = verifyToken(token, 'bulka-mobile');
    assert.equal(payload.sub, 'customer-id');
    assert.equal(payload.role, 'customer');
    assert.throws(() => verifyToken(token, 'bulka-admin'));
  } finally {
    if (previous === undefined) delete process.env.CUSTOMER_JWT_SECRET;
    else process.env.CUSTOMER_JWT_SECRET = previous;
  }
});

test('bots run independently from background workers', () => {
  assert.equal(shouldRunBots({ RUN_BACKGROUND_WORKERS: 'false' }), true);
  assert.equal(shouldRunBots({ RUN_BACKGROUND_WORKERS: 'false', RUN_BOTS: 'false' }), false);
});

test('WhatsApp sender resolves from PN alternative and LID mapping', async () => {
  assert.equal(
    await resolveWhatsAppSenderDigits({
      remoteJid: '123456789@lid',
      remoteJidAlt: '77762003590@s.whatsapp.net',
    }),
    '77762003590',
  );

  const lidMapping = {
    getPNForLID: async () => '77762003590@s.whatsapp.net',
  };
  assert.equal(
    await resolveWhatsAppSenderDigits({ remoteJid: '123456789@lid' }, lidMapping),
    '77762003590',
  );
});

test('production configuration fails closed when secrets are missing', () => {
  const keys = [
    'NODE_ENV',
    'RENDER',
    'VERCEL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ADMIN_PASSWORD',
    'BULKA_SECRET',
    'CUSTOMER_JWT_SECRET',
    'API_SECRET',
    'API_TOKEN',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.NODE_ENV = 'production';
    assert.throws(validateRuntimeConfig, /Missing or weak production configuration/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('money parser rejects non-finite and out-of-range values', () => {
  assert.throws(() => parseMoney('Infinity', 'amount'));
  assert.throws(() => parseMoney(-1, 'amount'));
  assert.equal(parseMoney('12.50', 'amount'), 12.5);
  assert.equal(parseMoney('12.345', 'amount'), 12.35);
});

test('tier calculation honors zero cashback and platinum tier', () => {
  const settings = {
    base_cashback_percent: 0,
    tier_silver_th: 50000,
    tier_silver_cb: 5,
    tier_gold_th: 150000,
    tier_gold_cb: 7,
    tier_platinum_th: 300000,
    tier_platinum_cb: 10,
  };
  assert.equal(getTierInfo(0, settings).percent, 0);
  assert.equal(getTierInfo(300000, settings).name, 'Платина');
});

test('dynamic tier calculation keeps legacy fields and reports range progress', () => {
  const tiers = [
    {
      id: '1',
      code: 'starter',
      names: { ru: 'Старт', kk: 'Бастау', en: 'Starter' },
      descriptions: { ru: 'Старт', kk: 'Бастау', en: 'Starter' },
      minSpend: 0,
      cashbackPercent: 2.5,
      sortOrder: 0,
      isActive: true,
    },
    {
      id: '2',
      code: 'pro',
      names: { ru: 'Про', kk: 'Кәсіби', en: 'Pro' },
      descriptions: { ru: 'Про', kk: 'Кәсіби', en: 'Pro' },
      minSpend: 1000,
      cashbackPercent: 7.5,
      sortOrder: 1,
      isActive: true,
    },
    {
      id: '3',
      code: 'elite',
      names: { ru: 'Элита', kk: 'Элита', en: 'Elite' },
      descriptions: { ru: 'Элита', kk: 'Элита', en: 'Elite' },
      minSpend: 3000,
      cashbackPercent: 12,
      sortOrder: 2,
      isActive: true,
    },
  ];
  const result = getTierInfo(2000, tiers);
  assert.equal(result.code, 'pro');
  assert.equal(result.name, 'Про');
  assert.equal(result.percent, 7.5);
  assert.equal(result.nextTier, 'Элита');
  assert.equal(result.remaining, 1000);
  assert.equal(result.progress, 50);
  assert.equal(result.allTiers.length, 3);
});

test('tier payload requires three languages and detects threshold conflicts', () => {
  const valid = validateTierPayload({
    code: 'diamond',
    names: { ru: 'Бриллиант', kk: 'Гауһар', en: 'Diamond' },
    descriptions: {
      ru: 'Максимальный уровень',
      kk: 'Ең жоғары деңгей',
      en: 'Highest level',
    },
    minSpend: 500000,
    cashbackPercent: 15,
    sortOrder: 4,
    isActive: true,
  });
  assert.equal(valid.names.kk, 'Гауһар');
  assert.equal(normalizeLanguage('kz-KZ'), 'kk');
  assert.throws(() => validateTierPayload({ ...valid, names: { ru: 'Только RU' } }), /names\.kk/);
  assert.throws(
    () =>
      assertTierSet([
        { ...valid, id: 'a', minSpend: 0 },
        { ...valid, id: 'b', code: 'second', minSpend: 0 },
      ]),
    (error) => error.code === 'TIER_RANGE_CONFLICT' && error.statusCode === 409,
  );
});

test('WhatsApp OTP contact uses only validated environment number', () => {
  assert.equal(normalizeWhatsAppBusinessPhone('+7 (776) 200-35-90'), '77762003590');
  assert.equal(normalizeWhatsAppBusinessPhone('123'), null);
  assert.deepEqual(buildWhatsAppContact('REQUEST123456', {}), {
    whatsappPhone: null,
    whatsappUrl: null,
  });
  assert.deepEqual(
    buildWhatsAppContact('REQUEST123456', { WHATSAPP_BUSINESS_PHONE: '+7 776 200 35 90' }),
    {
      whatsappPhone: '77762003590',
      whatsappUrl:
        'https://wa.me/77762003590?text=%D0%BA%D0%BE%D0%B4%20REQUEST123456',
    },
  );
});

test('loyalty service sends named RPC arguments', async () => {
  const configPath = require.resolve('../src/config/supabase');
  const pushPath = require.resolve('../src/services/push.service');
  const customerPath = require.resolve('../src/services/customer.service');
  const previousConfig = require.cache[configPath];
  const previousPush = require.cache[pushPath];
  const previousCustomer = require.cache[customerPath];
  let rpcArgs;

  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      supabase: {
        rpc: async (_name, args) => {
          rpcArgs = args;
          return { data: { balance: 95 }, error: null };
        },
      },
    },
  };
  require.cache[pushPath] = { id: pushPath, filename: pushPath, loaded: true, exports: {} };
  delete require.cache[customerPath];

  try {
    const { applyLoyaltyTransaction } = require('../src/services/customer.service');
    await applyLoyaltyTransaction({
      customerId: '11111111-1111-1111-1111-111111111111',
      orderId: 'order-1',
      discountAmount: 10,
      earnedBonus: 5,
      orderTotal: 100,
      realMoneyPaid: 90,
      activationDelayDays: 0,
      items: [],
    });
    assert.equal(rpcArgs.p_customer_id, '11111111-1111-1111-1111-111111111111');
    assert.equal(rpcArgs.p_order_id, 'order-1');
    assert.equal(rpcArgs.p_discount_amount, 10);
  } finally {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousPush) require.cache[pushPath] = previousPush;
    else delete require.cache[pushPath];
    if (previousCustomer) require.cache[customerPath] = previousCustomer;
    else delete require.cache[customerPath];
  }
});

test('tracked source contains no known fallback secrets', () => {
  const root = path.resolve(__dirname, '..');
  const files = [
    'src/middlewares/auth.middleware.js',
    'src/middlewares/webhook.middleware.js',
    'src/services/telegram.service.js',
    'src/services/whatsapp-baileys.service.js',
  ];
  const source = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /225588|bulka_secret_123|8786019464:/);
  assert.doesNotMatch(source, /WHATSAPP MOCK/);
  assert.equal(fs.existsSync(path.join(root, 'AuthKey_5UG437FF37 (2).p8')), false);
});

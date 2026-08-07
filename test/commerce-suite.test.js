const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  validateBuilder,
  validateModifierGroups,
} = require('../src/services/product-options.service');
const { buildRefundPreview, calculateRefund } = require('../src/services/partial-refund.service');
const { distanceKm, etaMinutesForKm } = require('../src/services/dispatch.service');
const { ROLE_AREAS } = require('../src/middlewares/auth.middleware');
const { cleanPhone } = require('../src/services/courier.service');
const { branchScopeForAdmin, NO_BRANCH_SCOPE } = require('../src/utils/admin-scope.util');
const {
  issueGiftCard,
  matchesPromotionAudience,
  savePromotion,
} = require('../src/services/commerce-marketing.service');

test('refund options advertise partial-refund preview support', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'partial-refund.service.js'),
    'utf8',
  );
  const getOptionsSource = source.slice(
    source.indexOf('async function getRefundOptions'),
    source.indexOf('function calculateRefund'),
  );
  assert.match(getOptionsSource, /previewSupported:\s*true/);
});

test('cake builder validates required variants and calculates trusted delta', () => {
  const configuration = {
    enabled: true,
    productKind: 'cake',
    allowInscription: true,
    inscriptionMaxLength: 20,
    allowCandles: true,
    allowReferenceUpload: true,
    minLeadHours: 2,
    maxAdvanceDays: 30,
    weightOptions: [{ code: '1kg', name: '1 кг', priceDelta: 1000 }],
    fillingOptions: [{ code: 'berry', name: 'Ягодная', priceDelta: 700 }],
    designOptions: [],
  };
  const result = validateBuilder(configuration, {
    weight: '1kg',
    filling: 'berry',
    inscription: 'С днём рождения',
    candles: 2,
    readyAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(result.priceDelta, 1700);
  assert.equal(result.candles, 2);
  assert.throws(
    () => validateBuilder(configuration, { weight: 'forged', filling: 'berry' }),
    /Выберите вариант/,
  );
});

test('required modifier groups reject forged and incomplete selections', () => {
  const groups = [
    {
      id: 'size',
      code: 'size',
      title: { ru: 'Размер' },
      selectionType: 'single',
      required: true,
      minSelected: 1,
      maxSelected: 1,
      options: [{ id: 'large', code: 'large', title: { ru: 'Большой' }, priceDelta: 500 }],
    },
  ];
  assert.equal(
    validateModifierGroups(groups, [{ groupId: 'size', optionId: 'large' }]).priceDelta,
    500,
  );
  assert.throws(() => validateModifierGroups(groups, []), /Выберите/);
  assert.throws(
    () => validateModifierGroups(groups, [{ groupId: 'size', optionId: 'fake' }]),
    /недоступен/,
  );
});

test('tag-only promotions reject customers without the required tag', () => {
  const promotion = { customer_ids: [], customer_tags: ['vip'] };
  assert.equal(matchesPromotionAudience(promotion, 'customer-a', []), false);
  assert.equal(matchesPromotionAudience(promotion, 'customer-a', ['vip']), true);
  assert.equal(
    matchesPromotionAudience(
      { customer_ids: ['customer-b'], customer_tags: ['vip'] },
      'customer-b',
      [],
    ),
    true,
  );
});

test('promotion editor rejects unsafe discounts, limits, and date ranges before storage', async () => {
  await assert.rejects(
    () => savePromotion({ code: 'TOO-MUCH', discountType: 'percent', discountValue: 101 }),
    /Некорректное значение: Размер скидки/,
  );
  await assert.rejects(
    () => savePromotion({ code: 'BAD-LIMIT', discountValue: 10, perCustomerLimit: 1.5 }),
    /укажите целое число/,
  );
  await assert.rejects(
    () =>
      savePromotion({
        code: 'BAD-DATES',
        discountValue: 10,
        startsAt: '2026-08-10T12:00',
        endsAt: '2026-08-09T12:00',
      }),
    /Дата окончания должна быть позже/,
  );
  await assert.rejects(
    () => issueGiftCard({ amount: 5000, expiresAt: '2000-01-01T00:00' }),
    /должен быть в будущем/,
  );
});

test('partial refund respects quantities and proportional order discount', () => {
  const order = {
    amount: 2700,
    subtotal: 3000,
    discount_amount: 300,
    partially_refunded_amount: 0,
    cart_items: [
      { id: 'a', lineKey: 'line-a', name: 'Торт', quantity: 2, price: 1000 },
      { id: 'b', lineKey: 'line-b', name: 'Свечи', quantity: 1, price: 1000 },
    ],
  };
  const already = { quantities: new Map(), amounts: new Map() };
  const result = calculateRefund(order, [{ lineKey: 'line-a', quantity: 1 }], already);
  assert.equal(result.amount, 900);
  assert.equal(result.records[0].quantity, 1);
  assert.throws(
    () => calculateRefund(order, [{ lineKey: 'line-a', quantity: 3 }], already),
    /доступно к возврату/,
  );
});

test('partial refund line allocation never exceeds the remaining paid amount', () => {
  const order = {
    amount: 5,
    subtotal: 6,
    discount_amount: 0,
    partially_refunded_amount: 4,
    cart_items: [{ id: 'a', lineKey: 'line-a', name: 'Товар', quantity: 3, price: 2 }],
  };
  const result = calculateRefund(order, [{ lineKey: 'line-a', quantity: 1 }], {
    quantities: new Map(),
    amounts: new Map(),
  });
  assert.equal(result.amount, 1);
  assert.equal(
    result.records.reduce((sum, row) => sum + row.refund_amount, 0),
    1,
  );
});

test('final merchandise refund also returns the delivery fee exactly once', () => {
  const order = {
    amount: 2500,
    subtotal: 2000,
    discount_amount: 0,
    delivery_fee: 500,
    partially_refunded_amount: 1000,
    cart_items: [{ id: 'a', lineKey: 'line-a', name: 'Хлеб', quantity: 2, price: 1000 }],
  };
  const result = calculateRefund(order, [{ lineKey: 'line-a', quantity: 1 }], {
    quantities: new Map([['line-a', 1]]),
    amounts: new Map([['line-a', 1000]]),
  });
  assert.equal(result.amount, 1500);
  assert.deepEqual(
    result.records.map((row) => row.line_key),
    ['line-a', '__delivery_fee__'],
  );

  const withoutDuplicateFee = calculateRefund(
    { ...order, amount: 2000, delivery_fee: 500, partially_refunded_amount: 1000 },
    [{ lineKey: 'line-a', quantity: 1 }],
    {
      quantities: new Map([
        ['line-a', 1],
        ['__delivery_fee__', 1],
      ]),
      amounts: new Map([
        ['line-a', 1000],
        ['__delivery_fee__', 500],
      ]),
    },
  );
  assert.equal(withoutDuplicateFee.amount, 1000);
  assert.equal(
    withoutDuplicateFee.records.some((row) => row.line_key === '__delivery_fee__'),
    false,
  );
});

test('refund clamp distributes excess across delivery and merchandise records', () => {
  const result = calculateRefund(
    {
      amount: 100,
      subtotal: 200,
      discount_amount: 0,
      delivery_fee: 10,
      partially_refunded_amount: 90,
      cart_items: [{ id: 'a', lineKey: 'line-a', name: 'Товар', quantity: 1, price: 200 }],
    },
    [{ lineKey: 'line-a', quantity: 1 }],
    { quantities: new Map(), amounts: new Map() },
  );
  assert.equal(result.amount, 10);
  assert.equal(
    result.records.reduce((sum, row) => sum + row.refund_amount, 0),
    10,
  );
  assert.equal(
    result.records.every((row) => row.refund_amount > 0),
    true,
  );
});

test('sequential quantity refunds allocate rounding cumulatively without over-refunding', () => {
  const order = {
    amount: 200,
    subtotal: 300,
    discount_amount: 100,
    partially_refunded_amount: 0,
    cart_items: [{ id: 'a', lineKey: 'line-a', name: 'Мини-товар', quantity: 3, price: 100 }],
  };
  const first = calculateRefund(order, [{ lineKey: 'line-a', quantity: 1 }], {
    quantities: new Map(),
    amounts: new Map(),
  });
  const second = calculateRefund(
    { ...order, partially_refunded_amount: first.amount },
    [{ lineKey: 'line-a', quantity: 1 }],
    {
      quantities: new Map([['line-a', 1]]),
      amounts: new Map([['line-a', first.amount]]),
    },
  );
  const third = calculateRefund(
    { ...order, partially_refunded_amount: first.amount + second.amount },
    [{ lineKey: 'line-a', quantity: 1 }],
    {
      quantities: new Map([['line-a', 2]]),
      amounts: new Map([['line-a', first.amount + second.amount]]),
    },
  );
  assert.deepEqual([first.amount, second.amount, third.amount], [67, 66, 67]);
  assert.equal(first.amount + second.amount + third.amount, order.amount);
});

test('discount rounding is allocated globally across different refund lines', () => {
  const order = {
    amount: 199,
    subtotal: 200,
    discount_amount: 1,
    partially_refunded_amount: 0,
    cart_items: [
      { id: 'a', lineKey: 'line-a', name: 'Первый товар', quantity: 1, price: 100 },
      { id: 'b', lineKey: 'line-b', name: 'Второй товар', quantity: 1, price: 100 },
    ],
  };
  const first = calculateRefund(order, [{ lineKey: 'line-a', quantity: 1 }], {
    quantities: new Map(),
    amounts: new Map(),
  });
  const second = calculateRefund(
    { ...order, partially_refunded_amount: first.amount },
    [{ lineKey: 'line-b', quantity: 1 }],
    {
      quantities: new Map([['line-a', 1]]),
      amounts: new Map([['line-a', first.amount]]),
    },
  );

  assert.deepEqual([first.amount, second.amount], [99, 100]);
  assert.equal(first.amount + second.amount, order.amount);
});

test('partial refund preview shows the remaining payment and loyalty adjustment without mutation', () => {
  const preview = buildRefundPreview(
    {
      amount: 1000,
      subtotal: 1000,
      discount_amount: 100,
      partially_refunded_amount: 100,
      earned_bonus: 90,
    },
    {
      amount: 350,
      records: [
        {
          line_key: 'line-a',
          product_id: 'a',
          product_name: 'Товар',
          quantity: 1,
          refund_amount: 350,
        },
      ],
    },
    {
      originalSpent: 200,
      priorSpentRestored: 20,
      priorEarnedReversed: 10,
    },
  );
  assert.deepEqual(preview, {
    amount: 350,
    remainingAfter: 550,
    items: [
      {
        lineKey: 'line-a',
        productId: 'a',
        name: 'Товар',
        quantity: 1,
        amount: 350,
      },
    ],
    adjustment: {
      spentBonusRestored: 80,
      earnedBonusReversed: 35,
    },
    currency: 'KZT',
  });
});

test('dispatch distance and ETA are bounded and deterministic', () => {
  const distance = distanceKm(43.6532, 51.1975, 43.66, 51.21);
  assert.ok(distance > 1 && distance < 2);
  assert.equal(etaMinutesForKm(0), 5);
  assert.ok(etaMinutesForKm(distance, 20) >= 25);
});

test('admin roles keep access management owner-only', () => {
  assert.equal(ROLE_AREAS.owner.has('*'), true);
  assert.equal(ROLE_AREAS.operator.has('orders'), true);
  assert.equal(ROLE_AREAS.operator.has('marketing'), false);
  assert.equal(ROLE_AREAS.viewer.has('access'), false);
  assert.equal(ROLE_AREAS.marketer.has('automations'), true);
});

test('release migration seeds every configurable marketing trigger', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260715090000_commerce_operations_suite.sql',
    ),
    'utf8',
  );
  for (const trigger of [
    'abandoned_cart',
    'birthday',
    'inactive',
    'bonus_expiring',
    'bonus_awarded',
  ]) {
    assert.match(migration, new RegExp(`'${trigger}'`));
  }
});

test('restricted admins never fall back to global branch access', () => {
  assert.deepEqual(branchScopeForAdmin({ role: 'owner', branchIds: [] }), []);
  assert.deepEqual(branchScopeForAdmin({ role: 'manager', branchIds: ['branch-a'] }), ['branch-a']);
  assert.deepEqual(branchScopeForAdmin({ role: 'operator', branchIds: [] }), [NO_BRANCH_SCOPE]);
});

test('courier phone login uses one canonical Kazakhstan phone format', () => {
  assert.equal(cleanPhone('8 (700) 123-45-67'), '+77001234567');
  assert.equal(cleanPhone('+7 700 123 45 67'), '+77001234567');
  assert.throws(() => cleanPhone('12345'), /формате \+7/);
});

test('courier OTP is issued only after the courier writes to the WhatsApp bot', () => {
  const courierSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'courier.service.js'),
    'utf8',
  );
  const whatsappSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'whatsapp-baileys.service.js'),
    'utf8',
  );
  const courierPage = fs.readFileSync(path.join(__dirname, '..', 'public', 'courier.html'), 'utf8');
  assert.doesNotMatch(courierSource, /sendWhatsAppMessage|SMS_OTP_WEBHOOK/);
  assert.match(courierSource, /channel:\s*'whatsapp_user_initiated'/);
  assert.match(courierSource, /COURIER_LOGIN_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
  assert.match(whatsappSource, /consumeCourierBotRequest\(token, senderDigits\)/);
  assert.match(courierPage, /requestChallenge\(codeForm, \{ automatic: true \}\)/);
  assert.match(courierPage, /Идентификатор автоматически обновлён/);
  assert.match(courierSource, /bulka_locations\(name,city,address,latitude,longitude\)/);
  assert.match(courierPage, /Забрать: \$\{esc\(pickupName\)\}/);
  assert.match(courierPage, /Комментарий клиента:/);
  assert.match(courierPage, /Что забрать/);
});

test('hardening migration keeps refunds and delivery handoff atomic', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260715120000_financial_branch_courier_hardening.sql',
    ),
    'utf8',
  );
  assert.match(migration, /create or replace function public\.claim_partial_refund/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('partial-refund-claim:/i);
  assert.match(migration, /create or replace function public\.fail_partial_refund/i);
  assert.match(migration, /create or replace function public\.reverse_loyalty_order/i);
  assert.match(migration, /v_delta_spent := greatest\(0, v_original_spent - v_prior_spent\)/i);
  assert.match(migration, /create or replace function public\.apply_partial_refund_adjustments/i);
  assert.match(migration, /create or replace function public\.complete_courier_delivery/i);
  assert.match(migration, /btrim\(p_delivery_pin\) <> v_order\.delivery_pin/i);
  assert.match(migration, /create table if not exists public\.courier_auth_sessions/i);
  assert.match(migration, /create table if not exists public\.courier_route_events/i);
});

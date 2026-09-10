const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildReceiptRecord,
  customerPaymentReceipt,
  normalizeReceiptItems,
  paymentReceiptUrl,
  renderPaymentReceipt,
  signReceiptId,
  verifyReceiptSignature,
} = require('../src/services/payment-receipt.service');

const root = path.resolve(__dirname, '..');
const receiptId = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
const env = {
  RECEIPT_SIGNING_SECRET: 'r'.repeat(64),
  RECEIPT_LINK_TTL_SECONDS: '3600',
  PUBLIC_BASE_URL: 'https://bulka.com.kz',
};
const nowMs = Date.parse('2026-07-25T10:00:00.000Z');
const expiresAt = Math.floor(nowMs / 1000) + 3600;

test('receipt totals preserve actual fractional payment, discount and delivery amounts', () => {
  const record = buildReceiptRecord(
    {
      id: receiptId,
      order_number: 100501,
      amount: 1060.3,
      cart_items: [{ id: 'drink', name: 'Лимонад', quantity: 1, price: 990 }],
      created_at: '2026-09-07T10:00:00Z',
    },
    { provider: 'ForteBank', paymentSystem: 'Visa' },
  );
  const html = renderPaymentReceipt(
    { ...record, order: { discount_amount: 29.7, delivery_fee: 100 } },
    'ru',
  );
  assert.match(html, /Товары<\/dt><dd>990/);
  assert.match(html, /Скидка<\/dt><dd>−29,7/);
  assert.match(html, /Доставка<\/dt><dd>100/);
  assert.match(html, /grand-total[\s\S]*?1\s060,3/);
  assert.match(html, /Оплачено картой<\/dt>/);
  assert.doesNotMatch(html, /Наличными|Написать отзыв/);
  const withoutOrder = renderPaymentReceipt(record, 'ru');
  assert.doesNotMatch(withoutOrder, /Скидка<\/dt>|Доставка<\/dt>/);
});

test('payment receipt links are signed, expiring, and reject tampering', () => {
  const signature = signReceiptId(receiptId, expiresAt, env);
  assert.equal(verifyReceiptSignature(receiptId, signature, expiresAt, env, nowMs), true);
  assert.equal(verifyReceiptSignature(receiptId, `${signature}x`, expiresAt, env, nowMs), false);
  assert.equal(
    verifyReceiptSignature(receiptId, signature, expiresAt, env, (expiresAt + 1) * 1000),
    false,
  );
  assert.equal(verifyReceiptSignature(receiptId, signature, null, env, nowMs), false);
  assert.equal(
    paymentReceiptUrl(receiptId, env, 'ru', nowMs),
    `https://bulka.com.kz/payment-receipts/${receiptId}?expires=${expiresAt}&token=${signature}`,
  );
  assert.equal(
    paymentReceiptUrl(receiptId, env, 'kk', nowMs),
    `https://bulka.com.kz/payment-receipts/${receiptId}?expires=${expiresAt}&token=${signature}&lang=kk`,
  );
});

test('payment receipts stay in order details and are not queued to WhatsApp', () => {
  const receiptSource = fs.readFileSync(
    path.join(root, 'src', 'services', 'payment-receipt.service.js'),
    'utf8',
  );
  const orderSource = fs.readFileSync(
    path.join(root, 'src', 'services', 'customer-order.service.js'),
    'utf8',
  );
  assert.doesNotMatch(receiptSource, /enqueueWhatsAppText|sourceType:\s*'payment_receipt'/);
  assert.match(orderSource, /payment_receipts\(id,language\)/);
  assert.match(orderSource, /paymentReceiptUrl\(relation\.id/);
});

test('customer receipt shows purchased items and payment card without merchant or provider panels', () => {
  const record = buildReceiptRecord(
    {
      id: '217615f9-b35f-4eb4-9f6d-777f2236bb25',
      customer_id: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
      order_number: 100501,
      operation_id: 'forte-operation-1',
      payment_method: 'forte_card',
      amount: 4800,
      cart_items: [{ id: 'cake', name: '<Датский с маком>', quantity: 2, price: 2400 }],
      created_at: '2026-07-25T10:00:00.000Z',
    },
    {
      provider: 'ForteBank',
      paymentSystem: 'Visa',
      merchantCode: 'MERCHANT-1',
      cardFirstSix: '411111',
      cardLastFour: '1111',
      authorizationCode: 'AUTH-1',
    },
  );
  const html = renderPaymentReceipt({ id: receiptId, ...record });

  assert.deepEqual(normalizeReceiptItems(record.items)[0], {
    id: 'cake',
    name: '<Датский с маком>',
    quantity: 2,
    unit: 'шт.',
    unitPrice: 2400,
    lineTotal: 4800,
    name_translations: { ru: '<Датский с маком>' },
  });
  for (const label of ['Номер заказа', 'Дата и время', 'Состав заказа']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /Оплачено картой \*1111/);
  assert.doesNotMatch(html, /Данные платежа и продавца|receipt-extra|411111|AUTH-1|MERCHANT-1/);
  assert.match(html, /&lt;Датский с маком&gt;/);
  assert.doesNotMatch(html, /4111111111111111/);

  const kazakh = renderPaymentReceipt({ id: receiptId, ...record }, 'kk', {
    token: 'signed-token',
    expiresAt,
  });
  assert.match(kazakh, /<html lang="kk">/);
  assert.match(kazakh, /Төлем түбіртегі/);
  assert.match(kazakh, /Тапсырыс құрамы/);
  assert.match(
    kazakh,
    new RegExp(`\\?expires=${expiresAt}(?:&amp;|&)token=signed-token(?:&amp;|&)lang=en`),
  );

  const english = renderPaymentReceipt({ id: receiptId, ...record }, 'en');
  assert.match(english, /<html lang="en">/);
  assert.match(english, /Payment receipt/);
  assert.match(english, /Order items/);
});

test('native receipt data exposes only the paid order and recovers its own card suffix', () => {
  const receipt = buildReceiptRecord({
    id: receiptId,
    order_number: 100039,
    amount: 1060.3,
    cart_items: [{ name: 'Плюшка Московская', quantity: 2, price: 495 }],
    created_at: '2026-09-08T10:00:00Z',
    payment_method: 'forte_card',
  });
  const data = customerPaymentReceipt({
    ...receipt,
    payment_system: 'forte_widget',
    order: {
      provider_card_last_four: '1328',
      discount_amount: 29.7,
      delivery_fee: 100,
    },
  });
  assert.equal(data.cardLastFour, '1328');
  assert.equal(data.amount, 1060.3);
  assert.equal(data.items[0].name_translations.en, 'Moscow sugar bun');
  assert.equal(data.items[0].lineTotal, 990);
  assert.equal(data.discount, 29.7);
  assert.equal(data.deliveryFee, 100);
  assert.equal(data.hasDelivery, true);
  assert.doesNotMatch(
    JSON.stringify(data),
    /forte_widget|merchant|authorization|customer_id|card_first_six/,
  );
  assert.equal(customerPaymentReceipt(receipt).cardLastFour, null);
  assert.equal(
    customerPaymentReceipt({ ...receipt, card_last_four: '1234567890123456' }).cardLastFour,
    null,
  );
});

test('receipt separates the paid delivery fee and shows free delivery including preorders', () => {
  const record = buildReceiptRecord({
    id: receiptId,
    order_number: 100043,
    amount: 2506,
    cart_items: [{ name: 'Плюшка Московская', quantity: 1, price: 35 }],
    created_at: '2026-09-09T08:00:00Z',
  });
  const paid = {
    ...record,
    order: { fulfillment_type: 'delivery', delivery_fee: 2471, provider_delivery_price: 3000 },
  };
  const html = renderPaymentReceipt(paid, 'ru');
  assert.match(html, /Товары<\/dt><dd>35 ₸/);
  assert.match(html, /Доставка<\/dt><dd>2\s471 ₸/);
  assert.match(html, /Итого<\/dt><dd>2\s506 ₸/);
  assert.equal(customerPaymentReceipt(paid).deliveryFee, 2471);

  for (const type of ['delivery']) {
    const free = {
      ...record,
      amount: 10000,
      order: { fulfillment_type: type, preorder_fulfillment_type: 'delivery', delivery_fee: 0 },
    };
    assert.equal(customerPaymentReceipt(free).hasDelivery, true);
    for (const [language, label] of [
      ['ru', 'Доставка'],
      ['kk', 'Жеткізу'],
      ['en', 'Delivery'],
    ]) {
      assert.match(renderPaymentReceipt(free, language), new RegExp(`${label}</dt><dd>0 ₸`));
    }
  }
  const pickup = { ...record, order: { fulfillment_type: 'pickup', delivery_fee: 0 } };
  assert.equal(customerPaymentReceipt(pickup).hasDelivery, false);
  assert.doesNotMatch(renderPaymentReceipt(pickup, 'ru'), /Доставка<\/dt>/);
});

test('canonical Forte payment migration adds reconciliation-safe metadata', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20260725110000_fortebank_payments.sql'),
    'utf8',
  );
  assert.match(migration, /provider_transaction_id varchar\(100\)/i);
  assert.match(migration, /refund_request_id uuid/i);
  assert.match(migration, /payment_reconciled_at timestamptz/i);
  assert.match(migration, /language char\(2\).*default 'ru'/i);
  assert.doesNotMatch(migration, /\b(?:full_pan|cvv|cvc)\b/i);
});

test('account deletion is available in Russian, Kazakh and English', () => {
  const pages = [
    ['account-deletion.html', 'ru', 'Удаление аккаунта Bulka'],
    ['account-deletion.kk.html', 'kk', 'Bulka аккаунтын жою'],
    ['account-deletion.en.html', 'en', 'Delete your Bulka account'],
  ];
  for (const [file, language, heading] of pages) {
    const html = fs.readFileSync(path.join(root, 'public', 'legal', file), 'utf8');
    assert.match(html, new RegExp(`<html lang="${language}">`));
    assert.match(html, new RegExp(heading));
    assert.match(html, /account-deletion\.js/);
  }
});

test('canonical receipt migration never stores full PAN or CVV', () => {
  const migration = fs.readFileSync(
    path.join(
      root,
      'supabase',
      'migrations',
      '20260725100000_forte_compliance_receipts_astana.sql',
    ),
    'utf8',
  );
  assert.match(migration, /create table if not exists public\.payment_receipts/i);
  assert.match(migration, /card_first_six varchar\(6\)/i);
  assert.match(migration, /card_last_four varchar\(4\)/i);
  assert.doesNotMatch(migration, /\b(?:full_pan|cvv|cvc)\b/i);
  assert.match(migration, /where city <> 'Астана'/);
  assert.equal((migration.match(/'Bulka —/g) || []).length, 5);
});

test('guest profile exposes every public legal page', () => {
  const source = fs.readFileSync(
    path.join(root, 'BulkaAndroid', 'lib', 'screens', 'legal_documents_screen.dart'),
    'utf8',
  );
  for (const slug of [
    'public-offer',
    'privacy',
    'terms',
    'payment-and-refund',
    'delivery-terms',
    'company-details',
  ]) {
    assert.match(source, new RegExp(`slug:\\s*'${slug}'`));
  }
  assert.match(source, /bulkaLegalPageUri\(slug\)/);

  const localization = fs.readFileSync(
    path.join(root, 'BulkaAndroid', 'lib', 'core', 'localization.dart'),
    'utf8',
  );
  assert.match(localization, /languageCode == 'ru'/);
  assert.match(localization, /'\/\$languageCode\/\$normalizedSlug'/);
});

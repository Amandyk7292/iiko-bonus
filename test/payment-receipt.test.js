const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildReceiptRecord,
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

test('payment receipt contains bank-required fields without full card data', () => {
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
    unitPrice: 2400,
    lineTotal: 4800,
  });
  for (const label of [
    'Номер заказа',
    'Дата и время',
    'Сумма и валюта',
    'Платёжная система',
    'Маска карты',
    'Код авторизации',
    'Код торговца',
    'Состав заказа',
  ]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /411111••••••1111/);
  assert.match(html, /&lt;Датский с маком&gt;/);
  assert.doesNotMatch(html, /4111111111111111/);

  const kazakh = renderPaymentReceipt(
    { id: receiptId, ...record },
    'kk',
    { token: 'signed-token', expiresAt },
  );
  assert.match(kazakh, /<html lang="kk">/);
  assert.match(kazakh, /Сауда чегі/);
  assert.match(kazakh, /Тапсырыс құрамы/);
  assert.match(
    kazakh,
    new RegExp(`\\?expires=${expiresAt}(?:&amp;|&)token=signed-token(?:&amp;|&)lang=en`),
  );

  const english = renderPaymentReceipt({ id: receiptId, ...record }, 'en');
  assert.match(english, /<html lang="en">/);
  assert.match(english, /Merchant receipt/);
  assert.match(english, /Order items/);
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
    path.join(root, 'BulkaAndroid', 'lib', 'shell', 'main_shell.dart'),
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
    assert.match(source, new RegExp(`bulkaLegalPageUri\\('${slug}'\\)`));
  }

  const localization = fs.readFileSync(
    path.join(root, 'BulkaAndroid', 'lib', 'core', 'localization.dart'),
    'utf8',
  );
  assert.match(localization, /languageCode == 'ru'/);
  assert.match(localization, /'\/\$languageCode\/\$normalizedSlug'/);
});

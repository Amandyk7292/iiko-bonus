const test = require('node:test');
const assert = require('node:assert/strict');

test('native receipt JSON keeps signature protection, privacy headers and safe localized items', async (t) => {
  process.env.RECEIPT_SIGNING_SECRET = 'receipt-http-test-only-'.repeat(4);
  const service = require('../src/services/payment-receipt.service');
  const original = service.getPaymentReceipt;
  const taplink = require('../src/services/taplink-html.service');
  const originalRefresh = taplink.refreshTaplinkHtmlConfig;
  taplink.refreshTaplinkHtmlConfig = async () => {};
  let reads = 0;
  const id = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
  service.getPaymentReceipt = async (requestedId) => {
    reads++;
    assert.equal(requestedId, id);
    return {
      document_number: 'BLK-100039',
      order_number: 100039,
      transaction_at: '2026-09-08T17:18:17Z',
      amount: 35,
      currency: 'KZT',
      provider: 'ForteBank',
      payment_system: 'forte_widget',
      card_last_four: '1328',
      merchant_name: 'Private seller data',
      customer_id: 'private-customer',
      authorization_code: 'private-code',
      items: [{ name: 'Плюшка Московская', quantity: 1, unitPrice: 35 }],
    };
  };
  const app = require('../src/app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.close();
    service.getPaymentReceipt = original;
    taplink.refreshTaplinkHtmlConfig = originalRefresh;
  });
  const base = `http://127.0.0.1:${server.address().port}/payment-receipts/${id}`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = service.signReceiptId(id, expires, process.env);
  for (const language of ['ru', 'kk', 'en']) {
    const response = await fetch(`${base}?expires=${expires}&token=${token}&lang=${language}`, {
      headers: { Accept: 'application/json' },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('content-language'), language);
    assert.match(response.headers.get('vary'), /Accept/);
    const data = await response.json();
    assert.equal(data.receipt.cardLastFour, '1328');
    assert.ok(data.receipt.items[0].name_translations[language]);
    assert.doesNotMatch(JSON.stringify(data), /forte_widget|private-|Private seller/);
  }
  const bad = await fetch(`${base}?expires=${expires}&token=${token}x`, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(bad.status, 403);
  const expiredAt = Math.floor(Date.now() / 1000) - 10;
  const expired = await fetch(
    `${base}?expires=${expiredAt}&token=${service.signReceiptId(id, expiredAt, process.env)}`,
    { headers: { Accept: 'application/json' } },
  );
  assert.equal(expired.status, 403);
  assert.equal(reads, 3, 'Invalid signatures must be rejected before loading a receipt');
});

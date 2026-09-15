const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { optionSummary, withOrderOptions } = require('../src/utils/order-options');
const { receiptDraft } = require('../src/services/front-receipt-draft.service');

const item = {
  iikoProductId: randomUUID(),
  name: 'Кофе',
  price: 800,
  basePrice: 500,
  quantity: 2,
  lineTotal: 1600,
  modifiers: [
    {
      title: { ru: 'Размер', kk: 'Өлшем' },
      options: [{ title: { ru: 'Большой', kk: 'Үлкен' }, priceDelta: 300 }],
    },
  ],
};
test('saved choices retain names, group, supplement and language independently of menu', () => {
  assert.equal(optionSummary(item), 'Размер: Большой (+300 ₸)');
  assert.equal(withOrderOptions(item).optionSummaries.kk, 'Өлшем: Үлкен (+300 ₸)');
  assert.equal(optionSummary({ modifiers: [null, { name: 'Сыр', quantity: 2 }] }), 'Сыр × 2');
  assert.equal(
    optionSummary({
      configuration: {
        weight: { title: { ru: '2 кг' }, priceDelta: 500 },
        inscription: 'Алия',
        candles: 3,
      },
    }),
    'Вес: 2 кг (+500 ₸); Надпись: Алия; Свечи: 3',
  );
  assert.deepEqual(withOrderOptions({ name: 'Хлеб' }), { name: 'Хлеб' });
});
test('configured receipt is version gated, keeps stock ID and charges supplement only once', () => {
  const order = {
    status: 'paid',
    fulfillment_status: 'preparing',
    subtotal: 1600,
    cart_items: [item],
  };
  assert.throws(() => receiptDraft(order), /Обновите плагин/);
  const draft = receiptDraft(order, 1);
  assert.equal(draft.items[0].customName, 'Кофе — Размер: Большой (+300 ₸)');
  assert.equal(draft.items[0].productId, item.iikoProductId);
  assert.equal(draft.items[0].price, 800);
  assert.equal(draft.merchandiseTotal, 1600);
  assert.throws(() => receiptDraft({ ...order, subtotal: 1599 }, 1));
  assert.throws(() =>
    receiptDraft({ ...order, cart_items: [{ ...item, productSizeId: randomUUID() }] }, 1),
  );
});

test('payment receipt preserves options through repeated normalization and escapes HTML', () => {
  const {
    normalizeReceiptItems,
    buildReceiptRecord,
    renderPaymentReceipt,
  } = require('../src/services/payment-receipt.service');
  const first = normalizeReceiptItems([item]);
  assert.deepEqual(normalizeReceiptItems(first)[0].optionSummaries, first[0].optionSummaries);
  const record = buildReceiptRecord({
    id: randomUUID(),
    order_number: 123456,
    amount: 1600,
    cart_items: [{ ...item, configuration: { inscription: '<script>test</script>' } }],
    created_at: new Date().toISOString(),
  });
  const html = renderPaymentReceipt(record, 'ru');
  assert.match(html, /Размер: Большой/);
  assert.match(html, /&lt;script&gt;test&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>test/);
});

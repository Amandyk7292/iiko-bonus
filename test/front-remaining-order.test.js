const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

function load(t, { order, receipt, receiptMap }) {
  const ids = [
    '../src/config/supabase',
    '../src/services/front-remaining-order.service',
    '../src/services/front-receipt-draft.service',
  ].map(require.resolve);
  const saved = ids.map((id) => require.cache[id]);
  const calls = [];
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: async () => ({ data: order }),
  };
  require.cache[ids[0]] = {
    id: ids[0],
    filename: ids[0],
    loaded: true,
    exports: {
      supabase: {
        from: () => query,
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: name === 'front_remaining_receipts' ? receiptMap : receipt };
        },
      },
    },
  };
  delete require.cache[ids[1]];
  delete require.cache[ids[2]];
  t.after(() =>
    ids.forEach((id, i) => {
      if (saved[i]) require.cache[id] = saved[i];
      else delete require.cache[id];
    }),
  );
  return { ...require(ids[1]), ...require(ids[2]), calls };
}

test('missing batch snapshot never labels the original partially refunded basket as ready', async (t) => {
  const id = randomUUID(),
    normal = { id: randomUUID(), refund_status: null };
  const order = {
    id,
    refund_status: 'partial',
    partially_refunded_amount: 0,
    cart_items: [{ quantity: 2 }],
  };
  const h = load(t, { receiptMap: {} });
  const result = await h.attachFrontRemainingOrders([order, normal]);
  assert.equal(result[0].remaining_receipt_ready, false);
  assert.match(result[0].remaining_receipt_error, /сверки/);
  assert.equal(result[1], normal);
  assert.deepEqual(h.calls[0].args, { p_orders: [id] });
  assert.throws(() =>
    h.receiptDraft({ ...result[0], status: 'paid', fulfillment_status: 'preparing' }),
  );
});

test('receipt draft checks unfinished substitution even without a monetary refund', async (t) => {
  const order = { id: randomUUID(), partially_refunded_amount: 0 };
  const h = load(t, {
    order,
    receipt: { ready: false, reason: 'Дождитесь завершения замены товара' },
  });
  await assert.rejects(h.getFrontReceiptDraft(randomUUID(), 123456), {
    statusCode: 409,
    message: 'Дождитесь завершения замены товара',
  });
  assert.equal(h.calls[0].name, 'front_remaining_receipt');
});

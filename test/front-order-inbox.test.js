const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  frontOrdersQuerySchema,
  frontOrderDecisionSchema,
  frontOrderPollSchema,
} = require('../src/contracts/front-order-inbox.contract');
const {
  frontStockSaleSchema,
  frontStockFinishSchema,
} = require('../src/contracts/front-stock-guard.contract');

function stub(t, path, exports) {
  const id = require.resolve(path),
    previous = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  });
}
function fresh(t, path) {
  const id = require.resolve(path),
    previous = require.cache[id];
  delete require.cache[id];
  t.after(() => {
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  });
  return require(path);
}
function inbox(t, data) {
  const reads = [],
    actions = [];
  const query = {
    then(resolve) {
      return Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0 }).then(resolve);
    },
  };
  for (const method of ['select', 'eq', 'in', 'is', 'order', 'range', 'limit', 'maybeSingle'])
    query[method] = (...args) => {
      reads.push([method, ...args]);
      return query;
    };
  stub(t, '../src/config/supabase', {
    supabase: {
      from: (...args) => {
        reads.push(['from', ...args]);
        return query;
      },
    },
  });
  stub(t, '../src/services/customer-order.service', {
    normalizeOrder: (order) => order,
    updateAdminOrderStatus: async (...args) => {
      actions.push(['accept', ...args]);
      return { orderStatus: 'preparing' };
    },
    cancelPaidOrder: async (...args) => {
      actions.push(['reject', ...args]);
      return { orderStatus: 'cancelled', refundStatus: 'unknown' };
    },
  });
  return { service: fresh(t, '../src/services/front-order-inbox.service'), reads, actions };
}
test('inbox contracts reject cross-branch payloads and arbitrary order states', () => {
  assert.equal(frontOrdersQuerySchema.safeParse({ page: '2', peek: 'true' }).success, true);
  assert.equal(frontOrdersQuerySchema.safeParse({ branchId: randomUUID() }).success, false);
  assert.equal(frontOrderPollSchema.safeParse({ terminalId: randomUUID() }).success, true);
  assert.equal(
    frontOrderPollSchema.safeParse({ terminalId: randomUUID(), branchId: randomUUID() }).success,
    false,
  );
  const action = { orderId: randomUUID(), terminalId: randomUUID(), action: 'accept' };
  assert.equal(frontOrderDecisionSchema.safeParse(action).success, true);
  for (const value of [
    { ...action, action: 'completed' },
    { ...action, branchId: randomUUID() },
    { ...action, reason: 'other' },
  ])
    assert.equal(frontOrderDecisionSchema.safeParse(value).success, false);
});

test('tablet accepted action delegates to the common queue, dispatch and acceptance audit', async (t) => {
  const branch = randomUUID();
  const order = {
    id: randomUUID(),
    branch_id: branch,
    status: 'paid',
    fulfillment_status: 'new',
    kitchen_status: 'queued',
    cart_items: [],
  };
  const calls = [];
  stub(t, '../src/config/supabase', {
    supabase: {
      from: () => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: { ...order } };
        },
      }),
    },
  });
  stub(t, '../src/services/kitchen.service', {
    updateKitchenStatus: async (id, state, time, options) => {
      calls.push({ id, state, time, options });
      order.fulfillment_status = state;
      order.kitchen_status = state;
    },
  });
  const service = fresh(t, '../src/services/customer-order.service');
  const admin = { sub: 'cashier.branch' };
  const result = await service.updateAdminOrderStatus(order.id, 'accepted', '', {
    branchIds: [branch],
    admin,
  });
  assert.equal(result.orderStatus, 'preparing');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].state, 'preparing');
  assert.deepEqual(calls[0].options.branchIds, [branch]);
  assert.deepEqual(calls[0].options.admin, admin);
});
test('POS guards accept only scoped product IDs, integer units and known outcomes', () => {
  const sale = {
    terminalId: randomUUID(),
    receiptId: randomUUID(),
    items: [{ productId: randomUUID(), quantity: 5 }],
    total: 35,
  };
  assert.equal(frontStockSaleSchema.safeParse(sale).success, true);
  for (const value of [
    { ...sale, branchId: randomUUID() },
    { ...sale, total: -1 },
    { ...sale, items: [{ ...sale.items[0], quantity: 0.5 }] },
    { ...sale, state: 'closed' },
  ])
    assert.equal(frontStockSaleSchema.safeParse(value).success, false);
  assert.equal(frontStockFinishSchema.safeParse({ ...sale, state: 'closed' }).success, true);
  assert.equal(frontStockFinishSchema.safeParse({ ...sale, state: 'unknown' }).success, false);
});
test('inbox fetch is branch scoped, paid and actionable only, with bounded pagination', async (t) => {
  const branch = randomUUID();
  const { service, reads } = inbox(t, [
    {
      id: randomUUID(),
      order_number: 100001,
      phone: '77760000000',
      cart_items: [{ name: 'Хот-дог', quantity: 5 }],
      amount: 3500,
      delivery_fee: 1000,
      fulfillment_type: 'preorder',
      preorder_fulfillment_type: 'delivery',
      customers: { name: 'Тест' },
      scheduled_at: '2026-09-12T08:00:00Z',
    },
  ]);
  const result = await service.listFrontOrders(branch, { page: 2 });
  assert.deepEqual(
    reads.find((r) => r[1] === 'branch_id'),
    ['eq', 'branch_id', branch],
  );
  assert.deepEqual(
    reads.find((r) => r[0] === 'range'),
    ['range', 25, 49],
  );
  assert.deepEqual(
    reads.find((r) => r[1] === 'status'),
    ['eq', 'status', 'paid'],
  );
  assert.equal(result.orders[0].items[0].quantity, 5);
  assert.equal(result.orders[0].orderType, 'preorder');
  assert.equal(result.orders[0].phone, '77760000000');
});
test('background notifications fetch only identity and count, not full orders or customers', async (t) => {
  const { service, reads } = inbox(t, [{ id: randomUUID(), order_number: 100001 }]);
  const result = await service.listFrontOrders(randomUUID(), { peek: true });
  assert.equal(reads.find((r) => r[0] === 'select')[1], 'id,order_number');
  assert.deepEqual(
    reads.find((r) => r[0] === 'limit'),
    ['limit', 1],
  );
  assert.deepEqual(Object.keys(result.orders[0]), ['id', 'number']);
});
test('accept delegates to the same state machine and records the actual POS terminal', async (t) => {
  const branch = randomUUID(),
    terminal = randomUUID(),
    order = { id: randomUUID(), status: 'paid', fulfillment_status: 'new' };
  const { service, actions } = inbox(t, order);
  await service.decideFrontOrder(branch, {
    orderId: order.id,
    terminalId: terminal,
    action: 'accept',
  });
  assert.deepEqual(actions[0], [
    'accept',
    order.id,
    'preparing',
    '',
    { branchIds: [branch], admin: { sub: `iikofront:${terminal}` } },
  ]);
});
test('reject uses the shared refund process, customer-visible reason and compare-and-set guard', async (t) => {
  const order = { id: randomUUID(), status: 'paid', fulfillment_status: 'new' },
    { service, actions } = inbox(t, order);
  const result = await service.decideFrontOrder(randomUUID(), {
    orderId: order.id,
    terminalId: randomUUID(),
    action: 'reject',
  });
  assert.equal(actions[0][2], 'Нет в наличии');
  assert.deepEqual(actions[0][3].allowedFulfillmentStatuses, ['new']);
  assert.equal(actions[0][3].cancelExternalDelivery, undefined);
  assert.equal(result.refundStatus, 'unknown', 'uncertain refund is not presented as settled');
});
test('an accepted order is not rejected by a stale notification on the second register', async (t) => {
  const order = { id: randomUUID(), status: 'paid', fulfillment_status: 'preparing' },
    { service, actions } = inbox(t, order);
  await assert.rejects(
    service.decideFrontOrder(randomUUID(), {
      orderId: order.id,
      terminalId: randomUUID(),
      action: 'reject',
    }),
    { statusCode: 409 },
  );
  await service.decideFrontOrder(randomUUID(), {
    orderId: order.id,
    terminalId: randomUUID(),
    action: 'accept',
  });
  assert.equal(actions.length, 0);
});
test('foreign orders and unpaid attempts cannot be acted upon', async (t) => {
  const { service, reads, actions } = inbox(t, null);
  const branch = randomUUID();
  await assert.rejects(
    service.decideFrontOrder(branch, {
      orderId: randomUUID(),
      terminalId: randomUUID(),
      action: 'accept',
    }),
    { statusCode: 404 },
  );
  assert.deepEqual(
    reads.find((r) => r[1] === 'branch_id'),
    ['eq', 'branch_id', branch],
  );
  assert.equal(actions.length, 0);
});
test('guard maps products by iiko UUID/profile and derives the loyalty key on the server', async (t) => {
  const calls = [],
    branch = randomUUID(),
    product = randomUUID(),
    receipt = randomUUID();
  stub(t, '../src/config/supabase', {
    supabase: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { status: 'reserved' } };
      },
    },
  });
  stub(t, '../src/services/iiko-city-profile.service', {
    getIikoClientForBranch: async (id) => {
      assert.equal(id, branch);
      return { profileKey: 'astana' };
    },
  });
  stub(t, '../src/services/realtime.service', { publish() {} });
  const service = fresh(t, '../src/services/front-stock-guard.service');
  await service.authorizeFrontStock(branch, {
    terminalId: randomUUID(),
    receiptId: receipt,
    items: [
      { productId: product, quantity: 2 },
      { productId: product, quantity: 3 },
    ],
    total: 35,
    onlineNumber: 100001,
  });
  assert.deepEqual(calls[0].args.p_items, { [`astana:${product}`]: 5 });
  assert.equal(calls[0].args.p_branch, branch);
  assert.match(calls[0].args.p_loyalty_key, new RegExp(`^bp1:${branch}:`));
});

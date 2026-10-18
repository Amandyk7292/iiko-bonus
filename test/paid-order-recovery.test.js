const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { ForteService } = require('../src/services/forte.service');
const { ForteWidgetService } = require('../src/services/forte-widget.service');

function memoryDb(order, { failMarker = false } = {}) {
  let failed = false;
  return {
    from(table) {
      let patch;
      const filters = [];
      const result = () => {
        const rows = table === 'kaspi_orders' && filters.every((f) => f(order)) ? [order] : [];
        if (patch?.payment_reconciled_at && failMarker && !failed) {
          failed = true;
          return { data: null, error: new Error('Interrupted finalization marker write') };
        }
        if (patch) rows.forEach((row) => Object.assign(row, patch));
        return { data: structuredClone(rows), error: null };
      };
      const q = {
        select() {
          return q;
        },
        update(value) {
          patch = value;
          return q;
        },
        eq(key, value) {
          filters.push((row) => row[key] === value);
          return q;
        },
        is(key, value) {
          filters.push((row) => (row[key] ?? null) === value);
          return q;
        },
        in(key, values) {
          filters.push((row) => values.includes(row[key]));
          return q;
        },
        gte(key, value) {
          filters.push((row) => row[key] >= value);
          return q;
        },
        lt(key, value) {
          filters.push((row) => row[key] < value);
          return q;
        },
        or(value) {
          assert.equal(
            value,
            'provider_payment_system.is.null,provider_payment_system.neq.forte_widget',
          );
          filters.push((row) => row.provider_payment_system !== 'forte_widget');
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        async maybeSingle() {
          const r = result();
          return { ...r, data: r.data?.[0] || null };
        },
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

for (const widget of [false, true]) {
  for (const failure of ['fulfillment', 'marker']) {
    test(`${widget ? 'Widget' : 'Hosted'} recovers paid finalization after an interrupted ${failure}`, async () => {
      const order = {
        id: randomUUID(),
        operation_id: randomUUID(),
        payment_method: 'forte_card',
        provider_payment_system: widget ? 'forte_widget' : null,
        status: 'pending',
        fulfillment_status: 'pending',
        payment_reconciled_at: null,
        amount: 1000,
        created_at: new Date().toISOString(),
      };
      let fulfillmentAttempts = 0;
      let financialCommits = 0;
      const orderService = {
        async updateOrderStatus(_id, status) {
          order.status = status;
          return { ...order };
        },
        async recordPaidOrder() {
          fulfillmentAttempts++;
          if (failure === 'fulfillment' && fulfillmentAttempts === 1)
            throw new Error('Temporary inventory commit outage');
          if (!order.bonus_awarded_at) financialCommits++;
          order.bonus_awarded_at ||= new Date().toISOString();
          order.fulfillment_status = 'new';
          return { ...order };
        },
      };
      const service = widget
        ? new ForteWidgetService({
            db: memoryDb(order, { failMarker: failure === 'marker' }),
            orderService,
          })
        : new ForteService({
            db: memoryDb(order, { failMarker: failure === 'marker' }),
            orderService,
          });
      if (widget) {
        service.availability = () => true;
        service.validateCheckout = () => {};
        service.reconcileClosedCardSetups = async () => 0;
        service.syncOrder = (value) =>
          service.applyProviderCheckout(
            value,
            { status: 'successful', transactionStatus: 'successful', card: {} },
            'fake-provider-token',
          );
      } else {
        service.validateProviderOrder = () => {};
        service.syncOrder = (value) => service.applyProviderOrder(value, { status: 'FullyPaid' });
      }
      assert.equal(await service.reconcileOrders(), 1);
      assert.equal(order.status, 'paid');
      assert.equal(order.payment_reconciled_at, null);
      // Paid recovery must also work after the pending-payment 24-hour cutoff.
      order.created_at = '2020-01-01T00:00:00Z';
      assert.equal(await service.reconcileOrders(), 1);
      assert.equal(order.fulfillment_status, 'new');
      assert.ok(order.payment_reconciled_at);
      assert.equal(await service.reconcileOrders(), 0);
      assert.equal(fulfillmentAttempts, 2);
      assert.equal(financialCommits, 1);
    });
  }
}

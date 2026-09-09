const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { CheckoutDeliveryProbeService } = require('../src/services/checkout-delivery-probe.service');
const {
  isInsufficientFunds,
  unavailableError,
} = require('../src/services/delivery-availability.service');

function harness() {
  let clock = Date.now();
  const rows = new Map();
  const calls = [];
  const copy = (value) => structuredClone(value);
  const state = { status: 'ready_for_approval', disabled: false };
  const info = () => ({ id: 'provider-claim', version: 1, status: state.status });
  const store = {
    async acquire(customer, hash, payload, lease, after) {
      const all = [...rows.values()];
      const cached = all.find(
        (row) =>
          row.customer_id === customer &&
          row.route_hash === hash &&
          row.state === 'complete' &&
          Date.parse(row.checked_at) > clock - 120000 &&
          (!after || Date.parse(row.checked_at) > Date.parse(after)),
      );
      if (cached) return { kind: 'cached', probe: copy(cached) };
      if (
        all.some(
          (row) => row.customer_id === customer && !['complete', 'rejected'].includes(row.state),
        )
      )
        return { kind: 'busy' };
      const row = {
        id: crypto.randomUUID(),
        customer_id: customer,
        route_hash: hash,
        request_payload: payload,
        state: 'creating',
        lease_token: lease,
        created_at: new Date(clock).toISOString(),
        lease_until: new Date(clock + 20000).toISOString(),
      };
      rows.set(row.id, row);
      return { kind: 'created', probe: copy(row) };
    },
    async patch(row, patch) {
      const current = rows.get(row.id);
      if (
        current.lease_token !== row.lease_token ||
        Date.parse(current.lease_until) <= clock ||
        ['complete', 'rejected'].includes(current.state)
      )
        throw new Error('Lease lost');
      Object.assign(current, patch);
      return copy(current);
    },
    async lease(token) {
      const row = [...rows.values()].find(
        (r) => !['complete', 'rejected'].includes(r.state) && Date.parse(r.lease_until) <= clock,
      );
      if (!row) return null;
      row.lease_token = token;
      row.lease_until = new Date(clock + 20000).toISOString();
      return copy(row);
    },
  };
  const availability = {
    get: async () => ({ disabled: state.disabled, resumedAt: state.resumedAt }),
    assertAvailable: async () => {
      if (state.disabled) throw unavailableError();
    },
    suspend: async (reason) => {
      state.disabled = true;
      state.reason = reason;
    },
    recordProviderFailure: async (error) => {
      if (!isInsufficientFunds(error)) return false;
      await availability.suspend('insufficient_funds');
      return true;
    },
  };
  const transport = {
    prepare: (context) => ({ route: context.checkout.deliveryAddress }),
    create: async (row) => {
      calls.push(['create', row.id]);
      return info();
    },
    info: async () => {
      calls.push(['info']);
      return info();
    },
    validatePrice: () => {},
    accept: async () => {
      calls.push(['accept', clock]);
      state.status = 'accepted';
      return info();
    },
    cancel: async (_id, _version, mode) => {
      calls.push(['cancel', mode, clock]);
      if (state.status === 'ready_for_approval') throw new Error('Not confirmed');
      state.status = mode === 'paid' ? 'cancelled_with_payment' : 'cancelled';
      return info();
    },
    cancelInfo: async () => ({ cancel_state: 'free' }),
  };
  const options = {
    store,
    availability,
    transport: () => transport,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  };
  const service = new CheckoutDeliveryProbeService(options);
  return {
    service,
    options,
    transport,
    state,
    store,
    rows,
    calls,
    advance: (ms) => {
      clock += ms;
    },
    context: {
      customerId: crypto.randomUUID(),
      checkout: {
        effectiveFulfillmentType: 'delivery',
        deliveryAddress: { latitude: 43.6, longitude: 51.1 },
      },
    },
  };
}

test('accept is immediately followed by cancel; duplicate quotes reuse the confirmed result', async () => {
  const h = harness();
  const results = await Promise.all([h.service.ensure(h.context), h.service.ensure(h.context)]);
  assert.equal(results[0].probeId, results[1].probeId);
  assert.deepEqual(
    h.calls.map((call) => call[0]),
    ['create', 'accept', 'cancel'],
  );
  assert.equal(h.calls[2][2] - h.calls[1][1], 0);
  assert.equal([...h.rows.values()][0].request_payload, null);
  await h.service.ensure(h.context);
  assert.equal(h.calls.length, 3);
});

test('a resumed balance stop invalidates cached success', async () => {
  const h = harness();
  await h.service.ensure(h.context);
  h.advance(1000);
  h.state.resumedAt = new Date(h.options.now()).toISOString();
  h.state.status = 'ready_for_approval';
  await h.service.ensure(h.context);
  assert.equal(h.calls.filter((call) => call[0] === 'create').length, 2);
});

test('a provider funds rejection at acceptance disables delivery and never approves payment', async () => {
  const h = harness();
  h.transport.accept = async () => {
    h.state.status = 'failed';
    throw Object.assign(new Error('Insufficient funds'), { code: 'insufficient_funds' });
  };
  h.transport.cancel = async () => {
    throw new Error('Not confirmed');
  };
  await assert.rejects(h.service.ensure(h.context), { code: 'DELIVERY_TEMPORARILY_UNAVAILABLE' });
  assert.equal(h.state.disabled, true);
  assert.equal([...h.rows.values()][0].state, 'rejected');
  assert.ok(![...h.rows.values()].some((row) => row.state === 'complete'));
  const count = h.calls.length;
  await assert.rejects(h.service.ensure({ ...h.context, customerId: crypto.randomUUID() }));
  assert.equal(h.calls.length, count);
});

test('a definite create rejection closes the row and opens the global funds stop', async () => {
  const h = harness();
  h.transport.create = async () => {
    throw Object.assign(new Error('Insufficient funds'), {
      code: 'insufficient_funds',
      details: { providerStatus: 422 },
    });
  };
  await assert.rejects(h.service.ensure(h.context));
  assert.equal([...h.rows.values()][0].state, 'rejected');
  assert.equal(h.state.disabled, true);
});

test('lost create response is recovered using the same ID; the janitor never accepts drafts', async () => {
  const h = harness();
  const create = h.transport.create;
  h.transport.create = async (row) => {
    await create(row);
    throw new Error('Network timeout');
  };
  await assert.rejects(h.service.ensure(h.context));
  h.transport.create = create;
  h.advance(25000);
  await new CheckoutDeliveryProbeService(h.options).cleanup();
  assert.deepEqual(
    h.calls.filter((call) => call[0] === 'create').map((call) => call[1]),
    [[...h.rows.keys()][0], [...h.rows.keys()][0]],
  );
  assert.equal(
    h.calls.some((call) => call[0] === 'accept'),
    false,
  );
  assert.equal([...h.rows.values()][0].state, 'rejected');
});

test('timed-out accept that completes later is cancelled by the restarted server', async () => {
  const h = harness();
  h.transport.accept = async () => {
    throw new Error('Timeout');
  };
  await assert.rejects(h.service.ensure(h.context));
  assert.equal([...h.rows.values()][0].state, 'cancelling');
  h.advance(6000);
  h.state.status = 'performer_found';
  await new CheckoutDeliveryProbeService(h.options).cleanup();
  assert.equal(h.state.status, 'cancelled');
  assert.equal([...h.rows.values()][0].state, 'rejected');
});

test('a timeout after a successful cancel is verified through claim info', async () => {
  const h = harness();
  const cancel = h.transport.cancel;
  h.transport.cancel = async (...args) => {
    await cancel(...args);
    throw new Error('Timeout');
  };
  await h.service.ensure(h.context);
  assert.equal([...h.rows.values()][0].state, 'complete');
  assert.ok(h.calls.some((call) => call[0] === 'info'));
});

test('uncertain cancellation blocks payment; cleanup retries it without another acceptance', async () => {
  const h = harness();
  const cancel = h.transport.cancel;
  const info = h.transport.info;
  h.transport.cancel = async () => {
    throw new Error('Network down');
  };
  h.transport.info = async () => {
    throw new Error('Network down');
  };
  await assert.rejects(h.service.ensure(h.context));
  assert.equal([...h.rows.values()][0].state, 'cancelling');
  h.transport.cancel = cancel;
  h.transport.info = info;
  h.advance(6000);
  await new CheckoutDeliveryProbeService(h.options).cleanup();
  assert.equal(h.state.status, 'cancelled');
  assert.equal(h.calls.filter((call) => call[0] === 'accept').length, 1);
});

test('paid cancellation still cancels the courier and disables additional probes', async () => {
  const h = harness();
  const cancel = h.transport.cancel;
  h.transport.cancel = async (...args) => {
    if (args[2] === 'free') throw new Error('Free cancellation unavailable');
    return cancel(...args);
  };
  h.transport.cancelInfo = async () => ({ cancel_state: 'paid' });
  await assert.rejects(h.service.ensure(h.context));
  assert.equal(h.state.status, 'cancelled_with_payment');
  assert.equal(h.state.reason, 'probe_paid_cancellation');
});

test('unavailable cancellation remains queued and visible as a global attention stop', async () => {
  const h = harness();
  h.transport.cancel = async () => {
    throw new Error('Cannot cancel');
  };
  h.transport.cancelInfo = async () => ({ cancel_state: 'unavailable' });
  await assert.rejects(h.service.ensure(h.context));
  assert.equal(h.state.reason, 'probe_cancellation_attention');
  assert.equal([...h.rows.values()][0].state, 'cancelling');
});

test('price rejection never calls acceptance, and a global stop never creates a probe', async () => {
  const h = harness();
  h.transport.validatePrice = () => {
    throw new Error('Price exceeds limit');
  };
  await assert.rejects(h.service.ensure(h.context));
  assert.equal(
    h.calls.some((call) => call[0] === 'accept'),
    false,
  );
  h.state.disabled = true;
  const count = h.calls.length;
  await assert.rejects(h.service.ensure(h.context));
  assert.equal(h.calls.length, count);
});

test('database failure before the durable accept record cannot call a courier', async () => {
  const h = harness();
  const patch = h.store.patch;
  h.store.patch = async (row, values) => {
    if (values.accept_attempted_at) throw new Error('DB unavailable');
    return patch(row, values);
  };
  await assert.rejects(h.service.ensure(h.context));
  assert.equal(
    h.calls.some((call) => call[0] === 'accept'),
    false,
  );
});

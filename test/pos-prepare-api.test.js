const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const express = require('express');

function load(path, mocks = {}) {
  const filename = require.resolve(path);
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  const run = vm.runInThisContext(
    `(function(require,module,exports){${readFileSync(filename, 'utf8')}\n})`,
    { filename },
  );
  run((id) => (Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id)), module, module.exports);
  return module.exports;
}

function services() {
  const branch = randomUUID();
  const calls = [];
  let reply = (_, args) => ({
    data: { reservationId: args.p_reservation_id, status: 'prepared', duplicate: false },
  });
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      return reply(name, args);
    },
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          if (table === 'bulka_locations') return { data: { id: branch } };
          if (table === 'gift_card_pos_reservations') return { data: { branch_id: branch } };
          throw new Error(`Unexpected query ${table}`);
        },
      };
    },
  };
  const shared = { '../config/supabase': { supabase: db } };
  const loyalty = load('../src/services/loyalty-reservation.service', {
    ...shared,
    './settings.service': {},
    './tier.service': {},
  });
  const gift = load('../src/services/gift-card-pos.service', {
    ...shared,
    './gift-certificate-purchase.service': {},
  });
  return {
    branch,
    calls,
    db,
    loyalty,
    gift,
    setReply(next) {
      reply = next;
    },
  };
}

test('loyalty prepare authenticates/scopes the order and requires a matching prepared confirmation', async () => {
  const h = services();
  const body = { customerId: randomUUID(), orderId: randomUUID(), reservationId: randomUUID() };
  const result = await h.loyalty.prepareLoyalty(body, { branchId: h.branch });
  assert.deepEqual(result, {
    success: true,
    reservationId: body.reservationId,
    status: 'prepared',
    duplicate: false,
  });
  assert.equal(h.calls[0].name, 'prepare_pos_loyalty_reservation');
  assert.equal(h.calls[0].args.p_branch_id, h.branch);
  assert.equal(h.calls[0].args.p_customer_id, body.customerId);
  assert.equal(h.calls[0].args.p_order_id, h.loyalty.scopedOrder(body.orderId, h.branch).scoped);
  await assert.rejects(h.loyalty.prepareLoyalty(body), { statusCode: 401 });
  await assert.rejects(
    h.loyalty.prepareLoyalty({ ...body, reservationId: 'bad' }, { branchId: h.branch }),
    { statusCode: 400 },
  );
  for (const data of [
    null,
    { status: 'active', reservationId: body.reservationId },
    { status: 'prepared', reservationId: randomUUID() },
  ]) {
    h.setReply(() => ({ data }));
    await assert.rejects(h.loyalty.prepareLoyalty(body, { branchId: h.branch }), {
      statusCode: 503,
    });
  }
});

test('gift prepare preserves its branch/key and exposes retries without claiming debit', async () => {
  const h = services();
  const body = { reservationId: randomUUID(), idempotencyKey: randomUUID(), branchId: h.branch };
  h.setReply((_, args) => ({
    data: { reservationId: args.p_reservation_id, status: 'prepared', duplicate: true },
  }));
  assert.deepEqual(await h.gift.prepareGiftCardForPos(body), {
    id: body.reservationId,
    status: 'prepared',
    duplicate: true,
  });
  assert.deepEqual(h.calls[0], {
    name: 'prepare_gift_card_for_iiko',
    args: {
      p_branch_id: h.branch,
      p_reservation_id: body.reservationId,
      p_request_id: body.idempotencyKey,
    },
  });
  h.setReply(() => ({ data: { status: 'committed', reservationId: body.reservationId } }));
  await assert.rejects(h.gift.prepareGiftCardForPos(body), { statusCode: 503 });
  h.setReply(() => ({ error: { message: 'gift card reservation expired' } }));
  await assert.rejects(h.gift.prepareGiftCardForPos(body), {
    statusCode: 409,
    code: 'GIFT_CARD_RESERVATION_EXPIRED',
  });
  h.setReply(() => ({ error: { message: 'gift card prepare idempotency conflict' } }));
  await assert.rejects(h.gift.prepareGiftCardForPos(body), {
    statusCode: 409,
    code: 'GIFT_CARD_IDEMPOTENCY_CONFLICT',
  });
});

async function api(t) {
  const h = services();
  const auth = load('../src/middlewares/branch-pos-auth.middleware', {
    '../config/supabase': { supabase: h.db },
    '../services/auth.service': { safeEqual: (a, b) => a === b },
    '../services/branch-pos-credential.service': { branchPosTokenHash: () => '' },
  });
  const controller = load('../src/controllers/loyalty.controller', {
    '../config/supabase': { supabase: h.db },
    '../services/loyalty-reservation.service': h.loyalty,
    '../middlewares/branch-pos-auth.middleware': auth,
    '../services/settings.service': {},
    '../services/tier.service': {},
    '../services/customer.service': {},
    '../services/push.service': {},
    '../services/loyalty-sync.service': {},
    '../services/branch-pos-credential.service': {},
  });
  const router = load('../src/routes/loyalty.routes', {
    '../controllers/loyalty.controller': controller,
    '../services/gift-card-pos.service': h.gift,
    '../middlewares/branch-pos-auth.middleware': auth,
    '../middlewares/pos-transport.middleware': {
      posTransportMiddleware(req, res, next) {
        if (req.headers.authorization !== 'Bearer paired-test')
          return res.status(401).json({ success: false });
        req.pairedPos = { branch_id: h.branch, token_hash: 'paired-hash' };
        next();
      },
    },
    '../middlewares/rate-limit.middleware': { webhookRateLimit: (_, __, next) => next() },
    '../services/pickup-handoff.service': {},
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((error, req, res, next) => {
    void req;
    void next;
    res.status(error.statusCode || error.status || 500).json({ error: 'internal' });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return {
    ...h,
    async post(path, body, authenticated = true) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authenticated ? { authorization: 'Bearer paired-test' } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

test('both prepare routes validate payload and use authenticated branch rather than client input', async (t) => {
  const h = await api(t);
  const bonus = { customerId: randomUUID(), orderId: randomUUID(), reservationId: randomUUID() };
  const gift = { reservationId: randomUUID(), idempotencyKey: randomUUID() };
  for (const [path, body] of [
    ['/api/loyalty/prepare', bonus],
    ['/api/loyalty/gift-cards/prepare', gift],
  ]) {
    assert.equal((await h.post(path, body, false)).status, 401);
    assert.equal((await h.post(path, { ...body, branchId: randomUUID() })).status, 401);
    assert.equal((await h.post(path, { ...body, reservationId: 'bad' })).status, 400);
    const response = await h.post(path, body);
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(h.calls.at(-1).args.p_branch_id, h.branch);
    assert.equal(h.calls.at(-1).args.p_reservation_id, body.reservationId);
  }
  assert.equal(h.calls.length, 2);
});

test('prepare routes report unavailable/expired reservations without pretending payment succeeded', async (t) => {
  const h = await api(t);
  const bonus = { customerId: randomUUID(), orderId: randomUUID(), reservationId: randomUUID() };
  const gift = { reservationId: randomUUID(), idempotencyKey: randomUUID() };
  h.setReply(() => ({ data: null }));
  assert.equal((await h.post('/api/loyalty/prepare', bonus)).status, 503);
  assert.equal((await h.post('/api/loyalty/gift-cards/prepare', gift)).status, 503);
  h.setReply(() => ({ error: { message: 'reservation is not active' } }));
  assert.equal((await h.post('/api/loyalty/prepare', bonus)).status, 409);
  h.setReply(() => ({ error: { message: 'gift card reservation expired' } }));
  const result = await h.post('/api/loyalty/gift-cards/prepare', gift);
  assert.equal(result.status, 409);
  assert.equal(result.body.success, false);
  assert.equal(result.body.code, 'GIFT_CARD_RESERVATION_EXPIRED');
});

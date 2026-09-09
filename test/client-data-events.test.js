const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const realtime = require('../src/services/realtime.service');
const {
  clientDataEvents,
  publicDomains,
} = require('../src/middlewares/client-data-events.middleware');

function stream(identity, lastEventId) {
  const req = new EventEmitter();
  req.query = { lastEventId };
  const frames = [];
  const res = {
    status() {},
    set() {},
    write: (text) => frames.push(text),
    end() {
      this.writableEnded = true;
    },
  };
  realtime.openStream(req, res, identity);
  return () =>
    frames.filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5)));
}

test('two guest clients receive branch invalidations without private payloads, including replay', () => {
  realtime.resetForTests();
  try {
    const first = stream({ public: true });
    const second = stream({ public: true });
    const customer = stream({ customerId: 'alice' });
    realtime.publish(
      'order.updated',
      { address: 'private' },
      { customerId: 'alice', includeAdmins: true },
    );
    realtime.publish('menu.updated', { internalSupplier: 'secret' }, { broadcast: true });
    realtime.publish('locations.updated', { privateNote: 'secret' }, { adminOnly: true });
    assert.deepEqual(first().slice(1), second().slice(1));
    assert.deepEqual(
      first().map((event) => event.type),
      ['connected', 'client.data.changed', 'client.data.changed', 'client.data.changed'],
    );
    assert.deepEqual(first()[3].data, { domains: ['locations', 'menu'] });
    assert.ok(!JSON.stringify(first()).includes('secret'));
    assert.ok(!JSON.stringify(first()).includes('private'));
    assert.ok(customer().some((event) => event.type === 'order.updated'));
    const replay = stream({ public: true }, '0');
    assert.deepEqual(replay().slice(0, -1), first().slice(1));
  } finally {
    realtime.resetForTests();
  }
});

test('only successful authorized admin writes invalidate client data', () => {
  realtime.resetForTests();
  try {
    const guest = stream({ public: true });
    const alice = stream({ customerId: 'alice' });
    const bob = stream({ customerId: 'bob' });
    const mutate = ({
      path = '/admin/api/stories/123',
      method = 'PUT',
      admin = {},
      status = 200,
      body = {},
      success = true,
    } = {}) => {
      const response = new EventEmitter();
      response.statusCode = status;
      response.json = () => response;
      clientDataEvents({ method, path, admin, body }, response, () => {});
      response.json({ success });
      response.emit('finish');
    };
    mutate({ status: 500 });
    mutate({ admin: null });
    mutate({ success: false });
    mutate({ method: 'GET' });
    mutate({ path: '/admin/api/menu/upload-image' });
    mutate({ path: '/admin/api/integrations/payments/probe' });
    assert.equal(guest().length, 1);
    mutate();
    assert.deepEqual(guest()[1].data, { domains: ['content', 'checkout'] });
    mutate({
      path: '/admin/api/customers/update',
      method: 'POST',
      body: { customerId: 'alice', name: 'private' },
    });
    assert.equal(alice().at(-1).type, 'customer.updated');
    assert.equal(bob().at(-1).type, 'client.data.changed');
    assert.equal(guest().length, 2);
  } finally {
    realtime.resetForTests();
  }
});

test('public topics cover the client-facing admin resources and exclude access credentials', () => {
  for (const path of [
    'menu/product/override',
    'inventory/a/b',
    'locations/a',
    'loyalty-tiers/a',
    'settings',
    'online-ordering',
    'contact-cards/a/actions',
    'gift-cards',
    'news/a',
    'integrations/payments/widget',
  ]) {
    assert.ok(publicDomains(`/admin/api/${path}`).length, path);
  }
  assert.deepEqual(publicDomains('/admin/api/access/password'), []);
  assert.deepEqual(publicDomains('/admin/api/translate'), []);
});

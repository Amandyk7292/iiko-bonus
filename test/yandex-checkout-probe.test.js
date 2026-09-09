const test = require('node:test');
const assert = require('node:assert/strict');
const { createProbeTransport } = require('../src/services/yandex-checkout-probe');

const config = {
  senderPhone: '+77001112233',
  senderName: 'Bulka',
  country: 'Казахстан',
  taxiClass: 'express',
  cargoMaxPriceKzt: 5000,
  opsAlertReceiver: { workersEnabled: true, deliverySyncEnabled: true },
};
const context = {
  customerPhone: '+77005556677',
  pricing: { canonicalItems: [{ name: 'Булочка', quantity: 1 }] },
  checkout: {
    deliveryOrigin: {
      city: 'Актау',
      address: '18А микрорайон, 1',
      latitude: 43.67,
      longitude: 51.16,
    },
    deliveryAddress: {
      city: 'Актау',
      address: 'ЖК Гаухартас',
      house: '14',
      entrance: '3',
      floor: '4',
      apartment: '37',
      latitude: 43.69,
      longitude: 51.17,
    },
  },
};
const make = (overrides = {}) =>
  createProbeTransport({
    config,
    cargoItems: (order) => order.cart_items,
    cargoOptions: () => ['auto_courier', 'thermobag'],
    normalizeCity: (city) => String(city || '').toLowerCase(),
    request: async () => ({}),
    ...overrides,
  });

test('probe uses the exact branch, saved destination, contact and arrival instructions', () => {
  const payload = make().prepare(context);
  const [origin, destination] = payload.route_points;
  assert.deepEqual(origin.address.coordinates, [51.16, 43.67]);
  assert.deepEqual(destination.address.coordinates, [51.17, 43.69]);
  assert.equal(destination.address.fullname, 'Актау, ЖК Гаухартас, дом 14');
  assert.equal(destination.address.porch, '3');
  assert.equal(destination.address.sfloor, '4');
  assert.equal(destination.address.sflat, '37');
  assert.equal(destination.contact.phone, '+77005556677');
  assert.match(destination.address.comment, /Груз не передавать/);
  assert.match(destination.address.comment, /Подъезд 3.*Этаж 4.*Квартира 37/);
  assert.equal(payload.skip_client_notify, true);
  assert.equal(payload.skip_emergency_notify, true);
  assert.equal(payload.skip_door_to_door, false);
  assert.deepEqual(payload.client_requirements.cargo_options, ['auto_courier', 'thermobag']);
});

test('recovery uses identical creation ID and payload; cancellation passes current version', async () => {
  const requests = [];
  const transport = make({
    request: async (path, options) => {
      requests.push({ path, ...options });
    },
  });
  const probe = { id: 'request-uuid', request_payload: transport.prepare(context) };
  await transport.create(probe);
  await transport.create(probe);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].query.request_id, probe.id);
  assert.equal(requests[0].body.route_points[0].external_order_id, 'probe:request-uuid');
  await transport.accept('claim', 8);
  await transport.cancel('claim', 9, 'paid');
  assert.deepEqual(requests[3].body, { version: 9, cancel_state: 'paid' });
});

test('missing cleanup worker or invalid route blocks calls, and an unpriced claim cannot be accepted', () => {
  assert.throws(() => make({ config: { ...config, opsAlertReceiver: {} } }).prepare(context));
  assert.throws(() => make().prepare({ ...context, customerPhone: '' }));
  assert.throws(() =>
    make().prepare({
      ...context,
      checkout: {
        ...context.checkout,
        deliveryAddress: { ...context.checkout.deliveryAddress, city: 'Алматы' },
      },
    }),
  );
  assert.throws(() =>
    make().validatePrice({ pricing: { offer: { price: '2500' }, currency: 'RUB' } }),
  );
  assert.throws(() =>
    make().validatePrice({ pricing: { offer: { price: '6000' }, currency: 'KZT' } }),
  );
  assert.equal(
    make().validatePrice({ pricing: { offer: { price: '2500' }, currency: 'KZT' } }),
    2500,
  );
});

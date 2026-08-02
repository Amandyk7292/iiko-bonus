const assert = require('node:assert/strict');
const test = require('node:test');

const { buildEtaForecast, distanceKm, percentile } = require('../src/services/eta.service');

test('ETA 3.0 learns from history and returns a bounded window', () => {
  const eta = buildEtaForecast({
    now: new Date('2026-07-16T06:00:00.000Z'),
    orderType: 'delivery',
    preparationMinutes: 20,
    prepSamples: [14, 16, 17, 18, 19, 20, 21, 22, 16, 18],
    travelSpeedSamples: [20, 21, 22, 23, 24, 25, 26, 22],
    directDistanceKm: 4,
    activeKitchenOrders: [
      { kitchen_status: 'queued', preparation_minutes: 18 },
      {
        kitchen_status: 'preparing',
        preparation_minutes: 20,
        kitchen_started_at: '2026-07-16T05:55:00.000Z',
      },
    ],
    kitchenCapacity: 2,
  });

  assert.equal(eta.version, 'eta-v3');
  assert.equal(eta.confidence, 'medium');
  assert.ok(eta.minMinutes < eta.maxMinutes);
  assert.ok(eta.components.queueMinutes > 0);
  assert.ok(eta.components.historySamples >= 18);
  assert.ok(eta.routeDistanceKm > 4);
});

test('scheduled ETA keeps a ten-minute customer window', () => {
  const scheduledAt = '2026-07-17T10:00:00.000Z';
  const eta = buildEtaForecast({
    now: new Date('2026-07-16T10:00:00.000Z'),
    orderType: 'pickup',
    preparationMinutes: 15,
    scheduledAt,
  });
  assert.equal(eta.minAt, scheduledAt);
  assert.equal(eta.maxAt, '2026-07-17T10:10:00.000Z');
  assert.ok(Date.parse(eta.readyMaxAt) <= Date.parse(eta.maxAt));
});

test('ETA uses the courier GPS distance after pickup', () => {
  const eta = buildEtaForecast({
    now: new Date('2026-07-16T10:00:00.000Z'),
    orderType: 'delivery',
    kitchenStatus: 'handed_over',
    deliveryStatus: 'en_route',
    directDistanceKm: 8,
    courierToPickupKm: 6,
    courierToDestinationKm: 1,
  });

  assert.equal(eta.routeDistanceKm, 1.25);
  assert.equal(eta.components.routeSource, 'courier-gps-road-factor');
  assert.ok(eta.components.travelMinutes < 15);
});

test('ETA distance and percentile helpers reject invalid noise', () => {
  assert.equal(percentile([1, null, 3, 'bad', 2], 0.5), 2);
  assert.equal(distanceKm(null, 50, 43, 51), null);
  const distance = distanceKm(43.65, 51.15, 43.67, 51.17);
  assert.ok(distance > 2 && distance < 4);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  OrderPaymentStateService,
  paymentStatusCanTransition,
} = require('../src/services/order-payment-state.service');

const projectRoot = path.join(__dirname, '..');

test('retired payment provider has no active environment, route, or network integration in src', () => {
  const sourceRoot = path.join(projectRoot, 'src');
  const files = fs
    .readdirSync(sourceRoot, { recursive: true })
    .filter((name) => String(name).endsWith('.js'));
  const source = files
    .map((name) => fs.readFileSync(path.join(sourceRoot, name), 'utf8'))
    .join('\n');

  assert.doesNotMatch(source, /process\.env\.KASPI|KASPI_[A-Z_]+/);
  assert.doesNotMatch(source, /\/kaspi(?:[-/]|$)|kaspi-pos|Kaspi Pay/i);
  assert.doesNotMatch(source, /require\([^)]*kaspi\.service/i);
});

test('Forte retains the provider-neutral order state contract and legacy loyalty identity', () => {
  const forteSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'services', 'forte.service.js'),
    'utf8',
  );
  const orderStateSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'services', 'order-payment-state.service.js'),
    'utf8',
  );

  assert.match(forteSource, /require\('\.\/order-payment-state\.service'\)/);
  assert.doesNotMatch(forteSource, /kaspi\.service/);
  assert.match(orderStateSource, /p_order_id:\s*`kaspi:\$\{order\.operation_id\}`/);
  assert.match(orderStateSource, /orderId:\s*`kaspi:\$\{order\.operation_id\}`/);

  const service = new OrderPaymentStateService();
  const order = service.orderRecord({
    customerId: 'customer-1',
    operationId: 'forte-operation-1',
    normalizedPhone: '77770000000',
    pricing: {
      total: 2500,
      subtotal: 2500,
      discount: 0,
      deliveryFee: 0,
      preparationMinutes: 15,
    },
    cartItems: [],
    checkout: {
      orderType: 'pickup',
      branchId: 'branch-1',
      branch: 'Bulka',
      requestId: 'checkout-1',
    },
    paymentMethod: 'forte_card',
  });

  assert.equal(order.payment_method, 'forte_card');
  assert.equal(order.operation_id, 'forte-operation-1');
  assert.equal(paymentStatusCanTransition('pending', 'paid'), true);
  assert.equal(paymentStatusCanTransition('paid', 'expired'), false);
});

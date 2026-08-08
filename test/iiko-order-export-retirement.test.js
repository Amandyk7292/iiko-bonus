const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

const sourceFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith('.js') ? [absolutePath] : [];
  });

test('iiko client has no order export or delivery status API at runtime', () => {
  const { IikoAPI } = require('../src/services/iiko.service');
  const client = new IikoAPI({});

  assert.equal(client.createDeliveryOrder, undefined);
  assert.equal(client.getDeliveryOrdersByIds, undefined);
});

test('customer payment flow and workers cannot export an order to iiko', () => {
  assert.equal(
    fs.existsSync(path.join(projectRoot, 'src/services/iiko-order-sync.service.js')),
    false,
  );
  const runtimeSource = sourceFiles(path.join(projectRoot, 'src'))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  const paymentSource = read('src/services/order-payment-state.service.js');
  const serverSource = read('src/server.js');

  for (const forbidden of [
    'iiko-order-sync.service',
    'enqueueIikoOrderSync',
    'IIKO_ORDER_EXPORT_ENABLED',
    '/api/1/deliveries/create',
    '/api/1/deliveries/by_id',
    'iiko-order-export',
    'iiko-delivery-status',
  ]) {
    assert.equal(runtimeSource.includes(forbidden), false, `runtime still contains ${forbidden}`);
  }

  assert.doesNotMatch(paymentSource, /iiko/i);
  assert.doesNotMatch(serverSource, /iiko-order|iiko-delivery/i);
});

test('deployment configuration cannot re-enable retired iiko order export', () => {
  const deploymentConfiguration = [read('.env.example'), read('render.yaml')].join('\n');

  assert.doesNotMatch(deploymentConfiguration, /IIKO_ORDER_EXPORT_ENABLED/);
  assert.doesNotMatch(deploymentConfiguration, /IIKO_PAYMENT_TYPE_ID/);
  assert.doesNotMatch(deploymentConfiguration, /IIKO_ADDRESS_FORMAT/);
});

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.NODE_ENV = 'test';
process.env.BULKA_SECRET = 'wallet-test-secret-with-at-least-32-characters';
process.env.CUSTOMER_JWT_SECRET = 'customer-test-secret-with-at-least-32-characters';
process.env.GOOGLE_ISSUER_ID = '1234567890';
process.env.GOOGLE_CLASS_ID = 'bulka_bonus_card';

const {
  buildGoogleLoyaltyObject,
  buildGoogleWalletUpdatePayload,
  createAppleWalletNotification,
  createWalletToken,
  formatWalletAmount,
  resolveWalletToken,
} = require('../src/services/wallet.service');
const { customerIdFromSerial, customerUpdateTag } = require('../src/controllers/wallet.controller');

const customer = {
  id: 'd7c721c9-fb97-4dfa-ae8b-fafbc8d75ac7',
  phone: '+77001234567',
  name: 'Гость',
  balance: 1523.5,
  total_spent: 9000,
};
const tier = { name: 'Бронза', percent: 3 };

test('Google Wallet object exposes actual balance as loyalty points', () => {
  const object = buildGoogleLoyaltyObject(customer, tier);

  assert.equal(object.id, `1234567890.bulka-${customer.id}`);
  assert.equal(object.classId, '1234567890.bulka_bonus_card');
  assert.deepEqual(object.loyaltyPoints, {
    label: 'Бонусы',
    localizedLabel: {
      defaultValue: { language: 'ru', value: 'Бонусы' },
      translatedValues: [
        { language: 'kk', value: 'Бонустар' },
        { language: 'en', value: 'Points' },
      ],
    },
    balance: { double: 1523.5 },
  });
  assert.equal(object.textModulesData[0].body, 'Бронза 3%');
});

test('Google Wallet balance update requests a visible Wallet notification', () => {
  const payload = buildGoogleWalletUpdatePayload(buildGoogleLoyaltyObject(customer, tier));

  assert.deepEqual(payload.loyaltyPoints.balance, { double: 1523.5 });
  assert.equal(payload.notifyPreference, 'NOTIFY_ON_UPDATE');
});

test('Wallet token resolves only through signed wallet audience', () => {
  const token = createWalletToken(customer.phone);
  assert.deepEqual(resolveWalletToken(token), { phone: customer.phone });
  assert.equal(resolveWalletToken(`${token}broken`), null);
});

test('Apple Wallet serial and update tags are stable', () => {
  assert.equal(customerIdFromSerial(`bulka-${customer.id}`), customer.id);
  assert.equal(customerIdFromSerial('bulka-invalid'), null);
  assert.equal(
    customerUpdateTag({ updated_at: '2026-07-15T10:20:30.123Z' }),
    Date.parse('2026-07-15T16:03:00.000Z'),
  );
  assert.equal(
    customerUpdateTag({ updated_at: '2026-07-15T16:20:30.123Z' }),
    Date.parse('2026-07-15T16:20:30.123Z'),
  );
});

test('Apple Wallet update push keeps the required JSON payload', () => {
  const notification = createAppleWalletNotification('pass.com.bulka.bonus');

  assert.equal(notification.topic, 'pass.com.bulka.bonus');
  assert.equal(notification.compile(), '{"aps":{}}');
});

test('Wallet amount keeps real decimals without trailing zero noise', () => {
  assert.equal(formatWalletAmount(100), '100');
  assert.equal(formatWalletAmount(100.5), '100.5');
  assert.equal(formatWalletAmount(100.25), '100.25');
});

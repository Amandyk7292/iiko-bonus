const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { yandexDeliveryConfigurationErrors } = require('../src/config/env');

const validBusinessEnvironment = () => ({
  YANDEX_DELIVERY_ENABLED: 'true',
  YANDEX_DELIVERY_API_MODE: 'business_v2',
  YANDEX_DELIVERY_AUTO_DISPATCH: 'false',
  YANDEX_DELIVERY_SENDER_PHONE: '+77001234567',
  YANDEX_BUSINESS_API_TOKEN: 'business-token-value',
  YANDEX_BUSINESS_BASE_URL: 'https://b2b-api.go.yandex.ru',
  YANDEX_BUSINESS_USER_ID: 'bulka-dispatch-user',
  YANDEX_BUSINESS_CORP_CLIENT_ID: 'bulka-corporate-client',
  YANDEX_BUSINESS_TARIFF_CLASS: 'express',
  YANDEX_BUSINESS_MAX_PRICE_KZT: '7500',
  YANDEX_BUSINESS_QUOTE_MAX_AGE_SECONDS: '120',
  YANDEX_BUSINESS_REQUIRED_REQUIREMENTS: 'auto_courier,thermobag',
  YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED: 'true',
  YANDEX_BUSINESS_ALLOW_PAID_CANCEL: 'false',
  OPS_ALERT_WEBHOOK_URL: 'https://ops.example.test/bulka-alerts',
  OPS_ALERT_RECEIVER_REQUIRED: 'true',
  RUN_BACKGROUND_WORKERS: 'true',
  RUN_YANDEX_DELIVERY_WORKER: 'true',
});

test('Yandex Business paid mode rejects serverless or disabled critical workers', () => {
  assert.ok(
    yandexDeliveryConfigurationErrors({
      ...validBusinessEnvironment(),
      RUN_YANDEX_DELIVERY_WORKER: 'false',
    }).some((error) => error.startsWith('RUN_YANDEX_DELIVERY_WORKER')),
  );
  assert.ok(
    yandexDeliveryConfigurationErrors({
      ...validBusinessEnvironment(),
      VERCEL: '1',
    }).some((error) => error.startsWith('VERCEL_UNSUPPORTED')),
  );
});

test('Yandex Cargo validation stays backward compatible by default', () => {
  assert.deepEqual(
    yandexDeliveryConfigurationErrors({
      YANDEX_DELIVERY_ENABLED: 'true',
      YANDEX_DELIVERY_API_TOKEN: 'cargo-token-value',
      YANDEX_DELIVERY_SENDER_PHONE: '+77001234567',
      YANDEX_DELIVERY_BASE_URL: 'https://b2b.taxi.yandex.net',
    }),
    [],
  );
  assert.deepEqual(yandexDeliveryConfigurationErrors({}), []);
});

test('Yandex Business validation accepts only an explicit bounded configuration', () => {
  assert.deepEqual(yandexDeliveryConfigurationErrors(validBusinessEnvironment()), []);
  assert.deepEqual(
    yandexDeliveryConfigurationErrors({
      ...validBusinessEnvironment(),
      YANDEX_BUSINESS_REQUIRED_REQUIREMENTS: '',
    }),
    [],
  );

  const errors = yandexDeliveryConfigurationErrors({
    ...validBusinessEnvironment(),
    YANDEX_BUSINESS_API_TOKEN: 'short',
    YANDEX_BUSINESS_USER_ID: '',
    YANDEX_BUSINESS_CORP_CLIENT_ID: '',
    YANDEX_BUSINESS_BASE_URL: 'https://example.com/integration/2.0',
    YANDEX_BUSINESS_TARIFF_CLASS: 'econom',
    YANDEX_BUSINESS_MAX_PRICE_KZT: '100001',
    YANDEX_BUSINESS_QUOTE_MAX_AGE_SECONDS: '301',
    YANDEX_BUSINESS_REQUIRED_REQUIREMENTS: 'thermobag,NOT VALID',
    YANDEX_BUSINESS_ALLOW_PAID_CANCEL: 'yes',
    YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED: 'yes',
  });

  for (const expected of [
    'YANDEX_BUSINESS_API_TOKEN',
    'YANDEX_BUSINESS_USER_ID',
    'YANDEX_BUSINESS_CORP_CLIENT_ID',
    'YANDEX_BUSINESS_BASE_URL',
    'YANDEX_BUSINESS_TARIFF_CLASS',
    'YANDEX_BUSINESS_MAX_PRICE_KZT',
    'YANDEX_BUSINESS_QUOTE_MAX_AGE_SECONDS',
    'YANDEX_BUSINESS_REQUIRED_REQUIREMENTS',
    'YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED',
    'YANDEX_BUSINESS_ALLOW_PAID_CANCEL',
  ]) {
    assert.equal(
      errors.some((error) => error.startsWith(expected)),
      true,
      expected,
    );
  }
});

test('Yandex Business validation never falls back to Cargo credentials', () => {
  const environment = validBusinessEnvironment();
  delete environment.YANDEX_BUSINESS_API_TOKEN;
  environment.YANDEX_DELIVERY_API_TOKEN = 'legacy-cargo-token';
  environment.YANDEX_DELIVERY_SENDER_PHONE = '+77001234567';
  assert.equal(
    yandexDeliveryConfigurationErrors(environment).includes('YANDEX_BUSINESS_API_TOKEN'),
    true,
  );
});

test('environment template documents the fail-closed Business API settings', () => {
  const lines = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8').split(/\r?\n/);
  for (const line of [
    'YANDEX_DELIVERY_API_MODE=cargo_v2',
    'YANDEX_BUSINESS_API_TOKEN=',
    'YANDEX_BUSINESS_BASE_URL=https://b2b-api.go.yandex.ru',
    'YANDEX_BUSINESS_USER_ID=',
    'YANDEX_BUSINESS_CORP_CLIENT_ID=',
    'YANDEX_BUSINESS_TARIFF_CLASS=express',
    'YANDEX_BUSINESS_MAX_PRICE_KZT=',
    'YANDEX_BUSINESS_QUOTE_MAX_AGE_SECONDS=120',
    'YANDEX_BUSINESS_REQUIRED_REQUIREMENTS=',
    'YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED=false',
    'YANDEX_BUSINESS_ALLOW_PAID_CANCEL=false',
  ]) {
    assert.equal(lines.includes(line), true, `${line} must be documented exactly`);
  }
});

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const passwordAuth = require('../src/services/customer-password-auth.service');
const token = 'd'.repeat(64);
const phone = '+77001234567';
const calls = [];
let validateError;
function mockModule(relative, exports) {
  const filename = require.resolve(relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
mockModule('../src/services/customer-password-auth.service', {
  ...passwordAuth,
  authenticateCustomerPassword: async () => ({
    customer: { id: 'customer-test', phone, total_spent: 0 },
    authVersion: 7,
  }),
  async startCustomerPasswordReset(args) {
    calls.push({ method: 'start', args });
    return {
      deliveryMode: 'sms_link',
      channel: 'sms',
      expiresInSeconds: 900,
      retryAfterSeconds: 60,
      resetToken: token,
      phone,
      whatsappUrl: 'https://wa.me/never',
      url: 'https://bulka.com.kz/reset-password#reset=' + token,
    };
  },
  resetCustomerPassword: async () => assert.fail('Legacy recovery must not set a password'),
});
mockModule('../src/services/customer-password-reset-link.service', {
  async validateCustomerPasswordResetLink(args) {
    calls.push({ method: 'validate', args });
    if (validateError) throw validateError;
    return { success: true };
  },
  async completeCustomerPasswordResetLink(args) {
    calls.push({ method: 'complete', args });
    passwordAuth.validateNewPassword(args.password);
    return { success: true };
  },
});
mockModule('../src/services/otpStore.service', {
  consume: async () => ({ status: 'success', payload: { purpose: 'customer_password_reset' } }),
});
mockModule('../src/services/customer-session.service', {
  issueCustomerSession: async (_customer, _req, options) => {
    calls.push({ method: 'session', args: options });
    return { accessToken: 'test-access', refreshToken: 'test-refresh' };
  },
});
mockModule('../src/services/family.service', { family: { profile: async (customer) => customer } });
mockModule('../src/services/settings.service', { getSettings: async () => ({}) });
mockModule('../src/services/tier.service', { getActiveLoyaltyTiers: async () => [] });
mockModule('../src/config/supabase', {
  supabase: {
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      order() {
        return this;
      },
      limit: async () => ({ data: [], error: null }),
    }),
  },
});
const { authRateLimit } = require('../src/middlewares/rate-limit.middleware');
const app = express();
app.use(express.json());
app.use(require('../src/routes/legacy.routes'));
app.use((error, _req, res, _next) =>
  res.status(error.statusCode || 500).json({ success: false, code: error.code }),
);
let server;
let base;
const request = (path, payload) =>
  fetch(`${base}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => {
  calls.length = 0;
  validateError = null;
  authRateLimit.resetKey('127.0.0.1');
});
test.after(() => new Promise((resolve) => server.close(resolve)));

test('public reset start exposes only SMS-link metadata and accepts old request shape', async () => {
  for (const version of [undefined, 2]) {
    const response = await request('password-reset/start', {
      phone,
      token: 'RecoveryToken23456',
      ...(version ? { otpDeliveryVersion: version } : {}),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      deliveryMode: 'sms_link',
      channel: 'sms',
      expiresInSeconds: 900,
      retryAfterSeconds: 60,
    });
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.deepEqual(
    calls.map((c) => c.args),
    [false, true].map((supported) => ({
      phone,
      requestToken: 'RecoveryToken23456',
      automaticOtpSupported: supported,
    })),
  );
});

test('password login forwards the credential version proved by authentication into session issuance', async () => {
  const response = await request('login', { phone, password: 'OldPassword123' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).accessToken, 'test-access');
  assert.deepEqual(calls, [{ method: 'session', args: { authVersion: 7 } }]);
});

test('link validation and completion use strict public bodies without signing the browser in', async () => {
  const validation = await request('password-reset/validate-link', { resetToken: token });
  assert.equal(validation.status, 200);
  assert.equal(validation.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await validation.json(), { success: true });
  const completion = await request('password-reset/complete-link', {
    resetToken: token,
    password: 'NewPassword123',
  });
  assert.equal(completion.status, 200);
  assert.equal(completion.headers.get('cache-control'), 'no-store');
  assert.equal(completion.headers.get('set-cookie'), null);
  assert.deepEqual(await completion.json(), { success: true });
  const invalid = await request('password-reset/complete-link', {
    resetToken: token,
    password: 'weak',
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'INVALID_PASSWORD');
  const extra = await request('password-reset/complete-link', {
    resetToken: token,
    password: 'NewPassword123',
    customerId: 'forged',
  });
  assert.equal(extra.status, 400);
  assert.equal((await extra.json()).code, 'VALIDATION_ERROR');
  assert.equal(calls.filter((c) => c.method === 'complete').length, 2);
});

test('invalid links have one stable response and legacy reset codes cannot complete or sign in', async () => {
  validateError = Object.assign(new Error('Ссылка недействительна или истекла.'), {
    statusCode: 400,
    code: 'PASSWORD_RESET_LINK_INVALID',
  });
  const invalid = await request('password-reset/validate-link', { resetToken: token });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'PASSWORD_RESET_LINK_INVALID');
  const legacy = await request('password-reset/complete', {
    phone,
    code: '1234',
    password: 'NewPassword123',
  });
  assert.equal(legacy.status, 410);
  assert.equal((await legacy.json()).code, 'PASSWORD_RESET_SMS_LINK_REQUIRED');
  const otpLogin = await request('verify-otp', { phone, code: '1234' });
  assert.equal(otpLogin.status, 400);
  assert.equal((await otpLogin.json()).code, 'WRONG_OTP_PURPOSE');
  assert.deepEqual(
    calls.map((c) => c.method),
    ['validate'],
  );
});

test('link validation remains covered by the public IP authentication limiter', async () => {
  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      (await request('password-reset/validate-link', { resetToken: token })).status,
      200,
    );
  }
  const blocked = await request('password-reset/validate-link', { resetToken: token });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(calls.length, 20);
});

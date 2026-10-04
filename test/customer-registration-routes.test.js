const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const express = require('express');

const customerId = '81d7acbe-4388-438c-a06b-53a210313f73';
const phone = '+77001234567';
const grantId = 'r'.repeat(48);
const inviteToken = 'c'.repeat(64);
const grantKey = `registration_grant_${createHash('sha256').update(grantId).digest('hex')}`;
const cashier = { id: '125', name: 'Кассир', isActive: true };
let state;
function reset() {
  authRateLimit.resetKey('127.0.0.1');
  state = {
    customer: null,
    created: 0,
    sourceCalls: 0,
    unavailableAt: 0,
    rpcCalls: [],
    grantPresent: true,
    credentialVersion: null,
    credentialFailure: false,
    profileFailure: false,
    finishCalls: [],
    referralCalls: 0,
    rewardCalls: 0,
    challengeWrites: [],
    challengeCleanup: 0,
    otpReads: 0,
  };
}
function mockModule(relative, exports) {
  const filename = require.resolve(relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

mockModule('../src/config/supabase', {
  supabase: {
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      if (name === 'record_customer_legal_consent') return { data: true, error: null };
      assert.equal(name, 'create_customer_credential_from_registration_grant');
      assert.deepEqual(args, {
        p_customer_id: customerId,
        p_phone: phone,
        p_grant_key: grantKey,
      });
      if (state.credentialFailure) {
        state.credentialFailure = false;
        return { data: null, error: { code: 'XX000', message: 'Synthetic insert failure' } };
      }
      if (state.credentialVersion == null) {
        assert.equal(state.grantPresent, true);
        state.credentialVersion = 1;
        state.grantPresent = false;
      }
      return { data: state.credentialVersion, error: null };
    },
    from(table) {
      if (table === 'whatsapp_sessions') {
        return {
          delete: () => ({
            lt: async () => {
              state.challengeCleanup++;
              return { error: null };
            },
          }),
          upsert: async (value) => {
            state.challengeWrites.push(value);
            return { error: null };
          },
        };
      }
      if (table === 'customer_credentials') {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: null, error: null }),
        };
      }
      assert.equal(table, 'transactions');
      return {
        select() {
          return this;
        },
        eq(column, value) {
          assert.equal(column, 'customer_id');
          assert.equal(value, customerId);
          return this;
        },
        order() {
          return this;
        },
        async limit() {
          return { data: [], error: null };
        },
      };
    },
  },
});
mockModule('../src/services/customer.service', {
  getCustomerByPhone: async (value) => {
    assert.equal(value, phone);
    return state.customer;
  },
  getOrCreateCustomerByPhone: async (value, name) => {
    assert.equal(value, phone);
    state.created++;
    state.customer = { id: customerId, phone, name, balance: 0, total_spent: 0 };
    return state.customer;
  },
});
mockModule('../src/services/cashier-signup.service', {
  cashierSignup: {
    async resolve(token) {
      assert.equal(token, inviteToken);
      state.sourceCalls++;
      if (state.sourceCalls === state.unavailableAt) {
        throw Object.assign(new Error('Список сотрудников временно недоступен.'), {
          statusCode: 503,
          code: 'STAFF_DIRECTORY_UNAVAILABLE',
        });
      }
      return cashier;
    },
  },
});
mockModule('../src/services/settings.service', { getSettings: async () => ({}) });
mockModule('../src/services/tier.service', { getActiveLoyaltyTiers: async () => [] });
mockModule('../src/services/customer-session.service', {
  issueCustomerSession: async () => ({
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
  }),
});
mockModule('../src/services/otpStore.service', {
  consume: async (value, code) => {
    assert.equal(value, phone);
    assert.equal(code, '1234');
    state.otpReads++;
    return { status: 'success', payload: { purpose: 'customer_login' } };
  },
});
mockModule('../src/services/family.service', { family: { profile: async (customer) => customer } });
mockModule('../src/services/referral.service', {
  rememberReferralDevice: async () => {
    state.referralCalls++;
    return { eligible: true };
  },
});
mockModule('../src/services/commerce-marketing.service', {
  redeemReferralCode: async () => {
    state.rewardCalls++;
  },
});
mockModule('../src/services/branch-signup.service', {
  async finishRegistration(customer, profile, options) {
    state.finishCalls.push({ customer: { ...customer }, profile, options });
    if (state.profileFailure) {
      state.profileFailure = false;
      throw new Error('Synthetic profile transaction failure');
    }
    state.customer.app_registered_at = new Date().toISOString();
  },
});

// Keep the real password helper, verified registration JWT middleware, schema,
// canonical legal-consent validation and production register handler.
const passwordAuth = require('../src/services/customer-password-auth.service');
passwordAuth.consumeRegistrationCredentialGrant = () => {
  throw new Error('Registration must not consume its grant in a separate write');
};
passwordAuth.createCustomerCredential = () => {
  throw new Error('Registration must insert its credential through the atomic RPC');
};
const { canonicalLegalDocuments } = require('../src/services/legal-consent.service');
const { signRegistrationToken } = require('../src/services/auth.service');
const { authRateLimit } = require('../src/middlewares/rate-limit.middleware');
const app = express();
app.use(express.json());
app.use(require('../src/routes/legacy.routes'));

test('production registration handler preserves verified password grants across directory and commit failures', async (t) => {
  const originalRegistrationProvider = process.env.CUSTOMER_REGISTRATION_OTP_PROVIDER;
  const originalLoginProvider = process.env.CUSTOMER_OTP_PROVIDER;
  process.env.CUSTOMER_REGISTRATION_OTP_PROVIDER = 'autocall_sms';
  process.env.CUSTOMER_OTP_PROVIDER = 'legacy_whatsapp';
  t.after(() => {
    if (originalRegistrationProvider === undefined)
      delete process.env.CUSTOMER_REGISTRATION_OTP_PROVIDER;
    else process.env.CUSTOMER_REGISTRATION_OTP_PROVIDER = originalRegistrationProvider;
    if (originalLoginProvider === undefined) delete process.env.CUSTOMER_OTP_PROVIDER;
    else process.env.CUSTOMER_OTP_PROVIDER = originalLoginProvider;
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/auth/register`;
  const authRequest = (path, payload) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  const registrationToken = signRegistrationToken(phone, { credentialGrantId: grantId });
  const body = {
    name: 'Гость',
    surname: 'Тестовый',
    acceptedLegal: true,
    legalConsent: { ...canonicalLegalDocuments('ru'), channel: 'web' },
    cashierInviteToken: inviteToken,
  };
  const request = (payload = body, token = registrationToken) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  const credentialCalls = () =>
    state.rpcCalls.filter(
      (call) => call.name === 'create_customer_credential_from_registration_grant',
    );

  await t.test(
    'generic OTP refuses new and placeholder customers before WhatsApp or SMS writes',
    async () => {
      for (const customer of [
        null,
        { id: customerId, phone, name: 'Новый Гость', balance: 0, total_spent: 0 },
      ]) {
        for (const version of [undefined, 2]) {
          reset();
          state.customer = customer && { ...customer };
          const result = await authRequest('request-otp', {
            phone: '8 (700) 123-45-67',
            token: 'LegacyLogin23456',
            ...(version ? { otpDeliveryVersion: version } : {}),
          });
          assert.equal(result.status, 400);
          assert.deepEqual(await result.json(), {
            success: false,
            error:
              'Обновите приложение Bulka или перезагрузите страницу, чтобы подтвердить номер по SMS.',
            code: 'OTP_CLIENT_UPDATE_REQUIRED',
          });
          assert.equal(state.challengeCleanup, 0);
          assert.deepEqual(state.challengeWrites, []);
          assert.deepEqual(state.rpcCalls, []);
          assert.equal(state.created, 0);
          assert.equal(state.referralCalls, 0);
          assert.equal(state.rewardCalls, 0);
          assert.deepEqual(state.customer, customer);
        }
      }
    },
  );

  await t.test(
    'established customers retain generic WhatsApp login and password recovery',
    async () => {
      reset();
      state.customer = { id: customerId, phone, name: 'Алия', balance: 0, total_spent: 0 };
      for (const version of [undefined, 2]) {
        const result = await authRequest('request-otp', {
          phone: '8 (700) 123-45-67',
          token: 'LegacyLogin23456',
          ...(version ? { otpDeliveryVersion: version } : {}),
        });
        assert.equal(result.status, 200);
        const body = await result.json();
        assert.equal(body.deliveryMode, 'manual');
        assert.equal(body.channel, 'whatsapp');
        assert.equal(body.codeLength, 4);
        assert.match(body.whatsappUrl, /^https:\/\/wa\.me\//);
      }
      assert.equal(state.challengeWrites.length, 2);
      assert.equal(state.challengeWrites[0].data.phone, phone);
      assert.equal(state.challengeWrites[0].data.purpose, 'customer_login');
      const verified = await authRequest('verify-otp', { phone, code: '1234' });
      assert.equal(verified.status, 200);
      assert.equal((await verified.json()).accessToken, 'synthetic-access');
      assert.equal(state.otpReads, 1);
      const recovery = await authRequest('password-reset/start', {
        phone,
        token: 'LegacyRecovery23456',
      });
      assert.equal(recovery.status, 200);
      assert.equal((await recovery.json()).channel, 'whatsapp');
      assert.equal(state.challengeWrites[2].data.purpose, 'customer_password_reset');
      assert.deepEqual(state.rpcCalls, []);
      assert.equal(state.created, 0);
    },
  );

  await t.test(
    'AutoCall registration rejects legacy verification tokens before profile, directory, consent or reward writes',
    async () => {
      const legacyToken = signRegistrationToken(phone);
      for (const customer of [
        null,
        { id: customerId, phone, name: 'Новый Гость', balance: 0, total_spent: 0 },
      ]) {
        reset();
        state.customer = customer && { ...customer };
        const result = await request({ ...body, referralCode: 'BULKA-12345678' }, legacyToken);
        assert.equal(result.status, 400);
        assert.deepEqual(await result.json(), {
          success: false,
          error:
            'Обновите приложение Bulka или перезагрузите страницу, чтобы подтвердить номер по SMS.',
          code: 'OTP_CLIENT_UPDATE_REQUIRED',
        });
        assert.equal(state.created, 0);
        assert.equal(state.sourceCalls, 0);
        assert.deepEqual(state.rpcCalls, []);
        assert.equal(state.referralCalls, 0);
        assert.equal(state.rewardCalls, 0);
        assert.deepEqual(state.finishCalls, []);
        assert.deepEqual(state.customer, customer);
      }
    },
  );

  await t.test(
    'invalid JWT or reward claims cannot reach directory or credential storage',
    async () => {
      reset();
      assert.equal((await request(body, 'invalid')).status, 401);
      assert.equal((await request({ ...body, rewardAmount: 300 })).status, 400);
      assert.equal(state.sourceCalls, 0);
      assert.equal(state.created, 0);
      assert.equal(credentialCalls().length, 0);
    },
  );
  for (const unavailableAt of [1, 2]) {
    await t.test(
      `directory failure at eligibility check ${unavailableAt} preserves grant and retries successfully`,
      async () => {
        reset();
        state.unavailableAt = unavailableAt;
        const failed = await request();
        assert.equal(failed.status, 503);
        assert.equal((await failed.json()).code, 'STAFF_DIRECTORY_UNAVAILABLE');
        assert.equal(state.created, unavailableAt === 1 ? 0 : 1);
        assert.equal(state.grantPresent, true);
        assert.equal(state.credentialVersion, null);
        assert.equal(credentialCalls().length, 0);
        assert.equal(state.finishCalls.length, 0);
        state.unavailableAt = 0;
        const retried = await request();
        assert.equal(retried.status, 200);
        assert.equal((await retried.json()).customer.name, 'Гость Тестовый');
        assert.equal(state.created, 1);
        assert.equal(credentialCalls().length, 1);
        assert.equal(state.grantPresent, false);
        assert.deepEqual(state.finishCalls[0].options, {
          cashierInviteToken: inviteToken,
          cashierSnapshot: cashier,
        });
      },
    );
  }
  await t.test(
    'credential insertion failure returns safe error and verified retry reaches the same atomic RPC',
    async () => {
      reset();
      state.credentialFailure = true;
      const failed = await request();
      assert.equal(failed.status, 500);
      assert.equal((await failed.json()).error, 'Internal Server Error');
      assert.equal(state.grantPresent, true);
      assert.equal(state.credentialVersion, null);
      assert.equal(state.finishCalls.length, 0);
      const retried = await request();
      assert.equal(retried.status, 200);
      assert.equal(credentialCalls().length, 2);
      assert.equal(state.created, 1);
      assert.equal(state.finishCalls.length, 1);
    },
  );
  await t.test(
    'profile transaction failure keeps the created password and permits an idempotent verified retry',
    async () => {
      reset();
      state.profileFailure = true;
      const failed = await request();
      assert.equal(failed.status, 500);
      assert.equal(state.grantPresent, false);
      assert.equal(state.credentialVersion, 1);
      assert.equal(state.customer.name, 'Новый Гость');
      const retried = await request();
      assert.equal(retried.status, 200);
      assert.equal((await retried.json()).accessToken, 'synthetic-access');
      assert.equal(state.credentialVersion, 1);
      assert.equal(credentialCalls().length, 2);
      assert.equal(state.finishCalls.length, 2);
      assert.equal((await request()).status, 409);
      assert.equal(credentialCalls().length, 2);
    },
  );
  await t.test(
    'ordinary phone-verified registration does not depend on staff directory availability',
    async () => {
      reset();
      state.unavailableAt = 1;
      const ordinary = { ...body };
      delete ordinary.cashierInviteToken;
      const result = await request(ordinary);
      assert.equal(result.status, 200);
      assert.equal(state.sourceCalls, 0);
      assert.equal(credentialCalls().length, 1);
      assert.deepEqual(state.finishCalls[0].options, {
        cashierInviteToken: undefined,
        cashierSnapshot: undefined,
      });
    },
  );
  await t.test(
    'legacy completion remains compatible when registration AutoCall is not selected',
    async () => {
      reset();
      process.env.CUSTOMER_REGISTRATION_OTP_PROVIDER = 'legacy_whatsapp';
      try {
        const otp = await authRequest('request-otp', { phone, token: 'LegacyLogin23456' });
        assert.equal(otp.status, 200);
        assert.equal((await otp.json()).channel, 'whatsapp');
        assert.equal(state.challengeWrites.length, 1);
        const result = await request(body, signRegistrationToken(phone));
        assert.equal(result.status, 200);
        assert.equal((await result.json()).accessToken, 'synthetic-access');
        assert.equal(state.created, 1);
        assert.equal(credentialCalls().length, 0);
        assert.equal(state.finishCalls.length, 1);
      } finally {
        process.env.CUSTOMER_REGISTRATION_OTP_PROVIDER = 'autocall_sms';
      }
    },
  );
});

const assert = require('node:assert/strict');
const test = require('node:test');

function installModule(t, request, exports) {
  const resolved = require.resolve(request);
  const previous = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
  t.after(() => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  });
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('avatar-only profile update persists and is returned by the profile serializer', async (t) => {
  const customerId = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
  const nextAvatarKey = 'kz_female_03';
  let customer = {
    id: customerId,
    name: 'Амандык',
    phone: '77762003590',
    balance: 1250,
    total_spent: 42000,
    avatar_key: 'kz_male_01',
    fcm_token: 'private-push-token',
    telegram_id: 'private-telegram-id',
  };
  const updates = [];
  const updateFilters = [];
  let loyaltySyncCalls = 0;

  installModule(t, '../src/config/supabase', {
    supabase: {
      from(table) {
        assert.equal(table, 'customers');
        let operation = 'select';
        let updatePayload = null;
        let customerFilter = null;

        const query = {
          select() {
            operation = 'select';
            return this;
          },
          update(payload) {
            operation = 'update';
            updatePayload = { ...payload };
            updates.push(updatePayload);
            return this;
          },
          eq(column, value) {
            assert.equal(column, 'id');
            customerFilter = value;
            if (operation === 'update') updateFilters.push([column, value]);
            return this;
          },
          async single() {
            assert.equal(operation, 'select');
            assert.equal(customerFilter, customerId);
            return { data: { ...customer }, error: null };
          },
          then(resolve, reject) {
            return Promise.resolve()
              .then(() => {
                assert.equal(operation, 'update');
                assert.equal(customerFilter, customerId);
                customer = { ...customer, ...updatePayload };
                return { error: null };
              })
              .then(resolve, reject);
          },
        };

        return query;
      },
    },
  });
  installModule(t, '../src/services/realtime.service', { publish: async () => {} });
  installModule(t, '../src/services/loyalty-sync.service', {
    queueCustomerLoyaltySync: () => {
      loyaltySyncCalls += 1;
    },
  });

  const customerServicePath = require.resolve('../src/services/customer.service');
  const previousCustomerService = require.cache[customerServicePath];
  delete require.cache[customerServicePath];
  t.after(() => {
    if (previousCustomerService) require.cache[customerServicePath] = previousCustomerService;
    else delete require.cache[customerServicePath];
  });
  const customerService = require(customerServicePath);

  installModule(t, '../src/services/privacy.service', {
    deleteCustomerData: async () => {},
    exportCustomerData: async () => ({}),
  });
  installModule(t, '../src/services/location.service', {
    getCitiesWithPoints: async () => [],
  });
  installModule(t, '../src/services/settings.service', {
    getSettings: async () => ({}),
  });
  installModule(t, '../src/services/tier.service', {
    getActiveLoyaltyTiers: async () => [],
  });
  installModule(t, '../src/utils/tier.util', {
    getTierInfo: () => ({ code: 'platinum', percent: 5, remaining: 0, progress: 1 }),
  });
  installModule(t, '../src/utils/http.util', {
    sendApiError: (res, error) =>
      res.status(error.statusCode || 500).json({ error: error.message }),
  });

  const controllerPath = require.resolve('../src/controllers/public.controller');
  const previousController = require.cache[controllerPath];
  delete require.cache[controllerPath];
  t.after(() => {
    if (previousController) require.cache[controllerPath] = previousController;
    else delete require.cache[controllerPath];
  });
  const publicController = require(controllerPath);
  const { profileUpdateBodySchema } = require('../src/contracts/customer-api.contract');
  const parsedBody = profileUpdateBodySchema.parse({ avatar_key: nextAvatarKey });

  const updateResponse = responseRecorder();
  await publicController.updateProfile(
    { customerAuth: { id: customerId }, body: parsedBody },
    updateResponse,
  );

  assert.equal(updateResponse.statusCode, 200);
  assert.deepEqual(updateResponse.body, { success: true });
  assert.deepEqual(updates, [{ avatar_key: nextAvatarKey }]);
  assert.deepEqual(updateFilters, [['id', customerId]]);
  assert.equal(loyaltySyncCalls, 0);
  assert.equal((await customerService.getCustomerById(customerId)).avatar_key, nextAvatarKey);

  const profileResponse = responseRecorder();
  await publicController.getProfile({ customerAuth: { id: customerId } }, profileResponse);

  assert.equal(profileResponse.statusCode, 200);
  assert.equal(profileResponse.body.success, true);
  assert.equal(profileResponse.body.customer.avatar_key, nextAvatarKey);
  assert.equal(profileResponse.body.customer.fcm_token, undefined);
  assert.equal(profileResponse.body.customer.telegram_id, undefined);
});

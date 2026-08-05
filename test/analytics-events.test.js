const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

test('analytics events keep a stable hashed session and deduplicate by client event ID', async (t) => {
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/analytics-event.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  let captured;
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      supabase: {
        from(table) {
          assert.equal(table, 'customer_app_events');
          return {
            async upsert(rows, options) {
              captured = { rows: Array.isArray(rows) ? rows : [rows], options };
              return { error: null };
            },
          };
        },
      },
    },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });

  const { recordCustomerEvents } = require(servicePath);
  const eventId = '317615f9-b35f-4eb4-9f6d-777f2236bb25';
  const branchId = '217615f9-b35f-4eb4-9f6d-777f2236bb25';
  const accepted = await recordCustomerEvents(
    '117615f9-b35f-4eb4-9f6d-777f2236bb25',
    [{ eventId, type: 'checkout_start', branchId }],
    { headers: { 'x-bulka-session': 'app-session-1' } },
  );

  assert.equal(accepted, 1);
  assert.equal(captured.rows[0].client_event_id, eventId);
  assert.equal(captured.rows[0].branch_id, branchId);
  assert.equal(captured.rows[0].event_type, 'checkout_started');
  assert.equal(
    captured.rows[0].anonymous_session_id,
    crypto.createHash('sha256').update('app-session-1').digest('hex'),
  );
  assert.deepEqual(captured.options, {
    onConflict: 'client_event_id',
    ignoreDuplicates: true,
  });
});

test('guest analytics stores an anonymous session without a forged customer', async (t) => {
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/analytics-event.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  let captured;
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      supabase: {
        from(table) {
          assert.equal(table, 'customer_app_events');
          return {
            async upsert(rows) {
              captured = rows;
              return { error: null };
            },
          };
        },
      },
    },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });

  const { recordCustomerEvents } = require(servicePath);
  await recordCustomerEvents(
    null,
    [
      {
        eventId: '617615f9-b35f-4eb4-9f6d-777f2236bb25',
        type: 'catalog_view',
      },
    ],
    { headers: { 'x-bulka-session': 'guest-browser-session' } },
  );

  assert.equal(captured[0].customer_id, null);
  assert.equal(
    captured[0].anonymous_session_id,
    crypto.createHash('sha256').update('guest-browser-session').digest('hex'),
  );
});

test('analytics accepts separate payment failure and cancellation outcomes', async (t) => {
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/analytics-event.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  const eventTypes = [];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      supabase: {
        from() {
          return {
            async upsert(row) {
              eventTypes.push(row.event_type);
              return { error: null };
            },
          };
        },
      },
    },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });

  const { recordSystemEvent } = require(servicePath);
  await recordSystemEvent(null, { type: 'payment_failed' });
  await recordSystemEvent(null, { type: 'payment_cancelled' });
  assert.deepEqual(eventTypes, ['payment_failed', 'payment_cancelled']);
});

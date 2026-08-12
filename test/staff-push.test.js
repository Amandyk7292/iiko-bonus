const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const servicePath = require.resolve('../src/services/staff-push.service');
const configPath = require.resolve('../src/config/supabase');
const pushPath = require.resolve('../src/services/push.service');
const sessionPath = require.resolve('../src/services/admin-session.service');

const withService = async (t, { rpc, sendToken }, callback) => {
  const previous = new Map(
    [servicePath, configPath, pushPath, sessionPath].map((item) => [item, require.cache[item]]),
  );
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase: { rpc } },
  };
  require.cache[pushPath] = {
    id: pushPath,
    filename: pushPath,
    loaded: true,
    exports: { sendPushNotificationDetailed: sendToken },
  };
  require.cache[sessionPath] = {
    id: sessionPath,
    filename: sessionPath,
    loaded: true,
    exports: { sessionHash: (value) => `hash:${value}` },
  };
  delete require.cache[servicePath];
  t.after(() => {
    for (const [item, cached] of previous) {
      if (cached) require.cache[item] = cached;
      else delete require.cache[item];
    }
  });
  return callback(require(servicePath));
};

test('staff push registration derives identity from a cashier session and never returns token', async (t) => {
  const calls = [];
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        return {
          data: [{ device_id: 'device-1', platform: 'ios', installation_id: 'ipad.branch.1' }],
          error: null,
        };
      },
      sendToken: async () => ({ delivered: true, terminal: true }),
    },
    async ({ registerStaffPushDevice }) => {
      const result = await registerStaffPushDevice(
        { jti: 'session-1', role: 'cashier' },
        {
          fcmToken: 'private-fcm-token-value-123',
          platform: 'ios',
          installationId: 'ipad.branch.1',
        },
      );
      assert.deepEqual(result, { platform: 'ios', installationId: 'ipad.branch.1' });
      assert.deepEqual(calls[0], [
        'register_staff_push_device',
        {
          p_session_jti_hash: 'hash:session-1',
          p_token: 'private-fcm-token-value-123',
          p_platform: 'ios',
          p_installation_id: 'ipad.branch.1',
        },
      ]);
      assert.doesNotMatch(JSON.stringify(result), /private-fcm/);
    },
  );
});

test('staff push registration rejects non-cashier sessions before database access', async (t) => {
  let called = false;
  await withService(
    t,
    {
      rpc: async () => {
        called = true;
        return { data: null, error: null };
      },
      sendToken: async () => ({ delivered: true, terminal: true }),
    },
    async ({ registerStaffPushDevice }) => {
      await assert.rejects(
        () =>
          registerStaffPushDevice(
            { jti: 'session-1', role: 'operator' },
            {
              fcmToken: 'private-fcm-token-value-123',
              platform: 'ios',
              installationId: 'ipad.branch.1',
            },
          ),
        (error) => error.code === 'STAFF_PUSH_CASHIER_REQUIRED',
      );
      assert.equal(called, false);
    },
  );
});

test('staff iPad heartbeat is session-bound and returns only active state', async (t) => {
  const calls = [];
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        return { data: true, error: null };
      },
      sendToken: async () => ({ delivered: true, terminal: true }),
    },
    async ({ touchStaffPushDeviceHeartbeat }) => {
      const active = await touchStaffPushDeviceHeartbeat(
        { jti: 'session-1', role: 'cashier' },
        { platform: 'ios', installationId: 'ipad.branch.1' },
      );
      assert.equal(active, true);
      assert.deepEqual(calls, [
        [
          'touch_staff_push_device_heartbeat',
          {
            p_session_jti_hash: 'hash:session-1',
            p_platform: 'ios',
            p_installation_id: 'ipad.branch.1',
          },
        ],
      ]);
    },
  );
});

test('staff push worker emits a generic non-PII new-order payload and completes its lease', async (t) => {
  const calls = [];
  const sent = [];
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'claim_staff_push_deliveries_v2') {
          return {
            data: [
              {
                delivery_id: 'delivery-1',
                outbox_id: 'outbox-1',
                lease_token: 'lease-1',
                token: 'private-fcm-token-value-123',
                order_id: '11111111-1111-4111-8111-111111111111',
                order_number: 100123,
                attempt_count: 1,
                max_attempts: 8,
                expires_at: '2026-08-12T12:15:00.000Z',
              },
            ],
            error: null,
          };
        }
        return { data: true, error: null };
      },
      sendToken: async (...args) => {
        sent.push(args);
        return { delivered: true, terminal: true, providerMessageId: 'provider-1' };
      },
    },
    async ({ flushStaffPushOutbox }) => {
      assert.deepEqual(await flushStaffPushOutbox(), [
        { deliveryId: 'delivery-1', status: 'sent', attempted: 1, delivered: 1 },
      ]);
      assert.equal(sent[0][1], 'Новый заказ');
      assert.equal(sent[0][2], 'Поступил новый оплаченный заказ');
      assert.deepEqual(sent[0][3], {
        type: 'staff.order.new',
        orderId: '11111111-1111-4111-8111-111111111111',
        orderNumber: '100123',
        deepLink: '/admin/kitchen?embedded=app',
        pushOutboxId: 'outbox-1',
        pushDedupeKey: 'staff-order:11111111-1111-4111-8111-111111111111',
      });
      assert.deepEqual(sent[0][4], { expiresAt: '2026-08-12T12:15:00.000Z' });
      assert.doesNotMatch(JSON.stringify(sent[0]), /phone|address|amount|cart|customer/i);
      assert.equal(calls.at(-1)[0], 'complete_staff_push_delivery');
      assert.equal(calls.at(-1)[1].p_lease_token, 'lease-1');
    },
  );
});

test('staff push worker never contacts FCM when the pre-dispatch recheck skips expired work', async (t) => {
  const calls = [];
  let sends = 0;
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'claim_staff_push_deliveries_v2') {
          return {
            data: [
              {
                delivery_id: 'delivery-expired',
                outbox_id: 'outbox-expired',
                lease_token: 'lease-expired',
                token: 'private-expired-token-1234567890',
                order_id: '12121212-1212-4212-8212-121212121212',
                order_number: 100130,
                attempt_count: 1,
                max_attempts: 8,
                expires_at: '2026-08-12T00:00:00.000Z',
              },
            ],
            error: null,
          };
        }
        if (name === 'begin_staff_push_delivery_dispatch_v2') {
          return { data: 'skipped', error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
      sendToken: async () => {
        sends += 1;
        return { delivered: true, terminal: true };
      },
    },
    async ({ flushStaffPushOutbox }) => {
      assert.deepEqual(await flushStaffPushOutbox(), [
        { deliveryId: 'delivery-expired', status: 'skipped', attempted: 0, delivered: 0 },
      ]);
      assert.equal(sends, 0);
      assert.deepEqual(
        calls.map(([name]) => name),
        ['claim_staff_push_deliveries_v2', 'begin_staff_push_delivery_dispatch_v2'],
      );
    },
  );
});

test('ambiguous provider result is persisted as terminal uncertain without leaking its message', async (t) => {
  const calls = [];
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'claim_staff_push_deliveries_v2') {
          return {
            data: [
              {
                delivery_id: 'delivery-ambiguous-result',
                outbox_id: 'outbox-ambiguous-result',
                lease_token: 'lease-ambiguous-result',
                token: 'private-fcm-token-ambiguous-result',
                order_id: '66666666-6666-4666-8666-666666666666',
                order_number: 100128,
                attempt_count: 1,
                max_attempts: 8,
              },
            ],
            error: null,
          };
        }
        return { data: true, error: null };
      },
      sendToken: async () => ({
        delivered: false,
        terminal: false,
        outcomeUnknown: true,
        error: 'timeout included https://private.example/token/secret-value',
      }),
    },
    async ({ flushStaffPushOutbox }) => {
      assert.deepEqual(await flushStaffPushOutbox(), [
        {
          deliveryId: 'delivery-ambiguous-result',
          status: 'uncertain',
          attempted: 1,
          delivered: 0,
        },
      ]);
      const complete = calls.find(([name]) => name === 'complete_staff_push_delivery');
      assert.equal(complete[1].p_status, 'uncertain');
      assert.equal(complete[1].p_last_error, 'FCM delivery outcome uncertain');
      assert.equal(complete[1].p_retry_seconds, null);
      assert.doesNotMatch(JSON.stringify(calls), /private\.example|secret-value/);
      assert.equal(
        calls.some(([name]) => name === 'release_staff_push_delivery_claim'),
        false,
      );
    },
  );
});

test('thrown transport with no proven rejection is also completed as uncertain', async (t) => {
  const calls = [];
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'claim_staff_push_deliveries_v2') {
          return {
            data: [
              {
                delivery_id: 'delivery-thrown-timeout',
                outbox_id: 'outbox-thrown-timeout',
                lease_token: 'lease-thrown-timeout',
                token: 'private-fcm-token-thrown-timeout',
                order_id: '77777777-7777-4777-8777-777777777777',
                order_number: 100129,
                attempt_count: 1,
                max_attempts: 8,
              },
            ],
            error: null,
          };
        }
        return { data: true, error: null };
      },
      sendToken: async () => {
        const error = new Error('request timed out after write');
        error.code = 'ETIMEDOUT';
        throw error;
      },
    },
    async ({ flushStaffPushOutbox }) => {
      const [result] = await flushStaffPushOutbox();
      assert.equal(result.status, 'uncertain');
      const complete = calls.find(([name]) => name === 'complete_staff_push_delivery');
      assert.equal(complete[1].p_status, 'uncertain');
      assert.equal(complete[1].p_last_error, 'FCM delivery outcome uncertain (ETIMEDOUT)');
      assert.equal(
        calls.some(([name]) => name === 'release_staff_push_delivery_claim'),
        false,
      );
    },
  );
});

test('failed uncertain completion is quarantined after lease expiry and never released or resent', async (t) => {
  const calls = [];
  let deliveryStatus = 'queued';
  let sends = 0;
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'claim_staff_push_deliveries_v2') {
          if (deliveryStatus === 'queued') {
            deliveryStatus = 'processing';
            return {
              data: [
                {
                  delivery_id: 'delivery-uncertain-write-failed',
                  outbox_id: 'outbox-uncertain-write-failed',
                  lease_token: 'lease-uncertain-write-failed',
                  token: 'private-fcm-token-uncertain-write-failed',
                  order_id: '88888888-8888-4888-8888-888888888888',
                  order_number: 100130,
                  attempt_count: 1,
                  max_attempts: 8,
                },
              ],
              error: null,
            };
          }
          if (deliveryStatus === 'dispatching') {
            // Models claim_staff_push_deliveries_v2 after the five-minute lease:
            // stale dispatching rows are terminally quarantined, not claimed.
            deliveryStatus = 'uncertain';
          }
          return { data: [], error: null };
        }
        if (name === 'begin_staff_push_delivery_dispatch_v2') {
          deliveryStatus = 'dispatching';
          return { data: true, error: null };
        }
        if (name === 'complete_staff_push_delivery') {
          assert.equal(args.p_status, 'uncertain');
          return {
            data: null,
            error: { code: 'DATABASE_WRITE_FAILED', message: 'write unavailable' },
          };
        }
        if (name === 'release_staff_push_delivery_claim') {
          deliveryStatus = 'retry';
        }
        return { data: true, error: null };
      },
      sendToken: async () => {
        sends += 1;
        return {
          delivered: false,
          terminal: false,
          outcomeUnknown: true,
          error: 'ETIMEDOUT',
        };
      },
    },
    async ({ flushStaffPushOutbox }) => {
      await assert.rejects(
        () => flushStaffPushOutbox(),
        (error) => {
          assert.deepEqual(error.failures, [
            {
              deliveryId: 'delivery-uncertain-write-failed',
              code: 'DATABASE_WRITE_FAILED',
              released: false,
              recovered: false,
              uncertain: true,
            },
          ]);
          return true;
        },
      );
      assert.equal(deliveryStatus, 'dispatching');
      assert.equal(
        calls.some(([name]) => name === 'release_staff_push_delivery_claim'),
        false,
      );

      assert.deepEqual(await flushStaffPushOutbox(), []);
      assert.equal(deliveryStatus, 'uncertain');
      assert.equal(sends, 1, 'stale uncertain delivery is never sent a second time');
    },
  );
});

test('one persistence failure releases its claim and never strands the remaining batch', async (t) => {
  const calls = [];
  const sent = [];
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'claim_staff_push_deliveries_v2') {
          return {
            data: [
              {
                delivery_id: 'delivery-1',
                outbox_id: 'outbox-1',
                lease_token: 'lease-1',
                token: 'private-fcm-token-value-1',
                order_id: '11111111-1111-4111-8111-111111111111',
                order_number: 100123,
                attempt_count: 1,
                max_attempts: 8,
              },
              {
                delivery_id: 'delivery-2',
                outbox_id: 'outbox-2',
                lease_token: 'lease-2',
                token: 'private-fcm-token-value-2',
                order_id: '22222222-2222-4222-8222-222222222222',
                order_number: 100124,
                attempt_count: 1,
                max_attempts: 8,
              },
            ],
            error: null,
          };
        }
        if (name === 'complete_staff_push_delivery' && args.p_delivery_id === 'delivery-1') {
          return { data: null, error: { code: 'DATABASE_WRITE_FAILED', message: 'write failed' } };
        }
        return { data: true, error: null };
      },
      sendToken: async (token, _title, _body, data) => {
        sent.push(data);
        if (token.endsWith('-1')) {
          return { delivered: false, terminal: false, error: 'temporary transport failure' };
        }
        return { delivered: true, terminal: true, providerMessageId: 'accepted-by-fcm' };
      },
    },
    async ({ flushStaffPushOutbox }) => {
      await assert.rejects(
        () => flushStaffPushOutbox(),
        (error) => {
          assert.equal(error.code, 'STAFF_PUSH_BATCH_PARTIAL_FAILURE');
          assert.deepEqual(error.outcomes, [
            { deliveryId: 'delivery-2', status: 'sent', attempted: 1, delivered: 1 },
          ]);
          assert.deepEqual(error.failures, [
            {
              deliveryId: 'delivery-1',
              code: 'DATABASE_WRITE_FAILED',
              released: true,
              recovered: false,
            },
          ]);
          return true;
        },
      );
      assert.equal(sent.length, 2, 'the second claimed delivery is still processed');
      assert.deepEqual(
        sent.map((data) => data.pushOutboxId),
        ['outbox-1', 'outbox-2'],
      );
      const release = calls.find(([name]) => name === 'release_staff_push_delivery_claim');
      assert.equal(release[1].p_delivery_id, 'delivery-1');
      assert.equal(release[1].p_lease_token, 'lease-1');
      assert.equal(
        calls.some(
          ([name, args]) =>
            name === 'complete_staff_push_delivery' && args.p_delivery_id === 'delivery-2',
        ),
        true,
      );
    },
  );
});

test('FCM-accepted completion recovers as sent and is never released for retry', async (t) => {
  const calls = [];
  let claimCount = 0;
  let sends = 0;
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'claim_staff_push_deliveries_v2') {
          claimCount += 1;
          return claimCount === 1
            ? {
                data: [
                  {
                    delivery_id: 'delivery-recovered',
                    outbox_id: 'outbox-stable',
                    lease_token: 'lease-recovered',
                    token: 'private-fcm-token-recovered',
                    order_id: '33333333-3333-4333-8333-333333333333',
                    order_number: 100125,
                    attempt_count: 1,
                    max_attempts: 8,
                  },
                ],
                error: null,
              }
            : { data: [], error: null };
        }
        if (name === 'complete_staff_push_delivery') {
          return { data: null, error: { code: 'RESPONSE_LOST', message: 'response lost' } };
        }
        if (name === 'recover_staff_push_delivery_sent') return { data: true, error: null };
        return { data: true, error: null };
      },
      sendToken: async (_token, _title, _body, data) => {
        sends += 1;
        assert.equal(data.pushOutboxId, 'outbox-stable');
        return { delivered: true, terminal: true, providerMessageId: 'fcm-message-stable' };
      },
    },
    async ({ flushStaffPushOutbox }) => {
      await assert.rejects(
        () => flushStaffPushOutbox(),
        (error) => {
          assert.equal(error.code, 'STAFF_PUSH_BATCH_PARTIAL_FAILURE');
          assert.deepEqual(error.outcomes, [
            {
              deliveryId: 'delivery-recovered',
              status: 'sent',
              attempted: 1,
              delivered: 1,
              recovered: true,
            },
          ]);
          assert.deepEqual(error.failures, [
            {
              deliveryId: 'delivery-recovered',
              code: 'RESPONSE_LOST',
              released: false,
              recovered: true,
            },
          ]);
          return true;
        },
      );
      assert.equal(
        calls.some(([name]) => name === 'release_staff_push_delivery_claim'),
        false,
      );
      const recovery = calls.find(([name]) => name === 'recover_staff_push_delivery_sent');
      assert.deepEqual(recovery[1], {
        p_delivery_id: 'delivery-recovered',
        p_lease_token: 'lease-recovered',
        p_provider_message_id: 'fcm-message-stable',
      });
      assert.deepEqual(await flushStaffPushOutbox(), []);
      assert.equal(sends, 1, 'the next worker does not resend a recovered delivery');
    },
  );
});

test('FCM is never contacted unless the durable dispatch boundary commits', async (t) => {
  const calls = [];
  let sends = 0;
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'claim_staff_push_deliveries_v2') {
          return {
            data: [
              {
                delivery_id: 'delivery-not-dispatched',
                outbox_id: 'outbox-not-dispatched',
                lease_token: 'lease-not-dispatched',
                token: 'private-fcm-token-not-dispatched',
                order_id: '44444444-4444-4444-8444-444444444444',
                order_number: 100126,
                attempt_count: 1,
                max_attempts: 8,
              },
            ],
            error: null,
          };
        }
        if (name === 'begin_staff_push_delivery_dispatch_v2') {
          return {
            data: null,
            error: { code: 'DISPATCH_BOUNDARY_FAILED', message: 'commit not confirmed' },
          };
        }
        return { data: true, error: null };
      },
      sendToken: async () => {
        sends += 1;
        return { delivered: true, terminal: true };
      },
    },
    async ({ flushStaffPushOutbox }) => {
      await assert.rejects(
        () => flushStaffPushOutbox(),
        (error) => {
          assert.equal(error.code, 'STAFF_PUSH_BATCH_PARTIAL_FAILURE');
          assert.deepEqual(error.failures, [
            {
              deliveryId: 'delivery-not-dispatched',
              code: 'DISPATCH_BOUNDARY_FAILED',
              released: true,
              recovered: false,
              stage: 'dispatch-start',
            },
          ]);
          return true;
        },
      );
      assert.equal(sends, 0);
      assert.equal(calls[0][0], 'claim_staff_push_deliveries_v2');
      assert.equal(calls[1][0], 'begin_staff_push_delivery_dispatch_v2');
      assert.equal(calls[2][0], 'release_staff_push_delivery_claim');
    },
  );
});

test('FCM-accepted delivery becomes fail-closed when every sent recovery call fails', async (t) => {
  const calls = [];
  let claimCount = 0;
  let sends = 0;
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'claim_staff_push_deliveries_v2') {
          claimCount += 1;
          return claimCount === 1
            ? {
                data: [
                  {
                    delivery_id: 'delivery-uncertain',
                    outbox_id: 'outbox-uncertain',
                    lease_token: 'lease-uncertain',
                    token: 'private-fcm-token-uncertain',
                    order_id: '55555555-5555-4555-8555-555555555555',
                    order_number: 100127,
                    attempt_count: 1,
                    max_attempts: 8,
                  },
                ],
                error: null,
              }
            : { data: [], error: null };
        }
        if (name === 'complete_staff_push_delivery') {
          return { data: null, error: { code: 'DATABASE_DOWN', message: 'write unavailable' } };
        }
        if (name === 'recover_staff_push_delivery_sent') {
          return { data: null, error: { code: 'DATABASE_DOWN', message: 'write unavailable' } };
        }
        return { data: true, error: null };
      },
      sendToken: async () => {
        sends += 1;
        return { delivered: true, terminal: true, providerMessageId: 'accepted-uncertain' };
      },
    },
    async ({ flushStaffPushOutbox }) => {
      await assert.rejects(
        () => flushStaffPushOutbox(),
        (error) => {
          assert.deepEqual(error.failures, [
            {
              deliveryId: 'delivery-uncertain',
              code: 'DATABASE_DOWN',
              released: false,
              recovered: false,
              uncertain: true,
            },
          ]);
          return true;
        },
      );
      assert.equal(calls.filter(([name]) => name === 'recover_staff_push_delivery_sent').length, 3);
      assert.equal(
        calls.some(([name]) => name === 'release_staff_push_delivery_claim'),
        false,
      );
      assert.deepEqual(await flushStaffPushOutbox(), []);
      assert.equal(sends, 1, 'an accepted-but-uncertain notification is never resent');
    },
  );
});

test('terminal staff token failures deactivate the token and are not retried', async (t) => {
  const calls = [];
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'claim_staff_push_deliveries_v2') {
          return {
            data: [
              {
                delivery_id: 'delivery-1',
                outbox_id: 'outbox-terminal-1',
                lease_token: 'lease-1',
                token: 'dead-token-value-123456',
                order_id: '11111111-1111-4111-8111-111111111111',
                order_number: 100123,
                attempt_count: 1,
                max_attempts: 8,
              },
            ],
            error: null,
          };
        }
        return { data: true, error: null };
      },
      sendToken: async () => ({ delivered: false, terminal: true, error: 'not registered' }),
    },
    async ({ flushStaffPushOutbox }) => {
      const [result] = await flushStaffPushOutbox();
      assert.equal(result.status, 'failed');
      assert.equal(
        calls.some(([name]) => name === 'deactivate_invalid_staff_push_token'),
        true,
      );
      const complete = calls.find(([name]) => name === 'complete_staff_push_delivery');
      assert.equal(complete[1].p_status, 'failed');
    },
  );
});

test('logout cleanup deactivates every binding for the current session hash', async (t) => {
  const calls = [];
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        return { data: 2, error: null };
      },
      sendToken: async () => ({ delivered: true, terminal: true }),
    },
    async ({ deactivateStaffDevicesForSession }) => {
      await deactivateStaffDevicesForSession('session-logout');
      assert.deepEqual(calls, [
        [
          'deactivate_staff_push_devices_for_session',
          { p_session_jti_hash: 'hash:session-logout' },
        ],
      ]);
    },
  );
});

test('staff push test is current-session bound, token-private and maps cooldown', async (t) => {
  const calls = [];
  await withService(
    t,
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        return name === 'claim_staff_push_test_device'
          ? { data: [{ device_id: 'device-1', token: 'test-private-token-12345' }], error: null }
          : { data: true, error: null };
      },
      sendToken: async (_token, title, body, data) => {
        assert.equal(title, 'Тест уведомлений');
        assert.equal(body, 'Уведомления о заказах включены');
        assert.equal(data.type, 'staff.order.test');
        return { delivered: true, terminal: true };
      },
    },
    async ({ sendStaffPushTest }) => {
      const result = await sendStaffPushTest(
        { jti: 'session-test', role: 'cashier' },
        { platform: 'ios', installationId: 'ipad.branch.1' },
      );
      assert.deepEqual(result, { status: 'sent', attempted: 1, delivered: 1 });
      assert.doesNotMatch(JSON.stringify(result), /test-private-token/);
      assert.deepEqual(calls[0], [
        'claim_staff_push_test_device',
        {
          p_session_jti_hash: 'hash:session-test',
          p_platform: 'ios',
          p_installation_id: 'ipad.branch.1',
        },
      ]);
    },
  );

  await withService(
    t,
    {
      rpc: async () => ({ data: null, error: { message: 'staff push test cooldown' } }),
      sendToken: async () => ({ delivered: true, terminal: true }),
    },
    async ({ sendStaffPushTest }) => {
      await assert.rejects(
        () =>
          sendStaffPushTest(
            { jti: 'session-test', role: 'cashier' },
            { platform: 'ios', installationId: 'ipad.branch.1' },
          ),
        (error) => error.statusCode === 429 && error.code === 'STAFF_PUSH_TEST_COOLDOWN',
      );
    },
  );
});

test('staff push migration provides atomic paid trigger, TTL, authorization and safe leases', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '../supabase/migrations/20260812100000_staff_order_push_notifications.sql',
    ),
    'utf8',
  );
  assert.match(sql, /after insert or update of status on public\.kaspi_orders/i);
  assert.match(sql, /new\.status = 'paid'[\s\S]+old\.status is distinct from 'paid'/i);
  assert.match(sql, /unique\s*\(outbox_id, device_id\)/i);
  assert.match(sql, /unique[\s\S]+order_id/i);
  assert.match(
    sql,
    /constraint staff_push_devices_installation_unique\s+unique\s*\(platform, installation_id\)/i,
  );
  const registerStart = sql.indexOf('function public.register_staff_push_device');
  const registerEnd = sql.indexOf('function public.unregister_staff_push_device', registerStart);
  const registerSql = sql.slice(registerStart, registerEnd);
  assert.match(
    registerSql,
    /on conflict on constraint staff_push_devices_installation_unique do update/i,
  );
  assert.doesNotMatch(registerSql, /on conflict\s*\(\s*platform\s*,\s*installation_id\s*\)/i);
  assert.match(sql, /expires_at[\s\S]+interval '15 minutes'/i);
  assert.match(sql, /orders\.kitchen_status = 'queued'/i);
  assert.match(sql, /device\.branch_id = outbox\.branch_id/i);
  assert.match(sql, /session\.revoked_at is null and session\.expires_at > now\(\)/i);
  assert.match(sql, /credential\.auth_version = device\.auth_version/i);
  const claimStart = sql.indexOf('function public.claim_staff_push_deliveries');
  const leaseRecovery = sql.indexOf("last_error = 'Delivery lease expired'", claimStart);
  assert.ok(leaseRecovery > claimStart, 'stale leases recover inside the claim RPC');
  const claimSql = sql.slice(claimStart);
  assert.match(claimSql, /locked_at < now\(\) - interval '5 minutes'/i);
  assert.match(
    claimSql,
    /expired\.attempt_count >= expired\.max_attempts[\s\S]+expired\.status = 'processing'/i,
  );
  assert.match(claimSql, /device\.platform::text/i);
  assert.match(
    claimSql,
    /set status = case when exists \([\s\S]+uncertain\.status = 'uncertain'[\s\S]+then 'uncertain' when exists \([\s\S]+sent\.status = 'sent'[\s\S]+then 'sent'/i,
  );
  assert.match(
    claimSql,
    /not exists \([\s\S]+delivery\.status in \('queued', 'retry', 'processing', 'dispatching'\)[\s\S]+\);/i,
  );
  assert.doesNotMatch(
    claimSql.slice(0, claimSql.indexOf('return query')),
    /and not exists \([\s\S]+status = 'sent'/i,
  );
  assert.match(sql, /staff-push-registration/i);
  assert.match(sql, /last_test_at[\s\S]+interval '60 seconds'/i);
  assert.match(
    sql,
    /function public\.begin_staff_push_delivery_dispatch\([\s\S]+set status = 'dispatching'[\s\S]+status = 'processing'[\s\S]+lease_token = p_lease_token/i,
  );
  assert.match(
    sql,
    /set status = 'uncertain'[\s\S]+automatic resend disabled[\s\S]+where status = 'dispatching' and locked_at < now\(\) - interval '5 minutes'/i,
  );
  assert.match(
    sql,
    /function public\.release_staff_push_delivery_claim\([\s\S]+status in \('processing', 'dispatching'\)[\s\S]+lease_token = p_lease_token/i,
  );
  assert.match(
    sql,
    /function public\.recover_staff_push_delivery_sent\([\s\S]+status = 'dispatching'[\s\S]+lease_token = p_lease_token[\s\S]+status = 'sent'/i,
  );
  assert.match(
    sql,
    /function public\.complete_staff_push_delivery\([\s\S]+p_status not in \('sent', 'retry', 'failed', 'skipped', 'uncertain'\)[\s\S]+status = p_status/i,
  );
  assert.match(
    sql,
    /recover_staff_push_delivery_sent[\s\S]+already-sent row is therefore a recovered success/i,
  );
  assert.match(
    sql,
    /grant execute on function[\s\S]+begin_staff_push_delivery_dispatch\(uuid,uuid\)[\s\S]+to service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function[\s\S]+release_staff_push_delivery_claim\(uuid,uuid,text,integer\)[\s\S]+to service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function[\s\S]+recover_staff_push_delivery_sent\(uuid,uuid,text\)[\s\S]+to service_role/i,
  );
  assert.match(sql, /revoke all on public\.staff_push_devices[\s\S]+anon, authenticated/i);
});

test('staff push reliability migration backfills only fresh unaccepted same-branch orders', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20260812110000_staff_push_ttl_backfill.sql'),
    'utf8',
  );
  const registerStart = sql.indexOf('function public.register_staff_push_device');
  const registerSql = sql.slice(registerStart);
  const deliveryInsert = registerSql.indexOf('insert into public.staff_push_deliveries');

  assert.ok(registerStart >= 0);
  assert.ok(deliveryInsert > 0);
  assert.match(
    sql,
    /staff_push_outbox_max_ttl_check[\s\S]+expires_at <= created_at \+ interval '15 minutes'/i,
  );
  assert.match(
    registerSql,
    /role = 'cashier'[\s\S]+revoked_at is null[\s\S]+expires_at > now\(\)/i,
  );
  assert.match(registerSql, /credential\.auth_version = v_session\.auth_version/i);
  assert.match(registerSql, /profile\.branch_ids = array\[v_branch_id\]/i);
  assert.match(
    registerSql.slice(deliveryInsert),
    /outbox\.branch_id = v_branch_id[\s\S]+orders\.branch_id = v_branch_id/i,
  );
  assert.match(
    registerSql.slice(deliveryInsert),
    /outbox\.created_at >= now\(\) - interval '15 minutes'[\s\S]+outbox\.expires_at > now\(\)/i,
  );
  assert.match(
    registerSql.slice(deliveryInsert),
    /orders\.status = 'paid'[\s\S]+orders\.fulfillment_status in \('pending', 'new'\)[\s\S]+orders\.kitchen_status = 'queued'/i,
  );
  assert.match(
    registerSql.slice(deliveryInsert),
    /on conflict \(outbox_id, device_id\) do update[\s\S]+staff_push_deliveries\.status in \('failed', 'skipped'\)/i,
  );
  assert.doesNotMatch(
    registerSql.slice(deliveryInsert),
    /staff_push_deliveries\.status in \([^)]*(?:sent|uncertain|dispatching)/i,
  );
  assert.match(
    registerSql.slice(deliveryInsert),
    /status = case when outbox\.status in \('failed', 'skipped'\) then 'queued'/i,
  );
  assert.doesNotMatch(registerSql.slice(deliveryInsert), /phone|address|customer_id|cart_items/i);
  assert.match(registerSql, /security definer[\s\S]+set search_path = public, pg_temp/i);
  assert.match(
    sql,
    /function public\.claim_staff_push_deliveries_v2[\s\S]+insert into public\.staff_push_deliveries[\s\S]+on conflict \(outbox_id, device_id\) do nothing[\s\S]+claim_staff_push_deliveries\(p_limit\)[\s\S]+outbox\.expires_at/i,
  );
  const hardening = fs.readFileSync(
    path.join(
      __dirname,
      '../supabase/migrations/20260812130000_staff_order_reliability_hardening.sql',
    ),
    'utf8',
  );
  assert.match(
    hardening,
    /function public\.claim_staff_push_deliveries\(p_limit integer default 100\)[\s\S]+orders\.fulfillment_status in \('pending', 'new'\)/i,
  );
  assert.match(
    hardening,
    /function public\.touch_staff_push_device_heartbeat[\s\S]+device\.last_seen_at >= now\(\) - interval '90 seconds'/i,
  );
  assert.match(
    hardening,
    /on conflict on constraint staff_push_deliveries_outbox_id_device_id_key/i,
  );
  assert.match(
    sql,
    /function public\.begin_staff_push_delivery_dispatch_v2[\s\S]+v_expires_at <= now\(\)[\s\S]+v_order_status <> 'paid'[\s\S]+v_fulfillment_status not in \('pending', 'new'\)[\s\S]+v_kitchen_status <> 'queued'[\s\S]+v_device_active[\s\S]+session\.revoked_at is null[\s\S]+credential\.auth_version = v_device_auth_version/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.register_staff_push_device\(text,text,text,text\)[\s\S]+public, anon, authenticated/i,
  );
});

test('staff push routes are strict, cashier-scoped, and never expose a device token', () => {
  const routes = fs.readFileSync(
    path.join(__dirname, '../src/routes/admin/staff-push.routes.js'),
    'utf8',
  );
  const contract = fs.readFileSync(
    path.join(__dirname, '../src/contracts/staff-push.contract.js'),
    'utf8',
  );
  const auth = fs.readFileSync(
    path.join(__dirname, '../src/middlewares/auth.middleware.js'),
    'utf8',
  );
  const logger = fs.readFileSync(path.join(__dirname, '../src/config/logger.js'), 'utf8');
  assert.match(routes, /router\.get\([\s\S]+staff\/push-token[\s\S]+validateRequest/);
  assert.match(routes, /router\.post\([\s\S]+staff\/push-token[\s\S]+validateRequest/);
  assert.match(routes, /router\.delete\([\s\S]+staff\/push-token[\s\S]+validateRequest/);
  assert.match(routes, /staff\/push-test[\s\S]+validateRequest/);
  assert.match(routes, /staff\/push-heartbeat[\s\S]+validateRequest/);
  assert.doesNotMatch(routes, /fcmToken\s*:/);
  assert.match(contract, /\.strict\(\)/);
  assert.doesNotMatch(contract, /branchId|username|authVersion|session/i);
  assert.match(auth, /deactivateStaffDevicesForSession\(req\.admin\?\.jti\)/);
  assert.match(logger, /fcmToken/);
  assert.match(logger, /fcm_token/);
  const push = fs.readFileSync(path.join(__dirname, '../src/services/push.service.js'), 'utf8');
  assert.match(push, /\['staff\.order\.new', 'staff\.order\.test'\]\.includes/);
  assert.match(push, /channelId: isStaffOrder \? 'bulka_staff_orders'/);
});

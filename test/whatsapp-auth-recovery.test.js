const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getWhatsAppDisconnectAction,
  getWhatsAppDisconnectStatusCode,
  isWhatsAppAuthStorageId,
  resetSupabaseWhatsAppAuth,
} = require('../src/services/whatsapp-baileys.service');

test('WhatsApp auth cleanup identifies only Baileys credential rows', () => {
  const baileysIds = [
    'creds',
    'pre-key-42',
    'session-client@s.whatsapp.net',
    'sender-key-chat',
    'sender-key-memory-chat',
    'app-state-sync-key-key-id',
    'app-state-sync-version-regular',
    'lid-mapping-123',
    'device-list-7701',
    'tctoken-7701',
    'identity-key-7701',
  ];
  for (const id of baileysIds) assert.equal(isWhatsAppAuthStorageId(id), true, id);

  const applicationIds = [
    'otp_77010000000',
    'token_login-request',
    'admin_login_challenge',
    'courier_login_challenge',
    'task_message-id',
    'conversation-id',
    '',
  ];
  for (const id of applicationIds) assert.equal(isWhatsAppAuthStorageId(id), false, id);
});

test('WhatsApp auth reset uses a constrained Supabase delete filter', async () => {
  const calls = {};
  const client = {
    from(table) {
      calls.table = table;
      return {
        delete(options) {
          calls.options = options;
          return {
            async or(filter) {
              calls.filter = filter;
              return { error: null, count: 915 };
            },
          };
        },
      };
    },
  };

  const removed = await resetSupabaseWhatsAppAuth(client);
  assert.equal(removed, 915);
  assert.equal(calls.table, 'whatsapp_sessions');
  assert.deepEqual(calls.options, { count: 'exact' });
  assert.match(calls.filter, /id\.eq\.creds/);
  assert.match(calls.filter, /id\.like\.pre-key-\*/);
  assert.match(calls.filter, /id\.like\.identity-key-\*/);
  assert.doesNotMatch(calls.filter, /otp_|token_|task_/);
});

test('WhatsApp auth reset reports storage failures without leaking data', async () => {
  const client = {
    from() {
      return {
        delete() {
          return {
            async or() {
              return { error: new Error('database unavailable'), count: null };
            },
          };
        },
      };
    },
  };

  await assert.rejects(
    () => resetSupabaseWhatsAppAuth(client),
    (error) =>
      error.code === 'WHATSAPP_AUTH_RESET_FAILED' &&
      error.message === 'Не удалось подготовить новую привязку WhatsApp',
  );
});

test('WhatsApp disconnect reason is read from all Baileys error shapes', () => {
  assert.equal(getWhatsAppDisconnectStatusCode({ error: { output: { statusCode: 401 } } }), 401);
  assert.equal(
    getWhatsAppDisconnectStatusCode({ error: { cause: { output: { statusCode: 500 } } } }),
    500,
  );
  assert.equal(getWhatsAppDisconnectStatusCode({ error: { data: { statusCode: '411' } } }), 411);
  assert.equal(getWhatsAppDisconnectStatusCode({ error: new Error('Device was removed') }), 401);
});

test('WhatsApp clears revoked auth, retries network errors and stops replaced sessions', () => {
  for (const statusCode of [401, 403, 411, 500]) {
    assert.deepEqual(getWhatsAppDisconnectAction({ error: { output: { statusCode } } }), {
      action: 'reset_auth',
      statusCode,
    });
  }
  assert.deepEqual(getWhatsAppDisconnectAction({ error: { statusCode: 408 } }), {
    action: 'reconnect',
    statusCode: 408,
  });
  assert.deepEqual(getWhatsAppDisconnectAction({ error: { output: { statusCode: 440 } } }), {
    action: 'stop',
    statusCode: 440,
  });
});

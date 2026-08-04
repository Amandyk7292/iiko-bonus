const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  deliverWhatsAppOutbox,
  retryDelaySeconds,
  whatsappOutboxDedupeKey,
  whatsappProviderMessageId,
} = require('../src/services/whatsapp-outbox.service');

const root = path.resolve(__dirname, '..');

function outboxDatabase(rows) {
  const updates = [];
  const db = {
    updates,
    rpc: async (name, args) => {
      assert.equal(name, 'claim_whatsapp_outbox');
      assert.equal(args.p_limit, 25);
      return { data: rows, error: null };
    },
    from: (table) => ({
      update(values) {
        const response = { error: null };
        const builder = {
          eq(column, value) {
            updates.push({ table, values, column, value });
            return builder;
          },
          select() {
            return builder;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          then(resolve, reject) {
            return Promise.resolve(response).then(resolve, reject);
          },
        };
        return builder;
      },
    }),
  };
  return db;
}

test('WhatsApp outbox identifiers are stable and isolate different requests', () => {
  const first = whatsappOutboxDedupeKey('operator-text', 'conversation', 'client-request');
  const repeated = whatsappOutboxDedupeKey('operator-text', 'conversation', 'client-request');
  const other = whatsappOutboxDedupeKey('operator-text', 'conversation', 'other-request');
  assert.equal(first, repeated);
  assert.notEqual(first, other);
  assert.match(first, /^operator-text:[a-f0-9]{56}$/);
  assert.equal(whatsappProviderMessageId('outbox-id'), whatsappProviderMessageId('outbox-id'));
});

test('WhatsApp retry schedule is exponential and capped at fifteen minutes', () => {
  assert.equal(retryDelaySeconds(1), 15);
  assert.equal(retryDelaySeconds(2), 30);
  assert.equal(retryDelaySeconds(6), 480);
  assert.equal(retryDelaySeconds(20), 900);
});

test('successful queued WhatsApp delivery is persisted as sent', async () => {
  const row = {
    id: '3f3f3f3f-3333-4333-8333-333333333333',
    chat_jid: '77001234567@s.whatsapp.net',
    message_type: 'text',
    payload: { text: 'Тест' },
    attempt_count: 1,
    max_attempts: 8,
  };
  const db = outboxDatabase([row]);
  let providerDedupeId = '';
  const result = await deliverWhatsAppOutbox(
    {
      sendMessage: async (message) => {
        providerDedupeId = message.providerDedupeId;
        return { key: { id: message.providerDedupeId } };
      },
    },
    { db },
  );

  assert.equal(result[0].status, 'sent');
  assert.equal(result[0].queued, false);
  assert.equal(result[0].providerMessageId, providerDedupeId);
  assert.ok(
    db.updates.some(
      (update) =>
        update.table === 'whatsapp_outbox' &&
        update.values.status === 'sent' &&
        update.values.payload &&
        Object.keys(update.values.payload).length === 0,
    ),
  );
});

test('temporary WhatsApp failure remains queued with a future retry', async () => {
  const row = {
    id: '4f4f4f4f-4444-4444-8444-444444444444',
    chat_jid: '77001234567@s.whatsapp.net',
    message_type: 'text',
    payload: { text: 'Тест' },
    attempt_count: 2,
    max_attempts: 8,
    next_attempt_at: new Date().toISOString(),
  };
  const db = outboxDatabase([row]);
  const result = await deliverWhatsAppOutbox(
    {
      sendMessage: async () => {
        throw new Error('connection unavailable');
      },
    },
    { db },
  );

  assert.equal(result[0].status, 'retry');
  assert.equal(result[0].queued, true);
  const retry = db.updates.find(
    (update) => update.table === 'whatsapp_outbox' && update.values.status === 'retry',
  );
  assert.ok(retry);
  assert.ok(new Date(retry.values.next_attempt_at).getTime() > Date.now());
});

test('payment receipt messages are cancelled before reaching WhatsApp', async () => {
  const row = {
    id: '5f5f5f5f-5555-4555-8555-555555555555',
    chat_jid: '77001234567@s.whatsapp.net',
    message_type: 'text',
    source_type: 'payment_receipt',
    payload: {
      text: 'Сохранить торговый чек: https://bulka.com.kz/payment-receipts/example',
    },
    attempt_count: 1,
    max_attempts: 8,
  };
  const db = outboxDatabase([row]);
  let sendCalls = 0;
  const result = await deliverWhatsAppOutbox(
    {
      sendMessage: async () => {
        sendCalls += 1;
        return { key: { id: 'must-not-send' } };
      },
    },
    { db },
  );

  assert.equal(sendCalls, 0);
  assert.equal(result[0].status, 'cancelled');
  assert.equal(result[0].queued, false);
  assert.ok(
    db.updates.some(
      (update) =>
        update.table === 'whatsapp_outbox' &&
        update.values.status === 'cancelled' &&
        update.values.payload &&
        Object.keys(update.values.payload).length === 0,
    ),
  );
});

test('canonical WhatsApp outbox migration is service-role protected', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20260723170000_whatsapp_outbox.sql'),
    'utf8',
  );
  assert.match(migration, /dedupe_key varchar\(200\) not null unique/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /message\.attempt_count \+ 1/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /to service_role/i);
  assert.match(migration, /whatsapp-outbox/i);
});

test('payment receipt suppression migration cancels queued links and blocks new ones', () => {
  const migration = fs.readFileSync(
    path.join(
      root,
      'supabase',
      'migrations',
      '20260804100000_disable_whatsapp_payment_receipt_messages.sql',
    ),
    'utf8',
  );
  assert.match(migration, /where source_type = 'payment_receipt'/i);
  assert.match(migration, /status = case when status = 'sent' then status else 'cancelled' end/i);
  assert.match(migration, /new\.source_type = 'payment_receipt'/i);
  assert.match(migration, /new\.payload := '\{\}'::jsonb/i);
  assert.match(migration, /before insert or update\s+on public\.whatsapp_outbox/i);
});

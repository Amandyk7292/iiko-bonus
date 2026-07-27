const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DIRECT_EXPORT_RELATIONS,
  deleteCustomerData,
  exportCustomerData,
} = require('../src/services/privacy.service');

class Query {
  constructor(fixture, table) {
    this.fixture = fixture;
    this.table = table;
    this.operation = 'select';
    this.filters = [];
    this.payload = null;
  }

  select() {
    return this;
  }

  insert(payload) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => row?.[column] === value);
    return this;
  }

  is(column, value) {
    this.filters.push((row) => row?.[column] === value);
    return this;
  }

  in(column, values) {
    this.filters.push((row) => values.includes(row?.[column]));
    return this;
  }

  or(expression) {
    const checks = expression.split(',').map((item) => {
      const [column, operator, value] = item.split('.');
      assert.equal(operator, 'eq');
      return (row) => String(row?.[column]) === value;
    });
    this.filters.push((row) => checks.some((check) => check(row)));
    return this;
  }

  rows() {
    return (this.fixture.tables[this.table] || []).filter((row) =>
      this.filters.every((filter) => filter(row)),
    );
  }

  execute({ single = false, maybeSingle = false } = {}) {
    if (this.operation === 'insert') {
      const record = {
        id: this.payload.id || `${this.table}-${this.fixture.inserts.length + 1}`,
        ...this.payload,
      };
      this.fixture.tables[this.table] ||= [];
      this.fixture.tables[this.table].push(record);
      this.fixture.inserts.push({ table: this.table, record });
      return { data: single ? record : [record], error: null };
    }
    if (this.operation === 'update') {
      const rows = this.rows();
      rows.forEach((row) => Object.assign(row, this.payload));
      this.fixture.updates.push({ table: this.table, payload: this.payload, count: rows.length });
      return { data: rows, error: null };
    }
    const rows = this.rows();
    if (single || maybeSingle) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  }

  single() {
    return Promise.resolve(this.execute({ single: true }));
  }

  maybeSingle() {
    return Promise.resolve(this.execute({ maybeSingle: true }));
  }

  then(resolve, reject) {
    return Promise.resolve(this.execute()).then(resolve, reject);
  }
}

function createDb(tables = {}) {
  const fixture = {
    tables: structuredClone(tables),
    inserts: [],
    updates: [],
    rpcCalls: [],
    removals: [],
  };
  const db = {
    from(table) {
      return new Query(fixture, table);
    },
    async rpc(name, args = {}) {
      fixture.rpcCalls.push({ name, args });
      return { data: name === 'delete_customer_personal_data' ? { deleted: true } : 0, error: null };
    },
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            fixture.removals.push({ bucket, paths });
            return { data: paths, error: null };
          },
        };
      },
    },
  };
  return { db, fixture };
}

test('privacy export is complete enough and never persists its payload', async () => {
  const customerId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';
  const orderId = '33333333-3333-4333-8333-333333333333';
  const reviewId = '44444444-4444-4444-8444-444444444444';
  const supportId = '55555555-5555-4555-8555-555555555555';
  const referralCodeId = '66666666-6666-4666-8666-666666666666';
  const refundId = '77777777-7777-4777-8777-777777777777';
  const { db, fixture } = createDb({
    customers: [{ id: customerId, phone: '+77010000000', deleted_at: null }],
    kaspi_orders: [{ id: orderId, customer_id: customerId }],
    order_reviews: [{ id: reviewId, customer_id: customerId }],
    customer_support_requests: [{ id: supportId, customer_id: customerId }],
    whatsapp_conversations: [{ id: conversationId, customer_id: customerId }],
    whatsapp_messages: [{ id: 'message-1', conversation_id: conversationId, content: 'Текст' }],
    whatsapp_memories: [{ id: 'memory-1', conversation_id: conversationId, content: 'Заметка' }],
    customer_support_messages: [{ id: 'support-message-1', request_id: supportId }],
    referral_codes: [{ id: referralCodeId, customer_id: customerId }],
    referral_redemptions: [
      { id: 'referral-1', referral_code_id: referralCodeId, referred_customer_id: customerId },
    ],
    order_partial_refunds: [{ id: refundId, order_id: orderId }],
    order_partial_refund_items: [{ id: 'refund-item-1', refund_id: refundId }],
    order_review_items: [{ id: 'review-item-1', review_id: reviewId }],
    gift_cards: [{ id: 'gift-1', recipient_customer_id: customerId }],
  });

  const result = await exportCustomerData(customerId, {
    db,
    now: () => new Date('2026-07-26T12:00:00.000Z'),
  });

  assert.equal(result.formatVersion, 2);
  assert.equal(result.whatsappMessages[0].content, 'Текст');
  assert.equal(result.whatsappMemories[0].content, 'Заметка');
  assert.equal(result.refundItems[0].id, 'refund-item-1');
  assert.equal(result.giftCards[0].id, 'gift-1');
  for (const [key] of DIRECT_EXPORT_RELATIONS) {
    assert.ok(Array.isArray(result[key]), `missing exported relation ${key}`);
  }

  const request = fixture.inserts.find((entry) => entry.table === 'customer_privacy_requests');
  assert.equal(request.record.status, 'completed');
  assert.equal(request.record.export_payload, null);
  assert.equal(request.record.payload_purged_at, '2026-07-26T12:00:00.000Z');
  assert.ok(fixture.rpcCalls.some((call) => call.name === 'purge_expired_customer_exports'));
});

test('privacy deletion removes object storage and delegates database cleanup to one RPC', async () => {
  const customerId = '11111111-1111-4111-8111-111111111111';
  const { db, fixture } = createDb({
    customers: [{ id: customerId, phone: '+77010000000', deleted_at: null }],
    customer_support_requests: [
      {
        id: 'support-1',
        customer_id: customerId,
        attachments: [{ path: 'customer/request.jpg' }],
      },
    ],
    customer_support_messages: [
      {
        id: 'message-1',
        request_id: 'support-1',
        attachments: ['customer/reply.png'],
      },
    ],
    whatsapp_outbox: [
      {
        id: 'outbox-1',
        customer_id: customerId,
        payload: { storagePath: 'voice/customer.ogg' },
      },
    ],
  });

  assert.equal(await deleteCustomerData(customerId, { db }), true);
  assert.deepEqual(fixture.removals, [
    {
      bucket: 'support-attachments',
      paths: ['customer/request.jpg', 'customer/reply.png'],
    },
    { bucket: 'whatsapp-outbox', paths: ['voice/customer.ogg'] },
  ]);

  const deletion = fixture.rpcCalls.find(
    (call) => call.name === 'delete_customer_personal_data',
  );
  assert.equal(deletion.args.p_customer_id, customerId);
  assert.match(deletion.args.p_deleted_phone, /^deleted-[0-9a-f]{20}$/);
  assert.ok(deletion.args.p_request_id);
});

test('privacy migration covers WhatsApp, credentials, exports and order redaction', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '../supabase/migrations/20260726120000_privacy_lifecycle_hardening.sql',
    ),
    'utf8',
  );

  assert.match(migration, /whatsapp_conversations[\s\S]+customer_id uuid/);
  assert.match(migration, /delete from public\.customer_credentials/);
  assert.match(migration, /delete from public\.whatsapp_conversations/);
  assert.match(migration, /update public\.kaspi_orders[\s\S]+delivery_address/);
  assert.match(migration, /export_payload = null/);
  assert.match(migration, /delete_customer_personal_data/);
});

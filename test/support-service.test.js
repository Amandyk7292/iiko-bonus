const assert = require('node:assert/strict');
const test = require('node:test');

const configPath = require.resolve('../src/config/supabase');
const pushPath = require.resolve('../src/services/push.service');
const realtimePath = require.resolve('../src/services/realtime.service');
const servicePath = require.resolve('../src/services/support.service');

const currentRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  customer_id: '22222222-2222-4222-8222-222222222222',
  order_id: null,
  category: 'refund',
  message: 'Верните деньги',
  status: 'in_review',
  priority: 'high',
  resolution: null,
  assigned_to: 'admin',
  attachments: [],
  created_at: '2026-07-24T08:00:00.000Z',
  updated_at: '2026-07-26T00:40:00.000Z',
  last_message_at: '2026-07-26T00:40:00.000Z',
  due_at: '2026-07-24T10:00:00.000Z',
  customers: { name: 'Меруерт', phone: '+77478180616' },
  kaspi_orders: null,
};

function createSupabaseFixture(latestMessage, { updateSucceeds = true } = {}) {
  const calls = {
    messageReads: 0,
    messageInserts: 0,
    notifications: [],
    updates: [],
  };

  const supabase = {
    from(table) {
      let operation = 'read';
      let values = null;
      const query = {
        select() {
          return query;
        },
        update(nextValues) {
          operation = 'update';
          values = nextValues;
          calls.updates.push(nextValues);
          return query;
        },
        insert(nextValues) {
          operation = 'insert';
          values = nextValues;
          if (table === 'customer_support_messages') calls.messageInserts += 1;
          if (table === 'customer_notifications') calls.notifications.push(nextValues);
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          if (table === 'customer_support_requests') {
            if (operation === 'update') {
              return {
                data: updateSucceeds ? { ...currentRequest, ...values } : null,
                error: null,
              };
            }
            return { data: currentRequest, error: null };
          }
          if (table === 'customer_support_messages') {
            calls.messageReads += 1;
            return { data: latestMessage, error: null };
          }
          if (table === 'customer_notifications') {
            return { data: { id: 'notification-1' }, error: null };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      };
      return query;
    },
  };

  return { calls, supabase };
}

async function withSupportService(supabase, callback) {
  const paths = [configPath, pushPath, realtimePath, servicePath];
  const previous = new Map(paths.map((modulePath) => [modulePath, require.cache[modulePath]]));
  const pushes = [];
  const events = [];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase },
  };
  require.cache[pushPath] = {
    id: pushPath,
    filename: pushPath,
    loaded: true,
    exports: {
      sendPushToCustomer: async (...args) => {
        pushes.push(args);
      },
    },
  };
  require.cache[realtimePath] = {
    id: realtimePath,
    filename: realtimePath,
    loaded: true,
    exports: {
      publish: (...args) => events.push(args),
    },
  };
  delete require.cache[servicePath];

  try {
    return await callback(require(servicePath), { events, pushes });
  } finally {
    for (const [modulePath, cached] of previous) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
}

test('closing a support request reuses the saved admin reply without another message', async () => {
  const { calls, supabase } = createSupabaseFixture({
    id: 'message-1',
    sender_type: 'admin',
    body: 'Возврат оформлен',
    is_internal: false,
    created_at: currentRequest.last_message_at,
  });

  await withSupportService(supabase, async ({ updateSupportRequest }) => {
    const result = await updateSupportRequest(currentRequest.id, { status: 'resolved' }, 'admin');
    assert.equal(result.status, 'resolved');
    assert.equal(result.resolution, 'Возврат оформлен');
  });

  assert.equal(calls.messageReads, 1);
  assert.equal(calls.messageInserts, 0);
  assert.equal(calls.updates[0].resolution, 'Возврат оформлен');
  assert.equal(calls.notifications.length, 1);
});

test('closing is rejected when the customer wrote the latest public message', async () => {
  const { calls, supabase } = createSupabaseFixture({
    id: 'message-2',
    sender_type: 'customer',
    body: 'Когда поступят деньги?',
    is_internal: false,
    created_at: currentRequest.last_message_at,
  });

  await withSupportService(supabase, async ({ updateSupportRequest }) => {
    await assert.rejects(
      updateSupportRequest(currentRequest.id, { status: 'resolved' }, 'admin'),
      (error) =>
        error.statusCode === 400 &&
        /Ответьте на последнее сообщение клиента/.test(error.message),
    );
  });

  assert.equal(calls.updates.length, 0);
});

test('closing fails safely if the conversation changes during the update', async () => {
  const { supabase } = createSupabaseFixture(
    {
      id: 'message-3',
      sender_type: 'admin',
      body: 'Вопрос решён',
      is_internal: false,
      created_at: currentRequest.last_message_at,
    },
    { updateSucceeds: false },
  );

  await withSupportService(supabase, async ({ updateSupportRequest }) => {
    await assert.rejects(
      updateSupportRequest(currentRequest.id, { status: 'resolved' }, 'admin'),
      (error) => error.statusCode === 409 && /Обращение изменилось/.test(error.message),
    );
  });
});

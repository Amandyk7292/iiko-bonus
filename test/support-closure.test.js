const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  cleanSupportResolution,
  determineSupportClosure,
} = require('../src/utils/support.util');

test('support closure reuses the latest public admin response without duplicating it', () => {
  assert.deepEqual(
    determineSupportClosure(
      {
        sender_type: 'admin',
        body: '  Деньги вернули  ',
        is_internal: false,
      },
      '',
    ),
    {
      resolution: 'Деньги вернули',
      addMessage: false,
    },
  );
});

test('support closure requires a new reply after the customer writes again', () => {
  assert.equal(
    determineSupportClosure(
      {
        sender_type: 'customer',
        body: 'У меня остался вопрос',
        is_internal: false,
      },
      '',
    ),
    null,
  );
  assert.deepEqual(
    determineSupportClosure(
      {
        sender_type: 'customer',
        body: 'У меня остался вопрос',
        is_internal: false,
      },
      '  Новый ответ  ',
    ),
    {
      resolution: 'Новый ответ',
      addMessage: true,
    },
  );
});

test('internal notes cannot satisfy support closure and resolutions stay bounded', () => {
  assert.equal(
    determineSupportClosure(
      {
        sender_type: 'admin',
        body: 'Служебная заметка',
        is_internal: true,
      },
      '',
    ),
    null,
  );
  assert.equal(cleanSupportResolution(`  ${'x'.repeat(2100)}  `).length, 2000);
});

test('support consistency migration clears stale resolution when a customer reopens a ticket', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260726010000_support_closure_consistency.sql',
    ),
    'utf8',
  );
  assert.match(migration, /new\.sender_type = 'customer'.*status in \('resolved', 'rejected'\)/s);
  assert.match(migration, /then null\s+else resolution/s);
});

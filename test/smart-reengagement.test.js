const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { renderAutomationCopy } = require('../src/services/commerce-marketing.service');

test('smart reengagement uses the customer language and ordered product', () => {
  const automation = {
    title_translations: {
      ru: 'Давно не заглядывали?',
      kk: 'Көптен бері көрінбедіңіз',
      en: 'It has been a while',
    },
    body_translations: {
      ru: '{{productName}} снова ждёт вас.',
      kk: '{{productName}} сізді қайта күтіп тұр.',
      en: '{{productName}} is waiting for you again.',
    },
  };
  const payload = {
    quantity: 3,
    productName: 'Плюшка',
    productNames: { ru: 'Плюшка', kk: 'Тоқаш', en: 'Sweet bun' },
  };
  assert.equal(renderAutomationCopy(automation, payload, 'ru').body, 'Плюшка снова ждёт вас.');
  assert.equal(
    renderAutomationCopy(automation, payload, 'kk').body,
    'Тоқаш сізді қайта күтіп тұр.',
  );
  assert.equal(
    renderAutomationCopy(automation, payload, 'en').body,
    'Sweet bun is waiting for you again.',
  );
  assert.equal(renderAutomationCopy(automation, payload, 'kz').language, 'kk');
});

test('daily smart reminder migration enforces 48 hours and a 24 hour cap', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20260921160000_daily_smart_reengagement.sql'),
    'utf8',
  );
  assert.match(migration, /default 48/i);
  assert.match(
    migration,
    /latest_order\.created_at <= now\(\) - make_interval\(hours => p_inactive_hours\)/i,
  );
  assert.match(migration, /now\(\) - interval '24 hours'/i);
  assert.match(migration, /preferred_language|title_translations|body_translations/i);
  const copyMigration = fs.readFileSync(
    path.join(
      __dirname,
      '../supabase/migrations/20260921170000_smart_reengagement_copy_without_quantity.sql',
    ),
    'utf8',
  );
  assert.doesNotMatch(copyMigration, /\{\{quantity\}\}/i);
});

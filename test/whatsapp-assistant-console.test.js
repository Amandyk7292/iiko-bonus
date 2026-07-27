const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  AI_PROVIDER_DEFINITIONS,
  decryptApiKey,
  encryptApiKey,
  normalizeAiModel,
  normalizeKnowledge,
  normalizeMemory,
  normalizeSettings,
  redactContextText,
  selectKnowledgeForQuery,
} = require('../src/services/whatsapp-assistant-console.service');

const root = path.resolve(__dirname, '..');

test('WhatsApp assistant settings accept only bounded, typed configuration', () => {
  const normalized = normalizeSettings({
    assistantEnabled: false,
    autoReplyEnabled: true,
    memoryEnabled: false,
    provider: 'qwen',
    model: 'qwen-flash',
    botName: '  Помощник Bulka  ',
    tone: 'warm',
    supportedLanguages: ['ru', 'kk', 'ru'],
    historyMessages: 18,
    businessDescription: 'Пекарня\u0000 в Астане',
    welcomeMessage: 'Здравствуйте!',
    fallbackMessage: 'Подключаем оператора.',
  });

  assert.equal(normalized.assistant_enabled, false);
  assert.equal(normalized.memory_enabled, false);
  assert.equal(normalized.ai_provider, 'qwen');
  assert.equal(normalized.ai_model, 'qwen-flash');
  assert.equal(normalized.bot_name, 'Помощник Bulka');
  assert.deepEqual(normalized.supported_languages, ['ru', 'kk']);
  assert.equal(normalized.history_messages, 18);
  assert.equal(normalized.business_description, 'Пекарня в Астане');
  assert.throws(
    () => normalizeSettings({ assistantEnabled: 'false' }),
    /assistantEnabled must be a boolean/,
  );
  assert.throws(() => normalizeSettings({ historyMessages: 31 }), /historyMessages/);
  assert.throws(() => normalizeSettings({ supportedLanguages: ['ru', 'de'] }), /ru, kk or en/);
  assert.throws(() => normalizeSettings({ provider: 'unknown' }), /provider/i);
  assert.throws(
    () => normalizeSettings({ provider: 'deepseek', model: 'gemini-3.1-flash-lite' }),
    /DeepSeek model/i,
  );
});

test('AI provider API keys are encrypted and authenticated at rest', () => {
  const env = { AI_PROVIDER_KEY_ENCRYPTION_SECRET: 'e'.repeat(48) };
  const plaintext = 'sk-provider-secret-that-must-not-leak';
  const encrypted = encryptApiKey(plaintext, env);
  assert.match(encrypted, /^v1\./);
  assert.doesNotMatch(encrypted, /provider-secret/);
  assert.equal(decryptApiKey(encrypted, env), plaintext);
  assert.throws(
    () => decryptApiKey(encrypted, { AI_PROVIDER_KEY_ENCRYPTION_SECRET: 'x'.repeat(48) }),
    /cannot be decrypted/i,
  );
  assert.equal(AI_PROVIDER_DEFINITIONS.deepseek.defaultModel, 'deepseek-v4-flash');
  assert.equal(normalizeAiModel('qwen3.6-flash', 'qwen'), 'qwen3.6-flash');
});

test('Knowledge and customer memory inputs are normalized and bounded', () => {
  assert.deepEqual(
    normalizeKnowledge({
      title: ' Доставка ',
      category: ' SERVICE ',
      content: ' Доставляем по Астане ',
      isActive: false,
    }),
    {
      title: 'Доставка',
      category: 'service',
      content: 'Доставляем по Астане',
      is_active: false,
    },
  );

  const memory = normalizeMemory({
    label: 'Предпочтение',
    content: 'Любит миндальный круассан',
    sourceType: 'message',
    sourceMessageId: '1f1f1f1f-1111-4111-8111-111111111111',
  });
  assert.equal(memory.source_type, 'message');
  assert.equal(memory.source_message_id, '1f1f1f1f-1111-4111-8111-111111111111');
  assert.throws(
    () => normalizeMemory({ content: 'Заметка', sourceMessageId: 'not-an-id' }),
    /UUID/,
  );
  assert.throws(() => normalizeKnowledge({ title: '', content: 'Текст' }), /title is required/i);
});

test('Persisted context removes common customer secrets before Gemini sees it', () => {
  const result = redactContextText(
    'Телефон +7 700 123 45 67, email guest@example.com, код 123456, карта 4111 1111 1111 1111, любим багет.',
  );
  assert.doesNotMatch(result, /700 123/);
  assert.doesNotMatch(result, /guest@example\.com/);
  assert.doesNotMatch(result, /123456/);
  assert.doesNotMatch(result, /4111/);
  assert.match(result, /любим багет/);
});

test('Knowledge retrieval prioritizes relevant owner documents', () => {
  const documents = [
    { id: '1', title: 'Аллергены', category: 'menu', content: 'Орехи и молоко' },
    { id: '2', title: 'Доставка', category: 'service', content: 'Условия доставки по Астане' },
    { id: '3', title: 'Парковка', category: 'locations', content: 'Парковка рядом' },
  ];
  const selected = selectKnowledgeForQuery(documents, 'Какие условия доставки?', 2);
  assert.equal(selected[0].id, '2');
  assert.equal(selected.length, 2);
});

test('Knowledge retrieval finds the exact confirmed Astana price document', () => {
  const documents = [
    {
      id: 'bread',
      title: 'Прайс Астана 05.07.2026 — Хлеб',
      category: 'astana_price',
      content: 'Хлеб Тартин — 690 ₸\nБагет Бородино — 430 ₸',
    },
    {
      id: 'pastry',
      title: 'Прайс Астана 05.07.2026 — Слойка',
      category: 'astana_price',
      content: 'Круассан с сыром — 450 ₸\nСлойка с вишней — 450 ₸',
    },
  ];
  const selected = selectKnowledgeForQuery(documents, 'Сколько стоит круассан с сыром?', 1);
  assert.equal(selected[0].id, 'pastry');
});

test('canonical WhatsApp console migration keeps tables service-only', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20260722093000_whatsapp_assistant_console.sql'),
    'utf8',
  );
  for (const table of [
    'whatsapp_assistant_settings',
    'whatsapp_conversations',
    'whatsapp_messages',
    'whatsapp_knowledge_documents',
    'whatsapp_memories',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`on public\\.${table} for all to service_role`));
  }
  assert.match(
    migration,
    /revoke all on function public\.sync_whatsapp_conversation_from_message\(\)/,
  );
});

test('canonical AI provider migration keeps encrypted credentials service-only', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20260722120000_whatsapp_ai_providers.sql'),
    'utf8',
  );
  assert.match(migration, /add column if not exists ai_provider/i);
  assert.match(migration, /add column if not exists ai_model/i);
  assert.match(migration, /create table if not exists public\.whatsapp_ai_provider_credentials/i);
  assert.match(migration, /encrypted_api_key text not null/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /for all to service_role/i);
  assert.doesNotMatch(migration, /\n\s+api_key\s+text/i);
});

test('Admin UI exposes the WhatsApp workspace without typography dash characters', () => {
  const page = fs.readFileSync(
    path.join(root, 'admin-ui', 'src', 'pages', 'WhatsAppPage.tsx'),
    'utf8',
  );
  const app = fs.readFileSync(path.join(root, 'admin-ui', 'src', 'App.tsx'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'src', 'routes', 'admin.routes.js'), 'utf8');

  assert.match(app, /path="\/whatsapp"/);
  assert.match(page, /Диалоги/);
  assert.match(page, /База знаний/);
  assert.match(page, /Настройки ИИ/);
  assert.match(page, /ИИ-провайдер и модель/);
  assert.match(page, /Новый API-ключ/);
  assert.doesNotMatch(page, /[—–]/u);
  assert.match(routes, /\/admin\/api\/whatsapp\/conversations/);
  assert.match(routes, /\/admin\/api\/whatsapp\/knowledge/);
  assert.match(routes, /connection\.qrDataUrl = ''/);
});

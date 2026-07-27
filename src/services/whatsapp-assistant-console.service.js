const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const realtime = require('./realtime.service');

const SETTINGS_ID = 'default';
const SETTINGS_CACHE_MS = 30_000;
const KNOWLEDGE_CACHE_MS = 30_000;
const ALLOWED_LANGUAGES = new Set(['ru', 'kk', 'en']);
const ALLOWED_TONES = new Set(['friendly', 'warm', 'concise', 'formal']);
const ALLOWED_AI_PROVIDERS = new Set(['gemini', 'qwen', 'deepseek']);
const AI_PROVIDER_DEFINITIONS = Object.freeze({
  gemini: Object.freeze({
    label: 'Gemini',
    defaultModel: 'gemini-3.1-flash-lite',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    environmentKey: 'GEMINI_API_KEY',
  }),
  qwen: Object.freeze({
    label: 'Qwen',
    defaultModel: 'qwen-flash',
    endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    environmentKey: 'QWEN_API_KEY',
  }),
  deepseek: Object.freeze({
    label: 'DeepSeek',
    defaultModel: 'deepseek-v4-flash',
    endpoint: 'https://api.deepseek.com/chat/completions',
    environmentKey: 'DEEPSEEK_API_KEY',
  }),
});
const ALLOWED_CONVERSATION_STATUSES = new Set(['open', 'closed', 'spam']);
const ALLOWED_SENDER_TYPES = new Set(['customer', 'assistant', 'operator', 'system']);
const ALLOWED_DELIVERY_STATUSES = new Set([
  'received',
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
]);

const DEFAULT_SETTINGS = Object.freeze({
  assistantEnabled: true,
  autoReplyEnabled: true,
  memoryEnabled: true,
  provider: 'gemini',
  model: AI_PROVIDER_DEFINITIONS.gemini.defaultModel,
  keyConfigured: false,
  providerKeys: Object.freeze({ gemini: false, qwen: false, deepseek: false }),
  botName: 'Ассистент Bulka',
  tone: 'friendly',
  supportedLanguages: ['ru', 'kk', 'en'],
  historyMessages: 12,
  businessDescription: '',
  customInstructions: '',
  welcomeMessage: 'Здравствуйте! Я ассистент Bulka. Чем помочь?',
  fallbackMessage: 'Сейчас не получается ответить. Оператор Bulka подключится к диалогу.',
  storageReady: true,
  updatedAt: null,
});

let settingsCache = null;
let settingsCacheExpiresAt = 0;
let knowledgeCache = null;
let knowledgeCacheExpiresAt = 0;
let missingSchemaWarningShown = false;

function assistantConsoleError(
  message,
  statusCode = 400,
  code = 'WHATSAPP_ASSISTANT_VALIDATION_ERROR',
) {
  return Object.assign(new Error(message), { statusCode, code });
}

function isMissingAssistantSchema(error) {
  return ['42P01', 'PGRST205'].includes(String(error?.code || ''));
}

function schemaUnavailable(error) {
  if (!isMissingAssistantSchema(error)) return error;
  return assistantConsoleError(
    'WhatsApp assistant console migration is not installed',
    503,
    'WHATSAPP_ASSISTANT_SCHEMA_MISSING',
  );
}

function warnMissingSchemaOnce() {
  if (missingSchemaWarningShown) return;
  missingSchemaWarningShown = true;
  console.warn('[WHATSAPP] Хранилище переписок ещё не установлено. Бот продолжит работу без него.');
}

function cleanText(value, maxLength, { required = false, field = 'Value' } = {}) {
  const result = String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (required && !result) throw assistantConsoleError(`${field} is required`);
  if (result.length > maxLength) {
    throw assistantConsoleError(`${field} must be at most ${maxLength} characters`);
  }
  return result;
}

function boundedInteger(value, fallback, minimum, maximum, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    if (value === undefined) return fallback;
    throw assistantConsoleError(`${field} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function strictBoolean(value, fallback, field) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw assistantConsoleError(`${field} must be a boolean`);
  return value;
}

function normalizeAiProvider(value) {
  const provider = String(value || '')
    .trim()
    .toLowerCase();
  if (!ALLOWED_AI_PROVIDERS.has(provider)) {
    throw assistantConsoleError('Unknown AI provider');
  }
  return provider;
}

function normalizeAiModel(value, provider) {
  const model = String(value || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(model)) {
    throw assistantConsoleError('AI model contains invalid characters');
  }
  if (provider === 'gemini' && !model.startsWith('gemini-')) {
    throw assistantConsoleError('Gemini model must start with gemini-');
  }
  if (provider === 'qwen' && !model.toLowerCase().startsWith('qwen')) {
    throw assistantConsoleError('Qwen model must start with qwen');
  }
  if (provider === 'deepseek' && !model.toLowerCase().startsWith('deepseek-')) {
    throw assistantConsoleError('DeepSeek model must start with deepseek-');
  }
  return model;
}

function normalizeApiKey(value) {
  const apiKey = String(value || '').trim();
  if (apiKey.length < 16 || apiKey.length > 512 || /\s|\p{Cc}/u.test(apiKey)) {
    throw assistantConsoleError('API key must contain 16 to 512 characters without spaces');
  }
  return apiKey;
}

function credentialEncryptionKey(env = process.env) {
  const secret = String(env.AI_PROVIDER_KEY_ENCRYPTION_SECRET || env.BULKA_SECRET || '').trim();
  if (secret.length < 32) {
    throw assistantConsoleError(
      'AI provider credential encryption is not configured',
      503,
      'AI_CREDENTIAL_ENCRYPTION_UNAVAILABLE',
    );
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encryptApiKey(value, env = process.env) {
  const apiKey = normalizeApiKey(value);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialEncryptionKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptApiKey(value, env = process.env) {
  try {
    const [version, ivValue, tagValue, ciphertextValue, extra] = String(value || '').split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue || extra) {
      throw new Error('Invalid credential envelope');
    }
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      credentialEncryptionKey(env),
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error?.code === 'AI_CREDENTIAL_ENCRYPTION_UNAVAILABLE') throw error;
    throw assistantConsoleError(
      'Saved AI provider credential cannot be decrypted',
      503,
      'AI_CREDENTIAL_DECRYPTION_FAILED',
    );
  }
}

function environmentProviderKeys(env = process.env) {
  return Object.fromEntries(
    Object.entries(AI_PROVIDER_DEFINITIONS).map(([provider, definition]) => [
      provider,
      Boolean(String(env[definition.environmentKey] || '').trim()),
    ]),
  );
}

function optionalUuid(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const result = String(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw assistantConsoleError(`${field} must be a UUID`);
  }
  return result;
}

function normalizeSettings(input = {}, current = DEFAULT_SETTINGS) {
  const tone = String(input.tone ?? current.tone ?? DEFAULT_SETTINGS.tone);
  if (!ALLOWED_TONES.has(tone)) throw assistantConsoleError('Unknown assistant tone');

  const provider = normalizeAiProvider(
    input.provider ?? current.provider ?? DEFAULT_SETTINGS.provider,
  );
  const currentProvider = String(current.provider || DEFAULT_SETTINGS.provider);
  const requestedModel =
    input.model ??
    (provider === currentProvider
      ? current.model
      : AI_PROVIDER_DEFINITIONS[provider].defaultModel) ??
    AI_PROVIDER_DEFINITIONS[provider].defaultModel;
  const model = normalizeAiModel(requestedModel, provider);

  const requestedLanguages = input.supportedLanguages ?? current.supportedLanguages;
  if (!Array.isArray(requestedLanguages)) {
    throw assistantConsoleError('supportedLanguages must be an array');
  }
  const supportedLanguages = [...new Set(requestedLanguages.map(String))];
  if (
    supportedLanguages.length < 1 ||
    supportedLanguages.length > 3 ||
    supportedLanguages.some((language) => !ALLOWED_LANGUAGES.has(language))
  ) {
    throw assistantConsoleError('supportedLanguages must contain ru, kk or en');
  }

  return {
    assistant_enabled: strictBoolean(
      input.assistantEnabled,
      current.assistantEnabled ?? true,
      'assistantEnabled',
    ),
    auto_reply_enabled: strictBoolean(
      input.autoReplyEnabled,
      current.autoReplyEnabled ?? true,
      'autoReplyEnabled',
    ),
    memory_enabled: strictBoolean(
      input.memoryEnabled,
      current.memoryEnabled ?? true,
      'memoryEnabled',
    ),
    ai_provider: provider,
    ai_model: model,
    bot_name: cleanText(input.botName ?? current.botName, 80, {
      required: true,
      field: 'Bot name',
    }),
    tone,
    supported_languages: supportedLanguages,
    history_messages: boundedInteger(
      input.historyMessages ?? current.historyMessages,
      DEFAULT_SETTINGS.historyMessages,
      0,
      30,
      'historyMessages',
    ),
    business_description: cleanText(
      input.businessDescription ?? current.businessDescription,
      4000,
      { field: 'Business description' },
    ),
    custom_instructions: cleanText(input.customInstructions ?? current.customInstructions, 6000, {
      field: 'Custom instructions',
    }),
    welcome_message: cleanText(input.welcomeMessage ?? current.welcomeMessage, 500, {
      required: true,
      field: 'Welcome message',
    }),
    fallback_message: cleanText(input.fallbackMessage ?? current.fallbackMessage, 500, {
      required: true,
      field: 'Fallback message',
    }),
  };
}

function settingsFromRow(row, storageReady = true, providerKeys = {}) {
  const normalizedProviderKeys = {
    gemini: Boolean(providerKeys.gemini),
    qwen: Boolean(providerKeys.qwen),
    deepseek: Boolean(providerKeys.deepseek),
  };
  if (!row) {
    return {
      ...DEFAULT_SETTINGS,
      providerKeys: normalizedProviderKeys,
      keyConfigured: normalizedProviderKeys[DEFAULT_SETTINGS.provider],
      storageReady,
    };
  }
  const provider = ALLOWED_AI_PROVIDERS.has(String(row.ai_provider))
    ? String(row.ai_provider)
    : DEFAULT_SETTINGS.provider;
  const model = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(String(row.ai_model || ''))
    ? String(row.ai_model)
    : AI_PROVIDER_DEFINITIONS[provider].defaultModel;
  return {
    assistantEnabled: row.assistant_enabled !== false,
    autoReplyEnabled: row.auto_reply_enabled !== false,
    memoryEnabled: row.memory_enabled !== false,
    provider,
    model,
    keyConfigured: normalizedProviderKeys[provider],
    providerKeys: normalizedProviderKeys,
    botName: row.bot_name || DEFAULT_SETTINGS.botName,
    tone: row.tone || DEFAULT_SETTINGS.tone,
    supportedLanguages: Array.isArray(row.supported_languages)
      ? row.supported_languages
      : [...DEFAULT_SETTINGS.supportedLanguages],
    historyMessages: Number(row.history_messages ?? DEFAULT_SETTINGS.historyMessages),
    businessDescription: row.business_description || '',
    customInstructions: row.custom_instructions || '',
    welcomeMessage: row.welcome_message || DEFAULT_SETTINGS.welcomeMessage,
    fallbackMessage: row.fallback_message || DEFAULT_SETTINGS.fallbackMessage,
    storageReady,
    updatedAt: row.updated_at || null,
  };
}

function conversationFromRow(row) {
  return {
    id: String(row.id),
    chatJid: row.chat_jid,
    phone: row.phone || '',
    displayName: row.display_name || '',
    status: row.status || 'open',
    assistantEnabled: row.assistant_enabled !== false,
    contextResetAt: row.context_reset_at || null,
    unreadCount: Number(row.unread_count || 0),
    lastMessagePreview: row.last_message_preview || '',
    lastMessageAt: row.last_message_at || null,
    lastCustomerMessageAt: row.last_customer_message_at || null,
    lastOperatorMessageAt: row.last_operator_message_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageFromRow(row) {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    outboxId: row.outbox_id ? String(row.outbox_id) : null,
    whatsappMessageId: row.wa_message_id || null,
    direction: row.direction,
    senderType: row.sender_type,
    content: row.content,
    deliveryStatus: row.delivery_status,
    createdAt: row.created_at,
  };
}

function knowledgeFromRow(row) {
  return {
    id: String(row.id),
    title: row.title,
    category: row.category,
    content: row.content,
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function memoryFromRow(row) {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    label: row.label,
    content: row.content,
    sourceType: row.source_type,
    sourceMessageId: row.source_message_id || null,
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeKnowledge(input = {}, current = {}) {
  return {
    title: cleanText(input.title ?? current.title, 160, {
      required: true,
      field: 'Knowledge title',
    }),
    category: cleanText(input.category ?? current.category ?? 'general', 60, {
      required: true,
      field: 'Knowledge category',
    }).toLowerCase(),
    content: cleanText(input.content ?? current.content, 12_000, {
      required: true,
      field: 'Knowledge content',
    }),
    is_active: strictBoolean(input.isActive, current.isActive ?? true, 'isActive'),
  };
}

function normalizeMemory(input = {}) {
  const sourceType = ['manual', 'message', 'assistant'].includes(String(input.sourceType))
    ? String(input.sourceType)
    : 'manual';
  return {
    label: cleanText(input.label || 'Заметка', 120, {
      required: true,
      field: 'Memory label',
    }),
    content: cleanText(input.content, 2000, {
      required: true,
      field: 'Memory content',
    }),
    source_type: sourceType,
    source_message_id: optionalUuid(input.sourceMessageId, 'sourceMessageId'),
    is_active: strictBoolean(input.isActive, true, 'isActive'),
  };
}

function redactContextText(value, maxLength = 2500) {
  return String(value || '')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[номер карты скрыт]')
    .replace(/(?:\+?7|8)[\s().-]*(?:\d[\s().-]*){10}\b/g, '[телефон скрыт]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, '[email скрыт]')
    .replace(/(?<![\p{L}\p{N}])(код|otp|пароль|pin|пин)\s*[:№#-]?\s*\d{4,8}(?!\d)/giu, '$1 [скрыт]')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function searchTokens(value) {
  return [
    ...new Set(
      String(value || '')
        .toLowerCase()
        .match(/[a-zа-яёәіңғүұқөһ0-9]{3,}/giu) || [],
    ),
  ].slice(0, 20);
}

function selectKnowledgeForQuery(documents, queryText, limit = 10) {
  const tokens = searchTokens(queryText);
  return [...documents]
    .map((document) => {
      const title = String(document.title || '').toLowerCase();
      const category = String(document.category || '').toLowerCase();
      const content = String(document.content || '').toLowerCase();
      const score = tokens.reduce(
        (total, token) =>
          total +
          (title.includes(token) ? 8 : 0) +
          (category.includes(token) ? 4 : 0) +
          (content.includes(token) ? 1 : 0),
        0,
      );
      return { document, score };
    })
    .sort((first, second) => second.score - first.score)
    .filter((item, index) => item.score > 0 || tokens.length === 0 || index < 4)
    .slice(0, limit)
    .map((item) => item.document);
}

function clearAssistantConsoleCache() {
  settingsCache = null;
  settingsCacheExpiresAt = 0;
  knowledgeCache = null;
  knowledgeCacheExpiresAt = 0;
}

async function getProviderKeyStatus({ db = supabase, env = process.env } = {}) {
  const keys = environmentProviderKeys(env);
  const { data, error } = await db.from('whatsapp_ai_provider_credentials').select('provider');
  if (error) {
    if (isMissingAssistantSchema(error)) return { keys, storageReady: false };
    throw schemaUnavailable(error);
  }
  for (const row of data || []) {
    if (ALLOWED_AI_PROVIDERS.has(String(row.provider))) keys[row.provider] = true;
  }
  return { keys, storageReady: true };
}

async function readProviderCredential(provider, { db = supabase, env = process.env } = {}) {
  const normalizedProvider = normalizeAiProvider(provider);
  const { data, error } = await db
    .from('whatsapp_ai_provider_credentials')
    .select('encrypted_api_key')
    .eq('provider', normalizedProvider)
    .maybeSingle();
  if (error) {
    if (!isMissingAssistantSchema(error)) throw schemaUnavailable(error);
  } else if (data?.encrypted_api_key) {
    return decryptApiKey(data.encrypted_api_key, env);
  }
  const environmentKey = AI_PROVIDER_DEFINITIONS[normalizedProvider].environmentKey;
  return String(env[environmentKey] || '').trim();
}

async function saveProviderCredential(
  provider,
  apiKey,
  { db = supabase, env = process.env, updatedBy = '' } = {},
) {
  const normalizedProvider = normalizeAiProvider(provider);
  const encryptedApiKey = encryptApiKey(apiKey, env);
  const { error } = await db.from('whatsapp_ai_provider_credentials').upsert(
    {
      provider: normalizedProvider,
      encrypted_api_key: encryptedApiKey,
      updated_by: cleanText(updatedBy, 120),
    },
    { onConflict: 'provider' },
  );
  if (error) throw schemaUnavailable(error);
  clearAssistantConsoleCache();
}

async function getAssistantSettings({
  db = supabase,
  env = process.env,
  allowFallback = false,
  useCache = true,
} = {}) {
  const canCache = db === supabase && useCache;
  if (canCache && settingsCache && Date.now() < settingsCacheExpiresAt) return settingsCache;
  const { data, error } = await db
    .from('whatsapp_assistant_settings')
    .select('*')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) {
    if (allowFallback && isMissingAssistantSchema(error)) {
      warnMissingSchemaOnce();
      return settingsFromRow(null, false, environmentProviderKeys(env));
    }
    throw schemaUnavailable(error);
  }
  const providerStatus = await getProviderKeyStatus({ db, env });
  const result = settingsFromRow(data, providerStatus.storageReady, providerStatus.keys);
  if (canCache) {
    settingsCache = result;
    settingsCacheExpiresAt = Date.now() + SETTINGS_CACHE_MS;
  }
  return result;
}

async function updateAssistantSettings(
  input,
  { db = supabase, env = process.env, updatedBy = '' } = {},
) {
  const current = await getAssistantSettings({ db, env, useCache: false });
  const record = normalizeSettings(input, current);
  const newApiKey =
    input.apiKey === undefined || input.apiKey === '' ? '' : normalizeApiKey(input.apiKey);
  const provider = record.ai_provider;
  if (record.assistant_enabled && !newApiKey && !current.providerKeys?.[provider]) {
    throw assistantConsoleError('Укажите API-ключ выбранного ИИ-провайдера');
  }
  if (newApiKey) {
    await saveProviderCredential(provider, newApiKey, { db, env, updatedBy });
  }
  const { error } = await db
    .from('whatsapp_assistant_settings')
    .upsert(
      {
        id: SETTINGS_ID,
        ...record,
        updated_by: cleanText(updatedBy, 120),
      },
      { onConflict: 'id' },
    )
    .select('*')
    .single();
  if (error) throw schemaUnavailable(error);
  clearAssistantConsoleCache();
  const settings = await getAssistantSettings({ db, env, useCache: false });
  realtime.publish(
    'whatsapp.settings.updated',
    { provider: settings.provider, model: settings.model, updatedAt: settings.updatedAt },
    { adminOnly: true, roles: ['owner', 'admin'] },
  );
  return settings;
}

async function getAssistantProviderConfiguration({ db = supabase, env = process.env } = {}) {
  const settings = await getAssistantSettings({ db, env, allowFallback: true });
  const provider = normalizeAiProvider(settings.provider);
  const apiKey = await readProviderCredential(provider, { db, env });
  return {
    enabled: settings.assistantEnabled,
    provider,
    model: normalizeAiModel(settings.model, provider),
    apiKey,
    endpoint: AI_PROVIDER_DEFINITIONS[provider].endpoint,
  };
}

async function listKnowledgeDocuments({
  db = supabase,
  activeOnly = false,
  useCache = false,
} = {}) {
  const canCache = db === supabase && activeOnly && useCache;
  if (canCache && knowledgeCache && Date.now() < knowledgeCacheExpiresAt) return knowledgeCache;
  let query = db
    .from('whatsapp_knowledge_documents')
    .select('*')
    .order('updated_at', { ascending: false });
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw schemaUnavailable(error);
  const result = (data || []).map(knowledgeFromRow);
  if (canCache) {
    knowledgeCache = result;
    knowledgeCacheExpiresAt = Date.now() + KNOWLEDGE_CACHE_MS;
  }
  return result;
}

async function readKnowledgeDocument(id, { db = supabase } = {}) {
  const { data, error } = await db
    .from('whatsapp_knowledge_documents')
    .select('*')
    .eq('id', String(id || ''))
    .maybeSingle();
  if (error) throw schemaUnavailable(error);
  if (!data)
    throw assistantConsoleError('Knowledge document not found', 404, 'KNOWLEDGE_NOT_FOUND');
  return data;
}

async function createKnowledgeDocument(input, { db = supabase, createdBy = '' } = {}) {
  const record = normalizeKnowledge(input);
  const { data, error } = await db
    .from('whatsapp_knowledge_documents')
    .insert({
      ...record,
      created_by: cleanText(createdBy, 120),
      updated_by: cleanText(createdBy, 120),
    })
    .select('*')
    .single();
  if (error) throw schemaUnavailable(error);
  clearAssistantConsoleCache();
  return knowledgeFromRow(data);
}

async function updateKnowledgeDocument(id, input, { db = supabase, updatedBy = '' } = {}) {
  const currentRow = await readKnowledgeDocument(id, { db });
  const current = knowledgeFromRow(currentRow);
  const record = normalizeKnowledge(input, current);
  const { data, error } = await db
    .from('whatsapp_knowledge_documents')
    .update({ ...record, updated_by: cleanText(updatedBy, 120) })
    .eq('id', current.id)
    .select('*')
    .single();
  if (error) throw schemaUnavailable(error);
  clearAssistantConsoleCache();
  return knowledgeFromRow(data);
}

async function deleteKnowledgeDocument(id, { db = supabase } = {}) {
  const current = await readKnowledgeDocument(id, { db });
  const { error } = await db.from('whatsapp_knowledge_documents').delete().eq('id', current.id);
  if (error) throw schemaUnavailable(error);
  clearAssistantConsoleCache();
}

async function findConversationByJid(chatJid, { db = supabase } = {}) {
  const normalizedJid = cleanText(chatJid, 255, { required: true, field: 'Chat JID' });
  const { data, error } = await db
    .from('whatsapp_conversations')
    .select('*')
    .eq('chat_jid', normalizedJid)
    .maybeSingle();
  if (error) throw schemaUnavailable(error);
  return data ? conversationFromRow(data) : null;
}

async function readConversation(id, { db = supabase } = {}) {
  const { data, error } = await db
    .from('whatsapp_conversations')
    .select('*')
    .eq('id', String(id || ''))
    .maybeSingle();
  if (error) throw schemaUnavailable(error);
  if (!data) throw assistantConsoleError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
  return conversationFromRow(data);
}

async function ensureConversation(
  { chatJid, phone = '', displayName = '' },
  { db = supabase } = {},
) {
  const record = {
    chat_jid: cleanText(chatJid, 255, { required: true, field: 'Chat JID' }),
  };
  const cleanPhone = cleanText(phone, 32);
  const cleanName = cleanText(displayName, 160);
  if (cleanPhone) record.phone = cleanPhone;
  if (cleanName) record.display_name = cleanName;
  const { data, error } = await db
    .from('whatsapp_conversations')
    .upsert(record, { onConflict: 'chat_jid' })
    .select('*')
    .single();
  if (error) throw schemaUnavailable(error);
  return conversationFromRow(data);
}

async function recordConversationMessage(
  {
    chatJid,
    phone = '',
    displayName = '',
    outboxId = null,
    whatsappMessageId = null,
    direction,
    senderType,
    content,
    deliveryStatus,
    metadata = {},
  },
  { db = supabase, bestEffort = false } = {},
) {
  try {
    if (!['inbound', 'outbound'].includes(direction)) {
      throw assistantConsoleError('Unknown message direction');
    }
    if (!ALLOWED_SENDER_TYPES.has(senderType)) {
      throw assistantConsoleError('Unknown message sender type');
    }
    const resolvedDeliveryStatus =
      deliveryStatus || (direction === 'inbound' ? 'received' : 'sent');
    if (!ALLOWED_DELIVERY_STATUSES.has(resolvedDeliveryStatus)) {
      throw assistantConsoleError('Unknown delivery status');
    }
    const conversation = await ensureConversation({ chatJid, phone, displayName }, { db });
    const record = {
      conversation_id: conversation.id,
      outbox_id: outboxId ? optionalUuid(outboxId, 'Outbox id') : null,
      wa_message_id: whatsappMessageId ? cleanText(whatsappMessageId, 180) : null,
      direction,
      sender_type: senderType,
      content: cleanText(content, 10_000, { required: true, field: 'Message' }),
      delivery_status: resolvedDeliveryStatus,
      metadata:
        metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
    };
    const { data, error } = await db.from('whatsapp_messages').insert(record).select('*').single();
    if (error?.code === '23505' && (record.outbox_id || record.wa_message_id)) {
      let existingQuery = db.from('whatsapp_messages').select('*');
      existingQuery = record.outbox_id
        ? existingQuery.eq('outbox_id', record.outbox_id)
        : existingQuery.eq('wa_message_id', record.wa_message_id);
      const { data: existing, error: existingError } = await existingQuery.maybeSingle();
      if (existingError) throw schemaUnavailable(existingError);
      return existing ? messageFromRow(existing) : null;
    }
    if (error) throw schemaUnavailable(error);
    const message = messageFromRow(data);
    realtime.publish(
      'whatsapp.message.created',
      {
        conversationId: conversation.id,
        messageId: message.id,
        direction: message.direction,
        senderType: message.senderType,
        createdAt: message.createdAt,
      },
      { adminOnly: true },
    );
    return message;
  } catch (error) {
    if (bestEffort && isMissingAssistantSchema(error)) {
      warnMissingSchemaOnce();
      return null;
    }
    if (bestEffort && error?.code === 'WHATSAPP_ASSISTANT_SCHEMA_MISSING') {
      warnMissingSchemaOnce();
      return null;
    }
    throw error;
  }
}

async function listConversations(
  { search = '', status = '', page = 1, pageSize = 50 } = {},
  { db = supabase } = {},
) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = boundedInteger(pageSize, 50, 10, 100, 'pageSize');
  const needle = String(search || '')
    .trim()
    .replace(/[,()%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
  let query = db
    .from('whatsapp_conversations')
    .select('*', { count: 'exact' })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (status && ALLOWED_CONVERSATION_STATUSES.has(status)) query = query.eq('status', status);
  if (needle) {
    query = query.or(
      `display_name.ilike.%${needle}%,phone.ilike.%${needle}%,last_message_preview.ilike.%${needle}%`,
    );
  }
  const from = (safePage - 1) * safePageSize;
  const { data, error, count } = await query.range(from, from + safePageSize - 1);
  if (error) throw schemaUnavailable(error);

  let unreadQuery = db.from('whatsapp_conversations').select('unread_count');
  if (status && ALLOWED_CONVERSATION_STATUSES.has(status)) {
    unreadQuery = unreadQuery.eq('status', status);
  }
  if (needle) {
    unreadQuery = unreadQuery.or(
      `display_name.ilike.%${needle}%,phone.ilike.%${needle}%,last_message_preview.ilike.%${needle}%`,
    );
  }
  const { data: unreadRows, error: unreadError } = await unreadQuery;
  if (unreadError) throw schemaUnavailable(unreadError);
  const conversations = (data || []).map(conversationFromRow);
  return {
    conversations,
    total: count || 0,
    unread: (unreadRows || []).reduce((sum, item) => sum + Number(item.unread_count || 0), 0),
    page: safePage,
    pageSize: safePageSize,
  };
}

async function getConversationDetail(id, { db = supabase } = {}) {
  const conversation = await readConversation(id, { db });
  const [{ data: messageRows, error: messageError }, { data: memoryRows, error: memoryError }] =
    await Promise.all([
      db
        .from('whatsapp_messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(200),
      db
        .from('whatsapp_memories')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('updated_at', { ascending: false }),
    ]);
  if (messageError) throw schemaUnavailable(messageError);
  if (memoryError) throw schemaUnavailable(memoryError);
  return {
    conversation,
    messages: (messageRows || []).reverse().map(messageFromRow),
    memories: (memoryRows || []).map(memoryFromRow),
  };
}

async function updateConversation(id, input = {}, { db = supabase } = {}) {
  const current = await readConversation(id, { db });
  const record = {};
  if (input.status !== undefined) {
    const status = String(input.status);
    if (!ALLOWED_CONVERSATION_STATUSES.has(status)) {
      throw assistantConsoleError('Unknown conversation status');
    }
    record.status = status;
  }
  if (input.assistantEnabled !== undefined) {
    record.assistant_enabled = strictBoolean(
      input.assistantEnabled,
      current.assistantEnabled,
      'assistantEnabled',
    );
  }
  if (input.displayName !== undefined) record.display_name = cleanText(input.displayName, 160);
  if (input.markRead === true) record.unread_count = 0;
  if (!Object.keys(record).length) return current;
  const { data, error } = await db
    .from('whatsapp_conversations')
    .update(record)
    .eq('id', current.id)
    .select('*')
    .single();
  if (error) throw schemaUnavailable(error);
  const conversation = conversationFromRow(data);
  realtime.publish(
    'whatsapp.conversation.updated',
    {
      conversationId: conversation.id,
      status: conversation.status,
      assistantEnabled: conversation.assistantEnabled,
      unreadCount: conversation.unreadCount,
    },
    { adminOnly: true },
  );
  return conversation;
}

async function resetConversationContext(chatJid, { db = supabase, bestEffort = false } = {}) {
  try {
    const conversation = await findConversationByJid(chatJid, { db });
    if (!conversation) return null;
    const { data, error } = await db
      .from('whatsapp_conversations')
      .update({ context_reset_at: new Date().toISOString() })
      .eq('id', conversation.id)
      .select('*')
      .single();
    if (error) throw schemaUnavailable(error);
    return conversationFromRow(data);
  } catch (error) {
    if (
      bestEffort &&
      (isMissingAssistantSchema(error) || error?.code === 'WHATSAPP_ASSISTANT_SCHEMA_MISSING')
    ) {
      warnMissingSchemaOnce();
      return null;
    }
    throw error;
  }
}

async function createConversationMemory(
  conversationId,
  input,
  { db = supabase, createdBy = '' } = {},
) {
  const conversation = await readConversation(conversationId, { db });
  const record = normalizeMemory(input);
  if (record.source_message_id) {
    const { data: sourceMessage, error: sourceError } = await db
      .from('whatsapp_messages')
      .select('id')
      .eq('id', record.source_message_id)
      .eq('conversation_id', conversation.id)
      .maybeSingle();
    if (sourceError) throw schemaUnavailable(sourceError);
    if (!sourceMessage) {
      throw assistantConsoleError(
        'Source message does not belong to this conversation',
        400,
        'MEMORY_SOURCE_INVALID',
      );
    }
  }
  const { data, error } = await db
    .from('whatsapp_memories')
    .insert({
      ...record,
      conversation_id: conversation.id,
      created_by: cleanText(createdBy, 120),
    })
    .select('*')
    .single();
  if (error) throw schemaUnavailable(error);
  return memoryFromRow(data);
}

async function deleteConversationMemory(conversationId, memoryId, { db = supabase } = {}) {
  const conversation = await readConversation(conversationId, { db });
  const { data, error } = await db
    .from('whatsapp_memories')
    .delete()
    .eq('id', String(memoryId || ''))
    .eq('conversation_id', conversation.id)
    .select('id')
    .maybeSingle();
  if (error) throw schemaUnavailable(error);
  if (!data) throw assistantConsoleError('Memory not found', 404, 'MEMORY_NOT_FOUND');
}

async function getAssistantRuntime(chatJid, { db = supabase } = {}) {
  const settings = await getAssistantSettings({ db, allowFallback: true });
  let conversation = null;
  if (settings.storageReady) {
    try {
      conversation = await findConversationByJid(chatJid, { db });
    } catch (error) {
      if (!isMissingAssistantSchema(error) && error?.code !== 'WHATSAPP_ASSISTANT_SCHEMA_MISSING') {
        throw error;
      }
    }
  }
  return {
    settings,
    conversation,
    shouldReply:
      settings.assistantEnabled &&
      settings.autoReplyEnabled &&
      (conversation?.assistantEnabled ?? true) &&
      (conversation?.status ?? 'open') === 'open',
  };
}

async function safeListActiveKnowledge(db) {
  try {
    return await listKnowledgeDocuments({ db, activeOnly: true, useCache: true });
  } catch (error) {
    if (isMissingAssistantSchema(error) || error?.code === 'WHATSAPP_ASSISTANT_SCHEMA_MISSING') {
      warnMissingSchemaOnce();
      return [];
    }
    throw error;
  }
}

async function buildAssistantConsoleContext(chatJid, currentMessage, { db = supabase } = {}) {
  const settings = await getAssistantSettings({ db, allowFallback: true });
  const documents = settings.storageReady ? await safeListActiveKnowledge(db) : [];
  let memories = [];
  let messages = [];

  if (settings.storageReady) {
    const conversation = await findConversationByJid(chatJid, { db });
    if (conversation && settings.memoryEnabled) {
      let messageQuery = db
        .from('whatsapp_messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(Math.min(settings.historyMessages + 1, 31));
      if (conversation.contextResetAt) {
        messageQuery = messageQuery.gte('created_at', conversation.contextResetAt);
      }
      const [{ data: memoryRows, error: memoryError }, { data: messageRows, error: messageError }] =
        await Promise.all([
          db
            .from('whatsapp_memories')
            .select('*')
            .eq('conversation_id', conversation.id)
            .eq('is_active', true)
            .order('updated_at', { ascending: false })
            .limit(20),
          settings.historyMessages > 0 ? messageQuery : Promise.resolve({ data: [], error: null }),
        ]);
      if (memoryError) throw schemaUnavailable(memoryError);
      if (messageError) throw schemaUnavailable(messageError);
      memories = (memoryRows || []).map(memoryFromRow);
      messages = (messageRows || []).reverse().map(messageFromRow);
      const normalizedCurrent = redactContextText(currentMessage);
      const last = messages.at(-1);
      if (last?.direction === 'inbound' && redactContextText(last.content) === normalizedCurrent) {
        messages.pop();
      }
      messages = messages.slice(-settings.historyMessages);
    }
  }

  const selectedKnowledge = selectKnowledgeForQuery(documents, currentMessage);
  const authoritativePrices = selectedKnowledge.filter(
    (document) => document.category === 'astana_price',
  );
  const ownerKnowledge = selectedKnowledge.filter(
    (document) => document.category !== 'astana_price',
  );
  const toneNames = {
    friendly: 'дружелюбный и деловой',
    warm: 'тёплый и заботливый',
    concise: 'максимально краткий и точный',
    formal: 'официальный и сдержанный',
  };
  const lines = [
    '<owner_configuration>',
    `Имя ассистента: ${redactContextText(settings.botName, 80)}.`,
    `Тон ответов: ${toneNames[settings.tone] || toneNames.friendly}.`,
    `Разрешённые языки: ${settings.supportedLanguages.join(', ')}.`,
    settings.businessDescription
      ? `Описание бизнеса от владельца: ${redactContextText(settings.businessDescription, 4000)}`
      : '',
    settings.customInstructions
      ? `Дополнительные инструкции владельца: ${redactContextText(settings.customInstructions, 6000)}`
      : '',
    `Приветствие: ${redactContextText(settings.welcomeMessage, 500)}`,
    '</owner_configuration>',
  ].filter(Boolean);

  if (authoritativePrices.length) {
    lines.push('<authoritative_astana_prices>');
    for (const document of authoritativePrices) {
      lines.push(
        `- ${redactContextText(document.title, 160)}: ${redactContextText(document.content, 3000)}`,
      );
    }
    lines.push('</authoritative_astana_prices>');
  }

  if (ownerKnowledge.length) {
    lines.push('<owner_knowledge>');
    for (const document of ownerKnowledge) {
      lines.push(
        `- ${redactContextText(document.title, 160)} [${redactContextText(document.category, 60)}]: ${redactContextText(document.content, 3000)}`,
      );
    }
    lines.push('</owner_knowledge>');
  }

  if (memories.length) {
    lines.push('<customer_memory>');
    for (const memory of memories) {
      lines.push(
        `- ${redactContextText(memory.label, 120)}: ${redactContextText(memory.content, 1200)}`,
      );
    }
    lines.push('</customer_memory>');
  }

  if (messages.length) {
    lines.push('<recent_dialog>');
    for (const message of messages) {
      const speaker =
        message.senderType === 'customer'
          ? 'Клиент'
          : message.senderType === 'operator'
            ? 'Оператор'
            : 'Ассистент';
      lines.push(`${speaker}: ${redactContextText(message.content, 1200)}`);
    }
    lines.push('</recent_dialog>');
  }

  return lines.join('\n').slice(0, 16_000);
}

module.exports = {
  AI_PROVIDER_DEFINITIONS,
  ALLOWED_AI_PROVIDERS,
  ALLOWED_CONVERSATION_STATUSES,
  DEFAULT_SETTINGS,
  assistantConsoleError,
  buildAssistantConsoleContext,
  clearAssistantConsoleCache,
  createConversationMemory,
  createKnowledgeDocument,
  deleteConversationMemory,
  deleteKnowledgeDocument,
  decryptApiKey,
  encryptApiKey,
  ensureConversation,
  findConversationByJid,
  getAssistantRuntime,
  getAssistantSettings,
  getAssistantProviderConfiguration,
  getProviderKeyStatus,
  getConversationDetail,
  isMissingAssistantSchema,
  knowledgeFromRow,
  listConversations,
  listKnowledgeDocuments,
  memoryFromRow,
  normalizeKnowledge,
  normalizeMemory,
  normalizeAiModel,
  normalizeAiProvider,
  normalizeSettings,
  readConversation,
  recordConversationMessage,
  redactContextText,
  resetConversationContext,
  saveProviderCredential,
  selectKnowledgeForQuery,
  settingsFromRow,
  updateAssistantSettings,
  updateConversation,
  updateKnowledgeDocument,
};

const { supabase } = require('../config/supabase');
const { getPushStatus } = require('./push.service');
const { getAssistantSettings } = require('./whatsapp-assistant-console.service');
const { getWhatsAppStatus } = require('./whatsapp-baileys.service');
const yandexDelivery = require('./yandex-delivery.service');
const paymentOperations = require('./payment-operations.service');
const { profileStatus } = require('./iiko-city-profile.service');

const booleanEnvironment = (name) => String(process.env[name] || '').trim().length > 0;

async function latestTimestamp(table, column) {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .not(column, 'is', null)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data?.[column] || null;
}

async function getIntegrationHealth({ canManagePayments = false } = {}) {
  const [settings, inventorySyncedAt, latestOrderAt, payments] = await Promise.all([
    getAssistantSettings({ allowFallback: true }),
    latestTimestamp('branch_product_inventory', 'last_synced_at'),
    latestTimestamp('kaspi_orders', 'updated_at'),
    paymentOperations.getDiagnostics({ canManage: canManagePayments }),
  ]);
  const whatsapp = getWhatsAppStatus(settings);
  const yandex = yandexDelivery.getConfigurationStatus();
  const push = getPushStatus();
  const iikoLoginConfigured = booleanEnvironment('IIKO_API_LOGIN');
  const iikoV2CredentialsComplete =
    booleanEnvironment('IIKO_APP_ID') === booleanEnvironment('IIKO_CLIENT_SECRET');
  const iikoConfigured = iikoLoginConfigured && iikoV2CredentialsComplete;
  const iikoProfiles = profileStatus();
  const kaspiEnabled = process.env.KASPI_POS_ENABLED === 'true';
  const kaspiConfigured =
    kaspiEnabled &&
    booleanEnvironment('KASPI_INTERNAL_SECRET') &&
    booleanEnvironment('TOKEN_SECRET_KEY');

  return {
    checkedAt: new Date().toISOString(),
    payments,
    services: [
      {
        id: 'whatsapp',
        name: 'WhatsApp',
        state: whatsapp.connected ? 'healthy' : 'attention',
        summary: whatsapp.connected ? 'Сессия активна' : 'Требуется подключение',
        detail: whatsapp.lastError || '',
        updatedAt: whatsapp.updatedAt,
      },
      {
        id: 'assistant',
        name: `ИИ-ассистент ${settings.provider}`,
        state:
          settings.assistantEnabled && settings.keyConfigured
            ? 'healthy'
            : settings.assistantEnabled
              ? 'error'
              : 'disabled',
        summary: settings.assistantEnabled
          ? settings.keyConfigured
            ? `Модель ${settings.model}`
            : 'API-ключ не настроен'
          : 'Выключен',
        detail: settings.storageReady ? '' : 'Хранилище настроек недоступно',
        updatedAt: settings.updatedAt,
      },
      {
        id: 'iiko',
        name: 'iiko Cloud · основной',
        state: iikoConfigured ? 'healthy' : 'error',
        summary: iikoConfigured
          ? 'Доступ настроен'
          : iikoLoginConfigured
            ? 'Пара OAuth заполнена не полностью'
            : 'Не указан API login',
        detail:
          iikoLoginConfigured && !iikoV2CredentialsComplete
            ? 'IIKO_APP_ID и IIKO_CLIENT_SECRET указываются только вместе'
            : '',
        updatedAt: inventorySyncedAt,
      },
      {
        id: 'iiko-astana',
        name: 'iiko Cloud · Астана',
        state: iikoProfiles.astana.configured ? 'healthy' : 'disabled',
        summary: iikoProfiles.astana.configured
          ? 'Отдельный API login настроен'
          : 'Используется основной профиль',
        detail:
          iikoProfiles.astana.configured && !iikoProfiles.astana.externalMenuConfigured
            ? 'External Menu определяется автоматически'
            : '',
        updatedAt: inventorySyncedAt,
      },
      {
        id: 'kaspi',
        name: 'Kaspi Pay',
        state: kaspiConfigured ? 'healthy' : kaspiEnabled ? 'error' : 'disabled',
        summary: kaspiConfigured
          ? 'Сервис оплаты настроен'
          : kaspiEnabled
            ? 'Проверьте секреты сервиса'
            : 'Выключен',
        detail: '',
        updatedAt: latestOrderAt,
      },
      {
        id: 'yandex',
        name: 'Яндекс Доставка',
        state: yandex.configured ? 'healthy' : yandex.enabled ? 'error' : 'disabled',
        summary: yandex.configured
          ? 'Доставка настроена'
          : yandex.enabled
            ? 'Не хватает параметров'
            : 'Выключена',
        detail: yandex.missing.join(', '),
        updatedAt: null,
      },
      {
        id: 'push',
        name: 'Push-уведомления',
        state: push.initialized ? 'healthy' : push.configured ? 'error' : 'disabled',
        summary: push.initialized
          ? 'Firebase готов'
          : push.configured
            ? 'Firebase не инициализирован'
            : 'Ключ Firebase не настроен',
        detail: '',
        updatedAt: null,
      },
    ],
  };
}

module.exports = { getIntegrationHealth };

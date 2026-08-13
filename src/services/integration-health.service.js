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

async function activeYandexApiFamilies() {
  const terminal = {
    cargo_v2: [
      'estimating_failed',
      'performer_not_found',
      'delivered',
      'delivered_finish',
      'returned',
      'returned_finish',
      'failed',
      'cancelled',
      'cancelled_with_payment',
      'cancelled_by_taxi',
      'cancelled_with_items_on_hands',
    ],
    business_v2: ['complete', 'finished', 'cancelled', 'failed'],
  };
  const results = await Promise.all(
    Object.entries(terminal).map(async ([family, statuses]) => {
      const { data, error } = await supabase
        .from('delivery_jobs')
        .select('id')
        .eq('provider', 'yandex')
        .eq('api_family', family)
        .not('provider_status', 'in', `(${statuses.join(',')})`)
        .limit(1);
      return { family, active: Boolean(data?.length), error };
    }),
  );
  if (results.some((result) => result.error)) return { unavailable: true, families: [] };
  return {
    unavailable: false,
    families: results.filter((result) => result.active).map((result) => result.family),
  };
}

async function getIntegrationHealth({ canManagePayments = false } = {}) {
  const [settings, inventorySyncedAt, payments, yandexLedger] = await Promise.all([
    getAssistantSettings({ allowFallback: true }),
    latestTimestamp('branch_product_inventory', 'last_synced_at'),
    paymentOperations.getDiagnostics({ canManage: canManagePayments }),
    activeYandexApiFamilies(),
  ]);
  const whatsapp = getWhatsAppStatus(settings);
  const yandex = yandexDelivery.getConfigurationStatus();
  const missingActiveFamilies = yandexLedger.families.filter(
    (family) =>
      yandex.familyReadiness?.[family]?.configured !== true ||
      (family === 'business_v2' && yandex.familyReadiness?.[family]?.dispatchReady !== true),
  );
  const yandexOperational =
    !yandexLedger.unavailable && missingActiveFamilies.length === 0 && yandex.dispatchReady;
  const push = getPushStatus();
  const iikoLoginConfigured = booleanEnvironment('IIKO_API_LOGIN');
  const iikoV2CredentialsComplete =
    booleanEnvironment('IIKO_APP_ID') === booleanEnvironment('IIKO_CLIENT_SECRET');
  const iikoConfigured = iikoLoginConfigured && iikoV2CredentialsComplete;
  const iikoProfiles = profileStatus();
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
        id: 'yandex',
        name: 'Яндекс Доставка',
        state: yandexOperational
          ? 'healthy'
          : yandexLedger.unavailable || missingActiveFamilies.length
            ? 'error'
            : yandex.configured
              ? 'attention'
              : yandex.enabled
                ? 'error'
                : 'disabled',
        summary: yandexOperational
          ? 'Доставка готова к вызову'
          : yandexLedger.unavailable
            ? 'Не удалось проверить активные заявки'
            : missingActiveFamilies.length
              ? `Нет доступа для активных заявок: ${missingActiveFamilies.join(', ')}`
              : yandex.configured
                ? 'Расчёт доступен, платный вызов заблокирован'
                : yandex.enabled
                  ? 'Не хватает параметров'
                  : 'Выключена',
        detail: missingActiveFamilies.length
          ? 'Сохраните credentials и обязательный приёмник тревог каждого API до завершения всех его активных заявок'
          : yandex.configured && !yandex.dispatchReady
            ? `Платный вызов заблокирован: ${yandex.dispatchMissing.join(', ')}`
            : yandex.missing.join(', '),
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

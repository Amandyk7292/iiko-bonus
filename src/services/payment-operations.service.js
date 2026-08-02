const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');
const kaspiService = require('./kaspi.service');
const forteService = require('./forte.service');
const forteWidgetService = require('./forte-widget.service');

const WIDGET_PREFERENCE_KEY = 'payment_forte_widget_enabled';
const PROVIDER_PROBE_KEY = 'payment_provider_probe';
const PAYMENT_CLEANUP_KEY = 'payment_cleanup_status';
const WEBHOOK_KEYS = Object.freeze({
  kaspi: 'payment_webhook_kaspi',
  forte_widget: 'payment_webhook_forte_widget',
});
const CACHE_TTL_MS = 5000;
const MAX_DIAGNOSTIC_MESSAGE = 240;

const cache = new Map();

const clone = (value) => JSON.parse(JSON.stringify(value));

const parseStoredValue = (value, fallback) => {
  if (value == null || value === '') return clone(fallback);
  if (typeof value === 'object') return clone(value);
  try {
    return JSON.parse(String(value));
  } catch {
    return clone(fallback);
  }
};

const sanitizeDiagnosticMessage = (value, fallback = '') => {
  const message = String(value || fallback)
    .replace(
      /\b(password|secret|token|authorization)\b\s*[:=]\s*["']?[^"',&\s}]+["']?/gi,
      (_match, key) => `${key}=[скрыто]`,
    )
    .replace(/https?:\/\/[^\s]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
      } catch {
        return '[адрес скрыт]';
      }
    })
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return message.slice(0, MAX_DIAGNOSTIC_MESSAGE);
};

const defaultReadSetting = async (key) => {
  const { data, error } = await supabase
    .from('settings')
    .select('value,updated_at')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

const defaultWriteSetting = async (key, value) => {
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from('settings').upsert(
    {
      key,
      value: JSON.stringify(value),
      updated_at: updatedAt,
    },
    { onConflict: 'key' },
  );
  if (error) throw error;
  return { value, updated_at: updatedAt };
};

const paymentProviderLabel = (order) => {
  if (order?.provider_payment_system === 'forte_widget') return 'Forte Widget';
  if (order?.payment_method === 'forte_card') return 'Forte /flex';
  return 'Kaspi Pay';
};

const defaultListPaymentErrors = async () => {
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('id,order_number,payment_method,provider_payment_system,status,last_error,updated_at')
    .not('last_error', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(8);
  if (error) throw error;
  return (data || []).map((order) => ({
    id: String(order.id),
    orderNumber: Number(order.order_number) || null,
    provider: paymentProviderLabel(order),
    status: String(order.status || 'pending'),
    message: sanitizeDiagnosticMessage(order.last_error, 'Ошибка оплаты'),
    occurredAt: order.updated_at || null,
  }));
};

const providerResult = ({
  configured,
  available,
  checkedAt,
  message,
  errorCode = null,
  details = {},
}) => ({
  configured: configured === true,
  available: available === true,
  checkedAt,
  message: sanitizeDiagnosticMessage(message),
  errorCode: errorCode ? String(errorCode).slice(0, 80) : null,
  ...details,
});

const isSafeWidgetFallbackError = (error) =>
  [
    'FORTE_WIDGET_NOT_CONFIGURED',
    'FORTE_WIDGET_CHECKOUT_DISABLED',
    'FORTE_WIDGET_CREATE_REJECTED',
    'FORTE_WIDGET_NETWORK_ERROR',
    'FORTE_WIDGET_NO_PAYMENT_METHODS',
  ].includes(error?.code);

class PaymentOperationsService {
  constructor({
    readSetting = defaultReadSetting,
    writeSetting = defaultWriteSetting,
    listPaymentErrors = defaultListPaymentErrors,
    kaspi = kaspiService,
    forte = forteService,
    widget = forteWidgetService,
    env = process.env,
    now = () => new Date(),
  } = {}) {
    this.readSetting = readSetting;
    this.writeSetting = writeSetting;
    this.listPaymentErrors = listPaymentErrors;
    this.kaspi = kaspi;
    this.forte = forte;
    this.widget = widget;
    this.env = env;
    this.now = now;
    this.localCache = readSetting === defaultReadSetting ? cache : new Map();
  }

  async getSetting(key, fallback, { forceRefresh = false } = {}) {
    const cached = this.localCache.get(key);
    if (!forceRefresh && cached && Date.now() < cached.expiresAt) return clone(cached.value);
    try {
      const row = await this.readSetting(key);
      const value = parseStoredValue(row?.value, fallback);
      this.localCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return clone(value);
    } catch (error) {
      logger.warn(
        { err: error, event: 'payment_setting_read_failed', setting: key },
        'Using safe payment setting fallback',
      );
      return cached ? clone(cached.value) : clone(fallback);
    }
  }

  async setSetting(key, value) {
    await this.writeSetting(key, value);
    this.localCache.set(key, { value: clone(value), expiresAt: Date.now() + CACHE_TTL_MS });
    return clone(value);
  }

  defaultWidgetEnabled() {
    return this.env.FORTE_WIDGET_CHECKOUT_ENABLED === 'true';
  }

  async getWidgetPreference(options) {
    const fallback = {
      enabled: this.defaultWidgetEnabled(),
      updatedAt: null,
      updatedBy: 'environment',
    };
    const value = await this.getSetting(WIDGET_PREFERENCE_KEY, fallback, options);
    return {
      enabled: value?.enabled === true,
      updatedAt: value?.updatedAt || null,
      updatedBy: sanitizeDiagnosticMessage(value?.updatedBy, ''),
    };
  }

  async setWidgetEnabled(enabled, { updatedBy = '' } = {}) {
    if (typeof enabled !== 'boolean') {
      throw Object.assign(new Error('Поле enabled должно быть логическим значением'), {
        statusCode: 400,
        code: 'PAYMENT_WIDGET_MODE_INVALID',
      });
    }
    if (enabled) await this.runSafeProbe();
    return this.setSetting(WIDGET_PREFERENCE_KEY, {
      enabled,
      updatedAt: this.now().toISOString(),
      updatedBy: String(updatedBy || '').slice(0, 120),
    });
  }

  async getProviderProbe(options) {
    return this.getSetting(
      PROVIDER_PROBE_KEY,
      {
        checkedAt: null,
        kaspi: null,
        forteHosted: null,
        forteWidget: null,
      },
      options,
    );
  }

  async runSafeProbe() {
    const checkedAt = this.now().toISOString();
    const kaspiConfigured =
      this.env.KASPI_POS_ENABLED === 'true' &&
      String(this.env.KASPI_INTERNAL_SECRET || '').length >= 32;
    const hostedConfigured = this.forte.availability();
    const widgetConfigured = this.widget.availability();

    const [kaspiResult, hostedResult, widgetResult] = await Promise.allSettled([
      kaspiConfigured ? this.kaspi.availability() : Promise.resolve(false),
      hostedConfigured
        ? this.forte.probeConnection()
        : Promise.resolve({ available: false, message: 'Не настроен' }),
      widgetConfigured
        ? this.widget.probeCheckout()
        : Promise.resolve({
            available: false,
            message: 'Не настроен',
            errorCode: 'FORTE_WIDGET_NOT_CONFIGURED',
          }),
    ]);

    const probe = {
      checkedAt,
      kaspi:
        kaspiResult.status === 'fulfilled'
          ? providerResult({
              configured: kaspiConfigured,
              available: kaspiResult.value === true,
              checkedAt,
              message: kaspiResult.value === true ? 'Сервис отвечает' : 'Сервис недоступен',
            })
          : providerResult({
              configured: kaspiConfigured,
              available: false,
              checkedAt,
              message: 'Сервис не ответил',
              errorCode: kaspiResult.reason?.code || 'KASPI_PROBE_FAILED',
            }),
      forteHosted:
        hostedResult.status === 'fulfilled'
          ? providerResult({
              configured: hostedConfigured,
              available: hostedResult.value?.available === true,
              checkedAt,
              message: hostedResult.value?.message || 'Проверка завершена',
              errorCode: hostedResult.value?.errorCode,
            })
          : providerResult({
              configured: hostedConfigured,
              available: false,
              checkedAt,
              message: 'Forte /flex не ответил',
              errorCode: hostedResult.reason?.code || 'FORTE_PROBE_FAILED',
            }),
      forteWidget:
        widgetResult.status === 'fulfilled'
          ? providerResult({
              configured: widgetConfigured,
              available: widgetResult.value?.available === true,
              checkedAt,
              message: widgetResult.value?.message || 'Проверка завершена',
              errorCode: widgetResult.value?.errorCode,
              details: {
                availableMethods: Array.isArray(widgetResult.value?.availableMethods)
                  ? widgetResult.value.availableMethods.slice(0, 10)
                  : [],
                providerStatus: String(widgetResult.value?.providerStatus || '').slice(0, 60),
              },
            })
          : providerResult({
              configured: widgetConfigured,
              available: false,
              checkedAt,
              message: 'Forte Widget не ответил',
              errorCode: widgetResult.reason?.code || 'FORTE_WIDGET_PROBE_FAILED',
            }),
    };
    await this.setSetting(PROVIDER_PROBE_KEY, probe);
    return probe;
  }

  async recordWidgetFailure(error) {
    const checkedAt = this.now().toISOString();
    const current = await this.getProviderProbe();
    const next = {
      ...current,
      checkedAt,
      forteWidget: providerResult({
        configured: this.widget.availability(),
        available: false,
        checkedAt,
        message:
          error?.code === 'FORTE_WIDGET_NO_PAYMENT_METHODS'
            ? 'Банк не вернул доступные способы оплаты'
            : 'Widget временно недоступен',
        errorCode: error?.code || 'FORTE_WIDGET_FAILED',
      }),
    };
    await this.setSetting(PROVIDER_PROBE_KEY, next);
    return next;
  }

  async getForteCheckoutDecision() {
    const [preference, probe] = await Promise.all([
      this.getWidgetPreference(),
      this.getProviderProbe(),
    ]);
    const hostedAvailable = this.forte.availability();
    const widgetConfigured = this.widget.availability();
    const widgetKnownUnhealthy = probe?.forteWidget?.available === false;
    const useWidget = preference.enabled && widgetConfigured && !widgetKnownUnhealthy;
    const effectiveIntegration = useWidget ? 'widget' : hostedAvailable ? 'hosted_page' : null;
    let fallbackReason = null;
    if (preference.enabled && effectiveIntegration === 'hosted_page') {
      fallbackReason = !widgetConfigured ? 'widget_not_configured' : 'widget_unhealthy';
    } else if (!preference.enabled) {
      fallbackReason = 'widget_disabled';
    } else if (!effectiveIntegration) {
      fallbackReason = 'payment_unavailable';
    }
    return {
      widgetEnabled: preference.enabled,
      widgetConfigured,
      widgetKnownUnhealthy,
      hostedAvailable,
      effectiveIntegration,
      fallbackActive: preference.enabled && effectiveIntegration === 'hosted_page',
      fallbackReason,
      preferenceUpdatedAt: preference.updatedAt,
    };
  }

  async recordWebhook(provider, { success, errorCode = null } = {}) {
    const key = WEBHOOK_KEYS[provider];
    if (!key) return;
    const current = await this.getSetting(key, {
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCode: null,
    });
    const occurredAt = this.now().toISOString();
    const next =
      success === true
        ? {
            ...current,
            lastSuccessAt: occurredAt,
            lastErrorCode: null,
          }
        : {
            ...current,
            lastFailureAt: occurredAt,
            lastErrorCode: String(errorCode || 'WEBHOOK_FAILED').slice(0, 80),
          };
    await this.setSetting(key, next);
  }

  async recordCleanupResult(result) {
    return this.setSetting(PAYMENT_CLEANUP_KEY, {
      checkedAt: this.now().toISOString(),
      inspected: Number(result?.inspected || 0),
      expired: Number(result?.expired || 0),
      cancelled: Number(result?.cancelled || 0),
      released: Number(result?.released || 0),
      errors: Number(result?.errors || 0),
    });
  }

  async getDiagnostics({ canManage = false } = {}) {
    const [decision, probe, kaspiWebhook, widgetWebhook, cleanup, latestErrors] = await Promise.all(
      [
        this.getForteCheckoutDecision(),
        this.getProviderProbe(),
        this.getSetting(WEBHOOK_KEYS.kaspi, {
          lastSuccessAt: null,
          lastFailureAt: null,
          lastErrorCode: null,
        }),
        this.getSetting(WEBHOOK_KEYS.forte_widget, {
          lastSuccessAt: null,
          lastFailureAt: null,
          lastErrorCode: null,
        }),
        this.getSetting(PAYMENT_CLEANUP_KEY, {
          checkedAt: null,
          inspected: 0,
          expired: 0,
          cancelled: 0,
          released: 0,
          errors: 0,
        }),
        this.listPaymentErrors().catch((error) => {
          logger.warn(
            { err: error, event: 'payment_diagnostic_errors_read_failed' },
            'Could not load payment errors',
          );
          return [];
        }),
      ],
    );
    const kaspiConfigured =
      this.env.KASPI_POS_ENABLED === 'true' &&
      String(this.env.KASPI_INTERNAL_SECRET || '').length >= 32;
    return {
      canManage,
      checkedAt: probe?.checkedAt || null,
      mode: {
        widgetEnabled: decision.widgetEnabled,
        effectiveIntegration: decision.effectiveIntegration,
        fallbackActive: decision.fallbackActive,
        fallbackReason: decision.fallbackReason,
        updatedAt: decision.preferenceUpdatedAt,
      },
      providers: {
        kaspi: {
          enabled: this.env.KASPI_POS_ENABLED === 'true',
          configured: kaspiConfigured,
          available: probe?.kaspi?.available ?? null,
          checkedAt: probe?.kaspi?.checkedAt || null,
          message: probe?.kaspi?.message || 'Проверка ещё не запускалась',
        },
        forteHosted: {
          enabled: this.env.FORTE_ENABLED === 'true',
          configured: this.forte.availability(),
          available: probe?.forteHosted?.available ?? null,
          checkedAt: probe?.forteHosted?.checkedAt || null,
          message: probe?.forteHosted?.message || 'Проверка ещё не запускалась',
        },
        forteWidget: {
          enabled: decision.widgetEnabled,
          configured: decision.widgetConfigured,
          available: probe?.forteWidget?.available ?? null,
          checkedAt: probe?.forteWidget?.checkedAt || null,
          message: probe?.forteWidget?.message || 'Проверка ещё не запускалась',
          errorCode: probe?.forteWidget?.errorCode || null,
          availableMethods: probe?.forteWidget?.availableMethods || [],
        },
      },
      webhooks: {
        kaspi: {
          configured: String(this.env.KASPI_WEBHOOK_SECRET || '').length >= 32,
          ...kaspiWebhook,
        },
        forteWidget: {
          configured:
            decision.widgetConfigured &&
            String(this.env.FORTE_WIDGET_WEBHOOK_PUBLIC_KEY || '').trim().length > 0,
          ...widgetWebhook,
        },
      },
      cleanup,
      latestErrors,
    };
  }
}

module.exports = new PaymentOperationsService();
module.exports.PaymentOperationsService = PaymentOperationsService;
module.exports.isSafeWidgetFallbackError = isSafeWidgetFallbackError;
module.exports.sanitizeDiagnosticMessage = sanitizeDiagnosticMessage;

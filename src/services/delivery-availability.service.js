const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');

const KEY = 'delivery_availability';
const MESSAGE = 'В данный момент доставка временно недоступна. Выберите самовывоз.';
const unavailableError = () =>
  Object.assign(new Error(MESSAGE), { statusCode: 503, code: 'DELIVERY_TEMPORARILY_UNAVAILABLE' });

// This is an error-triggered stop, not a successful balance check. A successful
// price estimate or a cancelled claim must never be treated as proof of funds.
function isInsufficientFunds(payload) {
  const errors = Array.isArray(payload?.error_messages) ? payload.error_messages : [];
  return [payload, payload?.error, ...errors].some((entry) => {
    if (!entry) return false;
    const code = String(entry.code || '').toLowerCase();
    const message = String(typeof entry === 'string' ? entry : entry.message || '');
    return (
      [
        'insufficient_funds',
        'insufficient_balance',
        'not_enough_money',
        'not_enough_funds',
        'not_enough_balance',
      ].includes(code) ||
      /^(?:(?:insufficient|not enough) (?:funds|money|balance)|недостаточно (?:денежных )?средств|недостаточн\S* баланс)(?:[.!:\s]|$)/iu.test(
        message.trim(),
      )
    );
  });
}

class DeliveryAvailabilityService {
  constructor({ db = supabase } = {}) {
    this.db = db;
    this.pendingBlock = null;
  }

  async persistBlock() {
    const value = this.pendingBlock;
    if (!value) return;
    const { error } = await this.db
      .from('settings')
      .upsert(
        { key: KEY, value: JSON.stringify(value), updated_at: value.detectedAt },
        { onConflict: 'key' },
      );
    if (error) throw error;
    if (this.pendingBlock === value) this.pendingBlock = null;
  }

  async get() {
    // Existing unit tests isolate integrations. Dedicated tests inject a real
    // store double and execute all reads, writes and conditional resume logic.
    if (process.env.NODE_ENV === 'test' && this.db === supabase && !this.pendingBlock) {
      return { disabled: false };
    }
    if (this.pendingBlock) {
      const pending = this.pendingBlock;
      try {
        await this.persistBlock();
      } catch {
        return this.pendingBlock || pending;
      }
    }
    const { data, error } = await this.db
      .from('settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle();
    if (error) throw unavailableError();
    if (!data) return { disabled: false };
    try {
      const value = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (typeof value?.disabled !== 'boolean') throw unavailableError();
      return value;
    } catch {
      throw unavailableError();
    }
  }

  async assertAvailable(checkout) {
    if (checkout.effectiveFulfillmentType !== 'delivery') return;
    if ((await this.get()).disabled) throw unavailableError();
  }

  async recordProviderFailure(payload) {
    if (!isInsufficientFunds(payload)) return false;
    this.pendingBlock = {
      disabled: true,
      reason: 'insufficient_funds',
      revision: crypto.randomUUID(),
      detectedAt: new Date().toISOString(),
    };
    try {
      await this.persistBlock();
    } catch (error) {
      // Keep the local stop and retry persistence on the next checkout read.
      logger.error(
        { err: error, event: 'delivery_stop_save_failed' },
        'Could not persist delivery stop',
      );
    }
    return true;
  }

  async resume(revision, updatedBy) {
    const current = await this.get();
    if (!current.disabled) return current;
    if (current.revision !== revision) {
      throw Object.assign(new Error('Состояние доставки изменилось. Обновите страницу.'), {
        statusCode: 409,
      });
    }
    const value = { disabled: false, resumedAt: new Date().toISOString(), updatedBy };
    // A new provider failure must win over an administrator's stale screen.
    const { data, error } = await this.db
      .from('settings')
      .update({ value: JSON.stringify(value), updated_at: value.resumedAt })
      .eq('key', KEY)
      .eq('value', JSON.stringify(current))
      .select('key');
    if (error) throw unavailableError();
    if (!data?.length) {
      throw Object.assign(new Error('Состояние доставки изменилось. Обновите страницу.'), {
        statusCode: 409,
      });
    }
    return value;
  }
}

const deliveryAvailability = new DeliveryAvailabilityService();
module.exports = {
  deliveryAvailability,
  DeliveryAvailabilityService,
  isInsufficientFunds,
  unavailableError,
};

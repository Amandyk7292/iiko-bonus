const { supabase } = require('../config/supabase');
const { getTierInfo: calculateTierInfo } = require('../utils/tier.util');

const defaultSettings = {
  base_cashback_percent: 3,
  tier_silver_th: 50000,
  tier_silver_cb: 5,
  tier_gold_th: 150000,
  tier_gold_cb: 7,
  tier_platinum_th: 300000,
  tier_platinum_cb: 10,
  max_discount_percent: 50,
  bonus_mode: 'cashback',
  bonus_activation: {
    enabled: true,
    delay_days: 0,
    first_transaction_bonus: 0,
    first_transaction_notification: '',
  },
  bonus_expiration: {
    enabled: true,
    expiration_days: 90,
    notify_before_days: 30,
    auto_write_off: true,
  },
  bonus_birthday: {
    enabled: true,
    bonus_amount: 500,
    expiration_days: 14,
    message: 'С днем рождения! Дарим бонусы от Bulka.',
  },
  bonus_promocodes: [],
  bonus_cross: {
    enabled: false,
    new_clients_bonus: 0,
    loyal_clients_bonus: 0,
    period: 'none',
    city: 'Все города',
    min_check: 0,
  },
  bonus_referral: {
    enabled: false,
    inviter_bonus: 300,
    friend_bonus: 300,
    min_first_order: 0,
  },
  bonus_automailing: {
    enabled: false,
    inactive_days: 30,
    message: 'Мы скучаем! Возвращайтесь за свежей выпечкой и бонусами.',
  },
  bonus_card_media: {
    banner_url: '',
    logo_url: '',
    card_title: 'Bulka Bonus',
  },
  bonus_corporate: {
    enabled: false,
    company_name: '',
    monthly_limit: 0,
    employee_cashback_percent: 5,
  },
  app_release_policy: {
    android: {
      latest_version: '1.0.0',
      minimum_version: '1.0.0',
      store_url: 'https://play.google.com/store/apps/details?id=com.bulka.bonus',
    },
    ios: {
      latest_version: '1.0.0',
      minimum_version: '1.0.0',
      store_url: '',
    },
  },
};

function parseSettingValue(value) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (text === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  ) {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return text;
    }
  }
  return text;
}

async function getSettings() {
  const { data, error } = await supabase.from('settings').select('*');
  if (error || !data) {
    console.warn('Could not load settings from DB, using defaults.', error?.message);
    return defaultSettings;
  }

  const settings = { ...defaultSettings };
  for (const row of data) {
    settings[row.key] = parseSettingValue(row.value);
  }
  return settings;
}

async function updateSettings(newSettings) {
  if (!newSettings || typeof newSettings !== 'object' || Array.isArray(newSettings))
    throw new Error('Settings payload must be an object');
  const allowedKeys = new Set(Object.keys(defaultSettings));
  for (const key of Object.keys(newSettings)) {
    if (!allowedKeys.has(key)) throw new Error(`Unknown setting: ${key}`);
    if (/_cb$|percent$/.test(key)) {
      const numeric = Number(newSettings[key]);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100)
        throw new Error(`Invalid percentage: ${key}`);
    }
    if (/_th$/.test(key)) {
      const numeric = Number(newSettings[key]);
      if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`Invalid threshold: ${key}`);
    }
    if (key === 'bonus_promocodes') {
      const promos = newSettings[key];
      if (!Array.isArray(promos) || promos.length > 100) {
        throw new Error('bonus_promocodes must be an array with at most 100 items');
      }
      const codes = new Set();
      for (const promo of promos) {
        const code = String(promo?.code || '')
          .trim()
          .toUpperCase();
        const type = String(promo?.type || 'percent');
        const value = Number(promo?.value);
        const minOrder = Number(promo?.min_order ?? 0);
        if (
          !/^[A-Z0-9_-]{3,32}$/.test(code) ||
          codes.has(code) ||
          !['percent', 'fixed'].includes(type) ||
          !Number.isFinite(value) ||
          value <= 0 ||
          (type === 'percent' && value > 100) ||
          !Number.isFinite(minOrder) ||
          minOrder < 0
        ) {
          throw new Error(`Invalid promo code configuration: ${code || 'empty'}`);
        }
        promo.code = code;
        codes.add(code);
      }
    }
    const value =
      typeof newSettings[key] === 'object' && newSettings[key] !== null
        ? JSON.stringify(newSettings[key])
        : String(newSettings[key]);
    const { error } = await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' });
    if (error) throw new Error(`Error updating setting ${key}: ` + error.message);
  }
}

function getTierInfo(totalSpent, settings) {
  return calculateTierInfo(totalSpent, settings);
}

module.exports = {
  getSettings,
  updateSettings,
  getTierInfo,
};

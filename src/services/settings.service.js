const { supabase } = require('../config/supabase');

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
    first_transaction_notification: ''
  },
  bonus_expiration: {
    enabled: true,
    expiration_days: 90,
    notify_before_days: 30,
    auto_write_off: true
  },
  bonus_birthday: {
    enabled: true,
    bonus_amount: 500,
    expiration_days: 14,
    message: 'С днем рождения! Дарим бонусы от Bulka.'
  },
  bonus_promocodes: [],
  bonus_cross: {
    enabled: false,
    new_clients_bonus: 0,
    loyal_clients_bonus: 0,
    period: 'none',
    city: 'Все города',
    min_check: 0
  },
  bonus_referral: {
    enabled: false,
    inviter_bonus: 300,
    friend_bonus: 300,
    min_first_order: 0
  },
  bonus_automailing: {
    enabled: false,
    inactive_days: 30,
    message: 'Мы скучаем! Возвращайтесь за свежей выпечкой и бонусами.'
  },
  bonus_card_media: {
    banner_url: '',
    logo_url: '',
    card_title: 'Bulka Bonus'
  },
  bonus_corporate: {
    enabled: false,
    company_name: '',
    monthly_limit: 0,
    employee_cashback_percent: 5
  }
};

function parseSettingValue(value) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (text === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      return JSON.parse(text);
    } catch (e) {
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
  for (const key of Object.keys(newSettings)) {
    const value = typeof newSettings[key] === 'object' && newSettings[key] !== null
      ? JSON.stringify(newSettings[key])
      : String(newSettings[key]);
    const { error } = await supabase
      .from('settings')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) throw new Error(`Error updating setting ${key}: ` + error.message);
  }
}

function getTierInfo(totalSpent, settings) {
  const spent = Number(totalSpent) || 0;
  if (spent >= settings.tier_platinum_th) {
    return { name: 'Платина', percent: settings.tier_platinum_cb, nextTier: null, nextTh: null, remaining: 0, progress: 100 };
  } else if (spent >= settings.tier_gold_th) {
    return { name: 'Золото', percent: settings.tier_gold_cb, nextTier: 'Платина', nextTh: settings.tier_platinum_th, remaining: settings.tier_platinum_th - spent, progress: (spent / settings.tier_platinum_th) * 100 };
  } else if (spent >= settings.tier_silver_th) {
    return { name: 'Серебро', percent: settings.tier_silver_cb, nextTier: 'Золото', nextTh: settings.tier_gold_th, remaining: settings.tier_gold_th - spent, progress: (spent / settings.tier_gold_th) * 100 };
  } else {
    return { name: 'Бронза', percent: settings.base_cashback_percent, nextTier: 'Серебро', nextTh: settings.tier_silver_th, remaining: settings.tier_silver_th - spent, progress: (spent / settings.tier_silver_th) * 100 };
  }
}

module.exports = {
  getSettings,
  updateSettings,
  getTierInfo
};

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
  const bronzeCb = Number(settings.base_cashback_percent) || 5;
  const silverTh = Number(settings.tier_silver_th) || 50000;
  const silverCb = Number(settings.tier_silver_cb) || 7;
  const goldTh = Number(settings.tier_gold_th) || 150000;
  const goldCb = Number(settings.tier_gold_cb) || 10;

  const allTiers = [
    { name: 'Бронза', percent: bronzeCb, threshold: 0 },
    { name: 'Серебро', percent: silverCb, threshold: silverTh },
    { name: 'Золото', percent: goldCb, threshold: goldTh }
  ];

  if (spent >= goldTh) {
    return {
      name: 'Золото',
      percent: goldCb,
      nextTier: null,
      nextTh: null,
      remaining: 0,
      progress: 100,
      level: 3,
      allTiers
    };
  } else if (spent >= silverTh) {
    return {
      name: 'Серебро',
      percent: silverCb,
      nextTier: 'Золото',
      nextTh: goldTh,
      remaining: Math.max(0, goldTh - spent),
      progress: Math.min(100, Math.round((spent / goldTh) * 100)),
      level: 2,
      allTiers
    };
  } else {
    return {
      name: 'Бронза',
      percent: bronzeCb,
      nextTier: 'Серебро',
      nextTh: silverTh,
      remaining: Math.max(0, silverTh - spent),
      progress: Math.min(100, Math.round((spent / silverTh) * 100)),
      level: 1,
      allTiers
    };
  }
}

module.exports = {
  getSettings,
  updateSettings,
  getTierInfo
};

const { supabase } = require('./supabase');

const defaultSettings = {
  base_cashback_percent: 3,
  tier_silver_th: 50000,
  tier_silver_cb: 5,
  tier_gold_th: 150000,
  tier_gold_cb: 7,
  tier_platinum_th: 300000,
  tier_platinum_cb: 10,
  max_discount_percent: 50
};

async function getSettings() {
  const { data, error } = await supabase.from('settings').select('*');
  if (error || !data) {
    console.warn('Could not load settings from DB, using defaults.', error?.message);
    return defaultSettings;
  }
  
  const settings = { ...defaultSettings };
  for (const row of data) {
    settings[row.key] = Number(row.value);
  }
  return settings;
}

async function updateSettings(newSettings) {
  for (const key of Object.keys(newSettings)) {
    const { error } = await supabase
      .from('settings')
      .upsert({ key, value: String(newSettings[key]) }, { onConflict: 'key' });
    if (error) throw new Error(`Error updating setting ${key}: ` + error.message);
  }
}

module.exports = { getSettings, updateSettings };

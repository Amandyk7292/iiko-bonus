function getTierInfo(totalSpent, settings) {
  const spent = Number(totalSpent) || 0;
  const numeric = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const bronzeCb = numeric(settings.base_cashback_percent, 3);
  const silverTh = numeric(settings.tier_silver_th, 50000);
  const silverCb = numeric(settings.tier_silver_cb, 5);
  const goldTh = numeric(settings.tier_gold_th, 150000);
  const goldCb = numeric(settings.tier_gold_cb, 7);
  const platinumTh = numeric(settings.tier_platinum_th, 300000);
  const platinumCb = numeric(settings.tier_platinum_cb, 10);

  const allTiers = [
    { name: 'Бронза', percent: bronzeCb, threshold: 0 },
    { name: 'Серебро', percent: silverCb, threshold: silverTh },
    { name: 'Золото', percent: goldCb, threshold: goldTh },
    { name: 'Платина', percent: platinumCb, threshold: platinumTh },
  ];

  if (spent >= platinumTh) {
    return {
      name: 'Платина',
      percent: platinumCb,
      nextTier: null,
      nextTh: null,
      remaining: 0,
      progress: 100,
      level: 4,
      allTiers,
    };
  } else if (spent >= goldTh) {
    return {
      name: 'Золото',
      percent: goldCb,
      nextTier: 'Платина',
      nextTh: platinumTh,
      remaining: Math.max(0, platinumTh - spent),
      progress: Math.min(100, Math.round((spent / platinumTh) * 100)),
      level: 3,
      allTiers,
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
      allTiers,
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
      allTiers,
    };
  }
}
module.exports = { getTierInfo };

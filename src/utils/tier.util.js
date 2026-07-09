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
module.exports = { getTierInfo };

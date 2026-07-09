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
module.exports = { getTierInfo };

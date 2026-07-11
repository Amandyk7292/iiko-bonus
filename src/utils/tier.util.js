const LEGACY_TIER_TRANSLATIONS = {
  bronze: {
    names: { ru: 'Бронза', kk: 'Қола', en: 'Bronze' },
    descriptions: {
      ru: 'Стартовый уровень программы лояльности',
      kk: 'Адалдық бағдарламасының бастапқы деңгейі',
      en: 'Starting loyalty level',
    },
  },
  silver: {
    names: { ru: 'Серебро', kk: 'Күміс', en: 'Silver' },
    descriptions: {
      ru: 'Повышенный кэшбэк для постоянных гостей',
      kk: 'Тұрақты қонақтарға арналған жоғары кэшбэк',
      en: 'Increased cashback for returning guests',
    },
  },
  gold: {
    names: { ru: 'Золото', kk: 'Алтын', en: 'Gold' },
    descriptions: {
      ru: 'Высокий кэшбэк для лояльных гостей',
      kk: 'Адал қонақтарға арналған жоғары кэшбэк',
      en: 'High cashback for loyal guests',
    },
  },
  platinum: {
    names: { ru: 'Платина', kk: 'Платина', en: 'Platinum' },
    descriptions: {
      ru: 'Максимальный кэшбэк для самых преданных гостей',
      kk: 'Ең адал қонақтарға арналған ең жоғары кэшбэк',
      en: 'Maximum cashback for the most loyal guests',
    },
  },
};

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildLegacyTiers(settings = {}) {
  const definitions = [
    ['bronze', 0, settings.base_cashback_percent, 0],
    ['silver', settings.tier_silver_th, settings.tier_silver_cb, 1],
    ['gold', settings.tier_gold_th, settings.tier_gold_cb, 2],
    ['platinum', settings.tier_platinum_th, settings.tier_platinum_cb, 3],
  ];
  const defaults = [
    ['bronze', 0, 3, 0],
    ['silver', 50000, 5, 1],
    ['gold', 150000, 7, 2],
    ['platinum', 300000, 10, 3],
  ];

  return definitions.map(([code, threshold, percent, sortOrder], index) => {
    const fallback = defaults[index];
    const translation = LEGACY_TIER_TRANSLATIONS[code];
    return {
      id: null,
      code,
      names: { ...translation.names },
      descriptions: { ...translation.descriptions },
      minSpend: Math.max(0, finiteNumber(threshold, fallback[1])),
      cashbackPercent: Math.min(100, Math.max(0, finiteNumber(percent, fallback[2]))),
      sortOrder,
      isActive: true,
      source: 'legacy',
    };
  });
}

function normalizeTier(tier, index = 0) {
  const names = {
    ru: String(tier?.names?.ru ?? tier?.name_ru ?? tier?.nameRu ?? tier?.name ?? '').trim(),
    kk: String(
      tier?.names?.kk ?? tier?.names?.kz ?? tier?.name_kk ?? tier?.name_kz ?? tier?.nameKk ?? '',
    ).trim(),
    en: String(tier?.names?.en ?? tier?.name_en ?? tier?.nameEn ?? '').trim(),
  };
  const descriptions = {
    ru: String(
      tier?.descriptions?.ru ?? tier?.description_ru ?? tier?.descriptionRu ?? names.ru,
    ).trim(),
    kk: String(
      tier?.descriptions?.kk ??
        tier?.descriptions?.kz ??
        tier?.description_kk ??
        tier?.description_kz ??
        tier?.descriptionKk ??
        names.kk,
    ).trim(),
    en: String(
      tier?.descriptions?.en ?? tier?.description_en ?? tier?.descriptionEn ?? names.en,
    ).trim(),
  };
  const code = String(tier?.code || `tier-${index + 1}`)
    .trim()
    .toLowerCase();

  if (!names.ru) names.ru = code;
  if (!names.kk) names.kk = names.ru;
  if (!names.en) names.en = names.ru;
  if (!descriptions.ru) descriptions.ru = names.ru;
  if (!descriptions.kk) descriptions.kk = names.kk;
  if (!descriptions.en) descriptions.en = names.en;

  return {
    id: tier?.id || null,
    code,
    names,
    descriptions,
    minSpend: Math.max(0, finiteNumber(tier?.minSpend ?? tier?.min_spend ?? tier?.threshold, 0)),
    cashbackPercent: Math.min(
      100,
      Math.max(
        0,
        finiteNumber(tier?.cashbackPercent ?? tier?.cashback_percent ?? tier?.percent, 0),
      ),
    ),
    sortOrder: Math.max(0, Math.trunc(finiteNumber(tier?.sortOrder ?? tier?.sort_order, index))),
    isActive: tier?.isActive ?? tier?.is_active ?? true,
    source: tier?.source || 'database',
  };
}

function normalizeTiers(tiers, fallbackSettings = {}) {
  const source =
    Array.isArray(tiers) && tiers.length > 0 ? tiers : buildLegacyTiers(fallbackSettings);
  const sorted = source
    .map(normalizeTier)
    .filter((tier) => tier.isActive !== false)
    .sort((left, right) => left.minSpend - right.minSpend || left.sortOrder - right.sortOrder);
  return sorted.reduce((result, tier) => {
    if (result.at(-1)?.minSpend === tier.minSpend) result[result.length - 1] = tier;
    else result.push(tier);
    return result;
  }, []);
}

function getTierInfo(totalSpent, tiersOrSettings = {}, fallbackSettings = {}) {
  const tiers = Array.isArray(tiersOrSettings)
    ? normalizeTiers(tiersOrSettings, fallbackSettings)
    : normalizeTiers(null, tiersOrSettings);
  const spent = Math.max(0, finiteNumber(totalSpent, 0));

  let currentIndex = 0;
  for (let index = 0; index < tiers.length; index += 1) {
    if (spent >= tiers[index].minSpend) currentIndex = index;
    else break;
  }

  const current = tiers[currentIndex];
  const next = tiers[currentIndex + 1] || null;
  const rangeSize = next ? Math.max(0.01, next.minSpend - current.minSpend) : 0;
  const progress = next
    ? Math.min(100, Math.max(0, Math.round(((spent - current.minSpend) / rangeSize) * 100)))
    : 100;
  const overallProgress = next
    ? Math.min(100, Math.max(0, Math.round((spent / next.minSpend) * 100)))
    : 100;
  const allTiers = tiers.map((tier) => ({
    ...tier,
    name: tier.names.ru,
    percent: tier.cashbackPercent,
    threshold: tier.minSpend,
  }));

  return {
    ...current,
    name: current.names.ru,
    percent: current.cashbackPercent,
    threshold: current.minSpend,
    nextTier: next?.names.ru || null,
    nextTierInfo: next
      ? {
          ...next,
          name: next.names.ru,
          percent: next.cashbackPercent,
          threshold: next.minSpend,
        }
      : null,
    nextTh: next?.minSpend ?? null,
    remaining: next ? Math.max(0, Number((next.minSpend - spent).toFixed(2))) : 0,
    progress,
    overallProgress,
    level: currentIndex + 1,
    currentSpend: spent,
    allTiers,
  };
}

function localizeTier(tier, language = 'ru') {
  const locale = language === 'kz' ? 'kk' : language;
  const normalized = normalizeTier(tier);
  return {
    ...normalized,
    name: normalized.names[locale] || normalized.names.ru,
    description: normalized.descriptions[locale] || normalized.descriptions.ru,
  };
}

module.exports = {
  LEGACY_TIER_TRANSLATIONS,
  buildLegacyTiers,
  getTierInfo,
  localizeTier,
  normalizeTier,
  normalizeTiers,
};

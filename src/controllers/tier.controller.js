const { getSettings } = require('../services/settings.service');
const {
  createLoyaltyTier,
  deleteLoyaltyTier,
  getActiveLoyaltyTiers,
  listLoyaltyTiers,
  normalizeLanguage,
  reorderLoyaltyTiers,
  setLoyaltyTierActive,
  toPublicTier,
  updateLoyaltyTier,
} = require('../services/tier.service');
const { getTierInfo } = require('../utils/tier.util');
const { getCustomerById } = require('../services/customer.service');

function sendTierError(res, error) {
  const status = Number(error?.statusCode || 500);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  if (safeStatus >= 500) console.error('Loyalty tier operation failed:', error);
  return res.status(safeStatus).json({
    success: false,
    error: safeStatus >= 500 ? 'Could not process loyalty tiers' : error.message,
    code: error?.code || (safeStatus >= 500 ? 'TIER_INTERNAL_ERROR' : 'TIER_REQUEST_ERROR'),
    ...(safeStatus < 500 && error?.details ? { details: error.details } : {}),
  });
}

async function listAdminTiers(req, res) {
  try {
    const tiers = await listLoyaltyTiers();
    res.json({ success: true, tiers });
  } catch (error) {
    sendTierError(res, error);
  }
}

async function createAdminTier(req, res) {
  try {
    const tier = await createLoyaltyTier(req.body);
    res.status(201).json({ success: true, tier });
  } catch (error) {
    sendTierError(res, error);
  }
}

async function updateAdminTier(req, res) {
  try {
    const tier = await updateLoyaltyTier(req.params.id, req.body);
    res.json({ success: true, tier });
  } catch (error) {
    sendTierError(res, error);
  }
}

async function deleteAdminTier(req, res) {
  try {
    const tier = await deleteLoyaltyTier(req.params.id);
    res.json({ success: true, tier });
  } catch (error) {
    sendTierError(res, error);
  }
}

async function reorderAdminTiers(req, res) {
  try {
    const tiers = await reorderLoyaltyTiers(req.body?.ids);
    res.json({ success: true, tiers });
  } catch (error) {
    sendTierError(res, error);
  }
}

async function setAdminTierActive(req, res) {
  try {
    const tier = await setLoyaltyTierActive(req.params.id, req.body?.isActive);
    res.json({ success: true, tier });
  } catch (error) {
    sendTierError(res, error);
  }
}

async function listPublicTiers(req, res) {
  try {
    const language = normalizeLanguage(req.query?.lang || req.query?.language || 'ru');
    const settings = await getSettings();
    const tiers = await getActiveLoyaltyTiers(settings);
    res.json({
      success: true,
      language,
      tiers: tiers
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder || left.minSpend - right.minSpend)
        .map((tier) => toPublicTier(tier, language)),
    });
  } catch (error) {
    sendTierError(res, error);
  }
}

async function getCustomerLoyalty(req, res) {
  try {
    const customer = await getCustomerById(req.customerAuth.id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found',
        code: 'CUSTOMER_NOT_FOUND',
      });
    }
    const language = normalizeLanguage(req.query?.lang || req.query?.language || 'ru');
    const settings = await getSettings();
    const tiers = await getActiveLoyaltyTiers(settings);
    const tier = getTierInfo(customer.total_spent, tiers, settings);
    const localizedCurrent = toPublicTier(tier, language);
    const localizedNext = tier.nextTierInfo ? toPublicTier(tier.nextTierInfo, language) : null;

    res.json({
      success: true,
      loyalty: {
        currentTier: localizedCurrent,
        nextTier: localizedNext,
        cashbackPercent: tier.percent,
        totalSpent: tier.currentSpend,
        remaining: tier.remaining,
        progress: tier.progress,
        overallProgress: tier.overallProgress,
        level: tier.level,
      },
    });
  } catch (error) {
    sendTierError(res, error);
  }
}

module.exports = {
  createAdminTier,
  deleteAdminTier,
  getCustomerLoyalty,
  listAdminTiers,
  listPublicTiers,
  reorderAdminTiers,
  sendTierError,
  setAdminTierActive,
  updateAdminTier,
};

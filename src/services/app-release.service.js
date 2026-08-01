const { getSettings } = require('./settings.service');

const versionPattern = /^\d{1,5}(?:\.\d{1,5}){1,3}$/;

const defaultPolicies = {
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
};

function normalizeVersion(value, fallback) {
  const version = String(value || '').trim();
  return versionPattern.test(version) ? version : fallback;
}

function normalizeStoreUrl(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function normalizeAppReleasePolicy(platform, settings = {}) {
  const normalizedPlatform = platform === 'ios' ? 'ios' : 'android';
  const fallback = defaultPolicies[normalizedPlatform];
  const configured = settings?.app_release_policy?.[normalizedPlatform] || {};
  return {
    platform: normalizedPlatform,
    latestVersion: normalizeVersion(configured.latest_version, fallback.latest_version),
    minimumVersion: normalizeVersion(configured.minimum_version, fallback.minimum_version),
    storeUrl: normalizeStoreUrl(configured.store_url, fallback.store_url),
  };
}

async function getAppReleasePolicy(platform) {
  return normalizeAppReleasePolicy(platform, await getSettings());
}

module.exports = {
  getAppReleasePolicy,
  normalizeAppReleasePolicy,
};

const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('../config/logger');
const {
  FALLBACK_TAPLINK_DOCUMENT,
  getPublicTaplink,
  publicDocument,
} = require('./taplink.service');

const TAPLINK_ORIGIN = 'https://bulka.com.kz';
const LOCALE_CODES = Object.freeze({ kk: 'kk_KZ', ru: 'ru_KZ' });
const TAPLINK_HTML_CONFIG_TTL_MS = 60_000;
const TAPLINK_HTML_FAILURE_TTL_MS = 15_000;
const TAPLINK_HTML_STALE_DEADLINE_MS = 150;
const TAPLINK_HTML_COLD_DEADLINE_MS = 1_500;
const TAPLINK_HTML_REFRESH_TIMEOUT_MS = 1_500;
const taplinkTemplate = fs.readFileSync(
  path.join(process.cwd(), 'public', 'taplink', 'index.html'),
  'utf8',
);
let taplinkHtmlConfig = publicDocument(FALLBACK_TAPLINK_DOCUMENT);
let taplinkHtmlConfigExpiresAt = 0;
let taplinkHtmlRefreshPromise = null;
let initialRefreshSettled = false;
let taplinkHtmlConfigGeneration = 0;
let taplinkHtmlPublishedRevision = 0;

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const replaceMetaContent = (html, marker, value) => {
  const pattern = new RegExp(
    `(<meta\\b(?=[^>]*data-taplink-meta="${marker}")[^>]*\\bcontent=")[^"]*(")`,
    'u',
  );
  return html.replace(pattern, (_match, prefix, suffix) => {
    return `${prefix}${escapeHtml(value)}${suffix}`;
  });
};

const absoluteUrl = (value) => {
  if (!String(value || '').trim()) return '';
  try {
    return new URL(String(value), TAPLINK_ORIGIN).href;
  } catch {
    return '';
  }
};

const renderTaplinkHtml = (template, config) => {
  const locale = config.enabledLocales.includes(config.defaultLocale)
    ? config.defaultLocale
    : config.enabledLocales[0];
  const alternateLocale = config.enabledLocales.find((candidate) => candidate !== locale);
  const title = config.seo.title[locale];
  const description = config.seo.description[locale];
  const image = config.seo.ogImageUrl || config.profile.logoUrl || '';

  let html = String(template);
  html = html.replace(
    /(<html\b[^>]*\blang=")[^"]*(")/u,
    (_match, prefix, suffix) => `${prefix}${escapeHtml(locale)}${suffix}`,
  );
  html = replaceMetaContent(html, 'description', description);
  html = replaceMetaContent(html, 'og-locale', LOCALE_CODES[locale] || '');
  html = replaceMetaContent(
    html,
    'og-locale-alternate',
    alternateLocale ? LOCALE_CODES[alternateLocale] || '' : '',
  );
  html = replaceMetaContent(html, 'og-title', title);
  html = replaceMetaContent(html, 'og-description', description);
  html = replaceMetaContent(html, 'og-image', absoluteUrl(image));
  html = html.replace(
    /<title\b[^>]*data-taplink-meta="title"[^>]*>[\s\S]*?<\/title>/u,
    `<title data-taplink-meta="title">${escapeHtml(title)}</title>`,
  );
  return html;
};

const refreshTaplinkHtmlConfig = () => {
  if (taplinkHtmlRefreshPromise) return taplinkHtmlRefreshPromise;
  const abortController = new AbortController();
  const refreshGeneration = taplinkHtmlConfigGeneration;
  const abortTimer = setTimeout(() => abortController.abort(), TAPLINK_HTML_REFRESH_TIMEOUT_MS);
  abortTimer.unref?.();
  taplinkHtmlRefreshPromise = getPublicTaplink({ signal: abortController.signal })
    .then((page) => {
      if (refreshGeneration !== taplinkHtmlConfigGeneration) return;
      const revision = Number(page.revision) || 0;
      if (revision < taplinkHtmlPublishedRevision) return;
      taplinkHtmlConfig = page.config;
      taplinkHtmlPublishedRevision = revision;
      taplinkHtmlConfigExpiresAt = Date.now() + TAPLINK_HTML_CONFIG_TTL_MS;
    })
    .catch((error) => {
      if (refreshGeneration !== taplinkHtmlConfigGeneration) return;
      taplinkHtmlConfigExpiresAt = Date.now() + TAPLINK_HTML_FAILURE_TTL_MS;
      logger.warn(
        { err: error, event: 'taplink_html_config_fallback' },
        'Taplink HTML metadata fallback used',
      );
    })
    .finally(() => {
      clearTimeout(abortTimer);
      initialRefreshSettled = true;
      taplinkHtmlRefreshPromise = null;
    });
  return taplinkHtmlRefreshPromise;
};

const waitForRefreshDeadline = async (refresh, timeoutMs) => {
  let deadline;
  try {
    await Promise.race([
      refresh,
      new Promise((resolve) => {
        deadline = setTimeout(resolve, timeoutMs);
        deadline.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
};

const getCachedTaplinkHtmlConfig = async () => {
  if (Date.now() < taplinkHtmlConfigExpiresAt) return taplinkHtmlConfig;
  const refresh = refreshTaplinkHtmlConfig();
  await waitForRefreshDeadline(
    refresh,
    initialRefreshSettled ? TAPLINK_HTML_STALE_DEADLINE_MS : TAPLINK_HTML_COLD_DEADLINE_MS,
  );
  return taplinkHtmlConfig;
};

const primeTaplinkHtmlConfig = (config, publishedRevision = 0) => {
  const revision = Number(publishedRevision) || 0;
  if (revision < taplinkHtmlPublishedRevision) return false;
  taplinkHtmlConfigGeneration += 1;
  taplinkHtmlConfig = publicDocument(config);
  taplinkHtmlPublishedRevision = revision;
  taplinkHtmlConfigExpiresAt = Date.now() + TAPLINK_HTML_CONFIG_TTL_MS;
  initialRefreshSettled = true;
  return true;
};

const renderCachedTaplinkHtml = async () =>
  renderTaplinkHtml(taplinkTemplate, await getCachedTaplinkHtmlConfig());

module.exports = {
  getCachedTaplinkHtmlConfig,
  primeTaplinkHtmlConfig,
  refreshTaplinkHtmlConfig,
  renderCachedTaplinkHtml,
  renderTaplinkHtml,
};

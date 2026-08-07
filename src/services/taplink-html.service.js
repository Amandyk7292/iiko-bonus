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
const BRAND_BACKGROUND_IMAGE_URL = '/taplink/assets/mobile-background.png?v=20260806-1';
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const LOCAL_ASSET_PATTERN = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+$/u;
const BACKGROUND_MODES = new Set(['brand', 'solid', 'gradient', 'image']);
const BUTTON_STYLES = new Set(['soft', 'outlined', 'solid']);
const ENTRANCE_ANIMATIONS = new Set(['none', 'fade', 'rise', 'stagger']);
const BUTTON_EFFECTS = new Set(['none', 'lift', 'glow', 'shine']);
const GRADIENT_DIRECTIONS = new Map([
  ['top', 0],
  ['top-right', 45],
  ['right', 90],
  ['bottom-right', 135],
  ['bottom', 180],
  ['bottom-left', 225],
  ['left', 270],
  ['top-left', 315],
]);
const GRADIENT_DIRECTION_NAMES = new Set(GRADIENT_DIRECTIONS.keys());
const NORMALIZED_FALLBACK_TAPLINK_DOCUMENT = publicDocument(FALLBACK_TAPLINK_DOCUMENT);
const THEME_DEFAULTS = Object.freeze({ ...NORMALIZED_FALLBACK_TAPLINK_DOCUMENT.theme });
const TAPLINK_HTML_CONFIG_TTL_MS = 60_000;
const TAPLINK_HTML_FAILURE_TTL_MS = 15_000;
const TAPLINK_HTML_STALE_DEADLINE_MS = 150;
const TAPLINK_HTML_COLD_DEADLINE_MS = 1_500;
const TAPLINK_HTML_REFRESH_TIMEOUT_MS = 1_500;
const taplinkTemplate = fs.readFileSync(
  path.join(process.cwd(), 'public', 'taplink', 'index.html'),
  'utf8',
);
let taplinkHtmlConfig = NORMALIZED_FALLBACK_TAPLINK_DOCUMENT;
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

const safeHexColor = (value, fallback) =>
  HEX_COLOR_PATTERN.test(String(value || '')) ? String(value).toUpperCase() : fallback;

const safeEnum = (value, allowed, fallback) => (allowed.has(value) ? value : fallback);

const safeInteger = (value, minimum, maximum, fallback) =>
  Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;

const safeCanonicalAssetUrl = (value) => {
  const text = String(value || '').trim();
  if (
    !text ||
    text.length > 2_000 ||
    [...text].some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return '';
  }
  try {
    const url = LOCAL_ASSET_PATTERN.test(text) ? new URL(text, TAPLINK_ORIGIN) : new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
};

const hexToRgba = (hexColor, opacity) => {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity.toFixed(3)})`;
};

const replaceMarkedAttribute = (html, marker, attribute, value) => {
  const tagPattern = new RegExp(
    `<([a-z][a-z0-9-]*)\\b(?=[^>]*\\bdata-taplink-theme="${marker}")[^>]*>`,
    'u',
  );
  return html.replace(tagPattern, (tag) => {
    const nextAttribute = ` ${attribute}="${escapeHtml(value)}"`;
    const attributePattern = new RegExp(`\\s${attribute}="[^"]*"`, 'u');
    return attributePattern.test(tag)
      ? tag.replace(attributePattern, nextAttribute)
      : tag.replace(/>$/u, `${nextAttribute}>`);
  });
};

const taplinkThemePresentation = (config) => {
  const source = config?.theme || {};
  const backgroundMode = safeEnum(
    source.backgroundMode,
    BACKGROUND_MODES,
    THEME_DEFAULTS.backgroundMode,
  );
  const gradientDirection = safeEnum(
    source.gradientDirection,
    GRADIENT_DIRECTION_NAMES,
    THEME_DEFAULTS.gradientDirection,
  );
  const backgroundColor = safeHexColor(source.backgroundColor, THEME_DEFAULTS.backgroundColor);
  const gradientFrom = safeHexColor(source.gradientFrom, THEME_DEFAULTS.gradientFrom);
  const gradientTo = safeHexColor(source.gradientTo, THEME_DEFAULTS.gradientTo);
  const overlayColor = safeHexColor(
    source.backgroundOverlayColor,
    THEME_DEFAULTS.backgroundOverlayColor,
  );
  const overlayOpacity = safeInteger(
    source.backgroundOverlayOpacity,
    0,
    70,
    THEME_DEFAULTS.backgroundOverlayOpacity,
  );
  const textColor = safeHexColor(source.textColor, THEME_DEFAULTS.textColor);
  const mutedTextColor = safeHexColor(source.mutedTextColor, THEME_DEFAULTS.mutedTextColor);
  const surfaceColor = safeHexColor(source.surfaceColor, THEME_DEFAULTS.surfaceColor);
  const buttonBackgroundColor = safeHexColor(
    source.buttonBackgroundColor,
    THEME_DEFAULTS.buttonBackgroundColor,
  );
  const buttonTextColor = safeHexColor(source.buttonTextColor, THEME_DEFAULTS.buttonTextColor);
  const primaryButtonBackgroundColor = safeHexColor(
    source.primaryButtonBackgroundColor,
    THEME_DEFAULTS.primaryButtonBackgroundColor,
  );
  const primaryButtonTextColor = safeHexColor(
    source.primaryButtonTextColor,
    THEME_DEFAULTS.primaryButtonTextColor,
  );
  const buttonStyle = safeEnum(source.buttonStyle, BUTTON_STYLES, THEME_DEFAULTS.buttonStyle);
  const animation = safeEnum(source.animation, ENTRANCE_ANIMATIONS, THEME_DEFAULTS.animation);
  const buttonEffect = safeEnum(source.buttonEffect, BUTTON_EFFECTS, THEME_DEFAULTS.buttonEffect);
  const radius = safeInteger(source.radius, 12, 32, THEME_DEFAULTS.radius);
  const configuredImageUrl = safeCanonicalAssetUrl(source.backgroundImageUrl);
  const backgroundImageUrl =
    configuredImageUrl ||
    (backgroundMode === 'brand' ? safeCanonicalAssetUrl(BRAND_BACKGROUND_IMAGE_URL) : '');
  const backgroundImage = backgroundImageUrl
    ? `url(${JSON.stringify(backgroundImageUrl)})`
    : 'none';

  return {
    backgroundClass: `taplink-background-${backgroundMode}`,
    profileClass: [
      'profile-card',
      `taplink-buttons-${buttonStyle}`,
      `taplink-animation-${animation}`,
      `taplink-effect-${buttonEffect}`,
    ].join(' '),
    themeColor: backgroundColor,
    style: [
      `--taplink-background-color: ${backgroundColor}`,
      `--taplink-gradient-from: ${gradientFrom}`,
      `--taplink-gradient-to: ${gradientTo}`,
      `--taplink-gradient-angle: ${GRADIENT_DIRECTIONS.get(gradientDirection)}deg`,
      `--taplink-background-overlay-color: ${hexToRgba(overlayColor, overlayOpacity / 100)}`,
      `--taplink-text-color: ${textColor}`,
      `--taplink-muted-text-color: ${mutedTextColor}`,
      `--taplink-surface-color: ${surfaceColor}`,
      `--taplink-surface-glass-color: ${hexToRgba(surfaceColor, 0.82)}`,
      `--taplink-button-background-color: ${buttonBackgroundColor}`,
      `--taplink-button-text-color: ${buttonTextColor}`,
      `--taplink-primary-button-background-color: ${primaryButtonBackgroundColor}`,
      `--taplink-primary-button-text-color: ${primaryButtonTextColor}`,
      `--taplink-button-glow-color: ${hexToRgba(primaryButtonBackgroundColor, 0.3)}`,
      `--taplink-background-image: ${backgroundImage}`,
      `--radius-control: ${radius}px`,
    ].join('; '),
  };
};

const renderTaplinkHtml = (template, config) => {
  const locale = config.enabledLocales.includes(config.defaultLocale)
    ? config.defaultLocale
    : config.enabledLocales[0];
  const alternateLocale = config.enabledLocales.find((candidate) => candidate !== locale);
  const title = config.seo.title[locale];
  const description = config.seo.description[locale];
  const image = config.seo.ogImageUrl || config.profile.logoUrl || '';
  const theme = taplinkThemePresentation(config);

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
  html = replaceMetaContent(html, 'theme-color', theme.themeColor);
  html = replaceMarkedAttribute(html, 'root', 'style', theme.style);
  html = replaceMarkedAttribute(html, 'body', 'class', theme.backgroundClass);
  html = replaceMarkedAttribute(html, 'profile', 'class', theme.profileClass);
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

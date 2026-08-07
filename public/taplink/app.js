(() => {
  'use strict';

  const STORAGE_KEY = 'bulka-taplink-language';
  const DEFAULT_LANGUAGE = 'kk';
  const PUBLIC_CONFIG_URL = '/api/public/taplink';
  const SUPPORTED_LANGUAGES = new Set(['kk', 'ru']);
  const BUTTON_STYLES = new Set(['soft', 'outlined', 'solid']);
  const LINK_STYLES = new Set(['primary', 'standard', 'city']);
  const ICONS = new Set([
    'phone',
    'whatsapp',
    '2gis',
    'instagram',
    'telegram',
    'globe',
    'location',
    'none',
  ]);
  const TARGET_TYPES = new Set(['whatsapp', 'phone', 'email', 'url']);
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const LOCAL_ASSET_PATTERN = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+$/u;
  const TWO_GIS_ICON_URL = '/taplink/assets/2gis-icon.png?v=20260806-1';
  const messages = {
    kk: {
      title: 'Bulka — жеткізу және мекенжайлар',
      metaDescription:
        'Bulka жеткізу қызметі және Ақтау мен Астанадағы отбасылық наубайхананың мекенжайлары.',
      ogDescription:
        'Жеткізуге тапсырыс беріңіз және ең жақын Bulka отбасылық наубайханасын табыңыз.',
      locale: 'kk_KZ',
      skipLinks: 'Сілтемелерге өту',
      brandAlt: 'Bulka — отбасылық наубайхана',
      languageSelector: 'Тілді таңдау',
      heading: 'Bulka жаныңызда',
      description: 'Күн сайын балғын пісірме, сүйікті дәмдер және ыңғайлы жеткізу.',
      usefulLinks: 'Bulka пайдалы сілтемелері',
      delivery: 'Жеткізуге тапсырыс беру',
      deliveryAria: 'WhatsApp арқылы Bulka жеткізуіне тапсырыс беру: +7 701 277 22 33',
      branches: '2GIS-тегі филиалдарымыз',
      aktauTitle: 'Bulka Ақтауда',
      aktauAria: '2GIS қолданбасында Ақтаудағы Bulka филиалдарын ашу',
      astanaTitle: 'Bulka Астанада',
      astanaAria: '2GIS қолданбасында Астанадағы Bulka филиалдарын ашу',
      routes: 'Мекенжайлар мен бағыттар',
      footer: 'Bulka отбасылық наубайханасы',
    },
    ru: {
      title: 'Bulka — доставка и адреса',
      metaDescription: 'Доставка Bulka и адреса семейной пекарни в Актау и Астане.',
      ogDescription: 'Заказать доставку и найти ближайшую семейную пекарню Bulka.',
      locale: 'ru_KZ',
      skipLinks: 'Перейти к ссылкам',
      brandAlt: 'Bulka — семейная пекарня',
      languageSelector: 'Выбор языка',
      heading: 'Bulka рядом',
      description: 'Свежая выпечка, любимые вкусы и удобная доставка каждый день.',
      usefulLinks: 'Полезные ссылки Bulka',
      delivery: 'Заказать доставку',
      deliveryAria: 'Заказать доставку Bulka в WhatsApp: +7 701 277 22 33',
      branches: 'Наши филиалы в 2GIS',
      aktauTitle: 'Bulka в Актау',
      aktauAria: 'Открыть филиалы Bulka в Актау в 2GIS',
      astanaTitle: 'Bulka в Астане',
      astanaAria: 'Открыть филиалы Bulka в Астане в 2GIS',
      routes: 'Адреса и маршруты',
      footer: 'Семейная пекарня Bulka',
    },
  };

  const profileCard = document.querySelector('.profile-card');
  const languageSwitch = document.getElementById('language-switch');
  const headerControls = document.getElementById('header-controls');
  const brandMark = document.getElementById('brand-mark');
  const pageTitle = document.getElementById('page-title');
  const profileDescription = document.getElementById('profile-description');
  const linkList = document.getElementById('links');
  const footerCopy = document.getElementById('profile-footer-copy');
  let publishedDocument = null;
  let currentLanguage = DEFAULT_LANGUAGE;

  const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  const hasExactKeys = (value, required, optional = []) => {
    if (!isRecord(value)) return false;
    const allowed = new Set([...required, ...optional]);
    return (
      required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
      Object.keys(value).every((key) => allowed.has(key))
    );
  };

  const isPlainText = (value, maximum, minimum = 1) =>
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[<>]/u.test(value);

  const isLocalizedText = (value, maximum, minimum = 1) =>
    hasExactKeys(value, ['kk', 'ru']) &&
    isPlainText(value.kk, maximum, minimum) &&
    isPlainText(value.ru, maximum, minimum);

  const hasControlCharacters = (value) =>
    [...String(value || '')].some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127;
    });

  const isSafeHttpsUrl = (value) => {
    if (typeof value !== 'string' || value !== value.trim() || hasControlCharacters(value)) {
      return false;
    }
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch (_error) {
      return false;
    }
  };

  const isSafeAssetUrl = (value) =>
    typeof value === 'string' &&
    value.length <= 2000 &&
    !hasControlCharacters(value) &&
    (LOCAL_ASSET_PATTERN.test(value) || isSafeHttpsUrl(value));

  const canonicalAssetUrl = (value) => (value.startsWith('/') ? value : new URL(value).href);

  const isSafeEmail = (value) =>
    typeof value === 'string' &&
    value === value.trim() &&
    value.length <= 254 &&
    !hasControlCharacters(value) &&
    /^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/u.test(value);

  const hrefForTarget = (target) => {
    if (!hasExactKeys(target, ['type', 'value']) || !TARGET_TYPES.has(target.type)) return null;
    if (target.type === 'whatsapp') {
      return /^\d{10,15}$/.test(target.value) ? `https://wa.me/${target.value}` : null;
    }
    if (target.type === 'phone') {
      if (
        typeof target.value !== 'string' ||
        target.value !== target.value.trim() ||
        target.value.length < 10 ||
        target.value.length > 24 ||
        !/^[+()\s0-9-]+$/.test(target.value)
      ) {
        return null;
      }
      const digits = target.value.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 15 ? `tel:+${digits}` : null;
    }
    if (target.type === 'email') {
      return isSafeEmail(target.value) ? `mailto:${target.value}` : null;
    }
    return isSafeHttpsUrl(target.value) ? target.value : null;
  };

  const isValidSectionBlock = (block) =>
    hasExactKeys(block, ['id', 'type', 'enabled', 'labels']) &&
    UUID_PATTERN.test(block.id) &&
    block.type === 'section' &&
    block.enabled === true &&
    isLocalizedText(block.labels, 120);

  const isValidLinkBlock = (block) => {
    if (
      !hasExactKeys(
        block,
        ['id', 'type', 'enabled', 'style', 'labels', 'icon', 'target', 'href'],
        ['subtitles', 'ariaLabels'],
      ) ||
      !UUID_PATTERN.test(block.id) ||
      block.type !== 'link' ||
      block.enabled !== true ||
      !LINK_STYLES.has(block.style) ||
      !ICONS.has(block.icon) ||
      !isLocalizedText(block.labels, 120) ||
      (block.subtitles !== undefined && !isLocalizedText(block.subtitles, 180, 0)) ||
      (block.ariaLabels !== undefined && !isLocalizedText(block.ariaLabels, 240, 0))
    ) {
      return false;
    }
    const expectedHref = hrefForTarget(block.target);
    return Boolean(expectedHref && block.href === expectedHref);
  };

  const validateTaplinkDocument = (documentValue) => {
    if (
      !hasExactKeys(documentValue, [
        'schemaVersion',
        'defaultLocale',
        'enabledLocales',
        'profile',
        'seo',
        'theme',
        'blocks',
      ]) ||
      documentValue.schemaVersion !== 1 ||
      !SUPPORTED_LANGUAGES.has(documentValue.defaultLocale) ||
      !Array.isArray(documentValue.enabledLocales) ||
      documentValue.enabledLocales.length < 1 ||
      documentValue.enabledLocales.length > 2 ||
      new Set(documentValue.enabledLocales).size !== documentValue.enabledLocales.length ||
      !documentValue.enabledLocales.every((locale) => SUPPORTED_LANGUAGES.has(locale)) ||
      !documentValue.enabledLocales.includes(documentValue.defaultLocale)
    ) {
      return null;
    }

    const { profile, seo, theme, blocks } = documentValue;
    if (
      !hasExactKeys(profile, ['title', 'description', 'footer'], ['logoUrl']) ||
      !isLocalizedText(profile.title, 120) ||
      !isLocalizedText(profile.description, 500) ||
      !isLocalizedText(profile.footer, 160) ||
      (profile.logoUrl !== undefined && !isSafeAssetUrl(profile.logoUrl)) ||
      !hasExactKeys(seo, ['title', 'description'], ['ogImageUrl']) ||
      !isLocalizedText(seo.title, 160) ||
      !isLocalizedText(seo.description, 500) ||
      (seo.ogImageUrl !== undefined && !isSafeAssetUrl(seo.ogImageUrl)) ||
      !hasExactKeys(theme, ['preset', 'buttonStyle', 'radius'], ['backgroundImageUrl']) ||
      theme.preset !== 'bulka' ||
      !BUTTON_STYLES.has(theme.buttonStyle) ||
      !Number.isInteger(theme.radius) ||
      theme.radius < 12 ||
      theme.radius > 32 ||
      (theme.backgroundImageUrl !== undefined && !isSafeAssetUrl(theme.backgroundImageUrl)) ||
      !Array.isArray(blocks) ||
      blocks.length > 40
    ) {
      return null;
    }

    const ids = new Set();
    for (const block of blocks) {
      if (
        ids.has(block?.id) ||
        (block?.type === 'section'
          ? !isValidSectionBlock(block)
          : block?.type === 'link'
            ? !isValidLinkBlock(block)
            : true)
      ) {
        return null;
      }
      ids.add(block.id);
    }

    const serialized = JSON.stringify(documentValue);
    if (
      typeof TextEncoder !== 'function' ||
      new TextEncoder().encode(serialized).byteLength > 256 * 1024
    ) {
      return null;
    }
    return documentValue;
  };

  const validatePublicPayload = (payload) => {
    if (
      !hasExactKeys(payload, ['success', 'page']) ||
      payload.success !== true ||
      !hasExactKeys(payload.page, ['slug', 'revision', 'config', 'publishedAt', 'source']) ||
      payload.page.slug !== 'main' ||
      !Number.isSafeInteger(payload.page.revision) ||
      payload.page.revision < 0 ||
      !['database', 'fallback'].includes(payload.page.source) ||
      !(
        payload.page.publishedAt === null ||
        (typeof payload.page.publishedAt === 'string' &&
          Number.isFinite(Date.parse(payload.page.publishedAt)))
      )
    ) {
      return null;
    }
    return validateTaplinkDocument(payload.page.config);
  };

  const readStoredLanguage = () => {
    const queryLanguage = new URLSearchParams(window.location.search).get('lang');
    if (SUPPORTED_LANGUAGES.has(queryLanguage)) return queryLanguage;
    try {
      const storedLanguage = window.localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED_LANGUAGES.has(storedLanguage)) return storedLanguage;
    } catch (_error) {
      // The default Kazakh copy remains fully usable when storage is unavailable.
    }
    return DEFAULT_LANGUAGE;
  };

  const updateMeta = (selector, attribute, value) => {
    const element = document.querySelector(selector);
    if (!element) return;
    if (value) element.setAttribute(attribute, value);
    else element.removeAttribute(attribute);
  };

  const updateLanguageButtons = (language) => {
    document.querySelectorAll('[data-language]').forEach((button) => {
      const isActive = button.dataset.language === language;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  };

  const createSvgNode = (tag, attributes) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
    return node;
  };

  const createSvg = (parts) => {
    const svg = createSvgNode('svg', {
      viewBox: '0 0 24 24',
      fill: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    parts.forEach(([tag, attributes]) => svg.append(createSvgNode(tag, attributes)));
    return svg;
  };

  const iconSvg = (icon) => {
    if (icon === 'phone') {
      return createSvg([
        [
          'path',
          {
            d: 'M7.1 3.4 9.4 3a1.5 1.5 0 0 1 1.7 1l1.1 3.2a1.5 1.5 0 0 1-.5 1.7l-1.6 1.2a13.2 13.2 0 0 0 3.8 3.8l1.2-1.6a1.5 1.5 0 0 1 1.7-.5l3.2 1.1a1.5 1.5 0 0 1 1 1.7l-.4 2.3a3 3 0 0 1-3 2.5A15 15 0 0 1 4.6 6.4a3 3 0 0 1 2.5-3Z',
          },
        ],
      ]);
    }
    if (icon === 'whatsapp') {
      return createSvg([
        ['path', { d: 'M20 11.7a8 8 0 0 1-11.8 7L4 20l1.3-4.1A8 8 0 1 1 20 11.7Z' }],
        [
          'path',
          {
            d: 'M8.4 8.1c.4 3.6 2 5.2 5.6 5.7l1.2-1.2 2 .9-.4 2c-5.4.8-9.8-3.6-9-9l2-.4.9 2-1.3 1Z',
          },
        ],
      ]);
    }
    if (icon === 'instagram') {
      return createSvg([
        ['rect', { x: '3.5', y: '3.5', width: '17', height: '17', rx: '5' }],
        ['circle', { cx: '12', cy: '12', r: '3.7' }],
        ['circle', { cx: '17.4', cy: '6.8', r: '0.8', fill: 'currentColor', stroke: 'none' }],
      ]);
    }
    if (icon === 'telegram') {
      return createSvg([
        ['path', { d: 'm3 11 17-7-4.2 16-5-4.2-3.2 2.4.6-5.2L17 7.1l-10.8 4.8L3 11Z' }],
      ]);
    }
    if (icon === 'globe') {
      return createSvg([
        ['circle', { cx: '12', cy: '12', r: '9' }],
        [
          'path',
          {
            d: 'M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9s-1.2 6.5-3.5 9c-2.3-2.5-3.5-5.5-3.5-9S9.7 5.5 12 3Z',
          },
        ],
      ]);
    }
    if (icon === 'location') {
      return createSvg([
        ['path', { d: 'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z' }],
        ['circle', { cx: '12', cy: '10', r: '2.5' }],
      ]);
    }
    return null;
  };

  const createLinkIcon = (block) => {
    if (block.icon === 'none') return null;
    const wrapper = document.createElement('span');
    wrapper.className = `link-icon${block.style === 'city' ? ' link-icon_city' : ''}`;
    wrapper.setAttribute('aria-hidden', 'true');
    if (block.icon === '2gis') {
      wrapper.classList.add('link-icon_2gis');
      const image = document.createElement('img');
      image.src = TWO_GIS_ICON_URL;
      image.width = 938;
      image.height = 938;
      image.alt = '';
      image.decoding = 'async';
      wrapper.append(image);
      return wrapper;
    }
    const svg = iconSvg(block.icon);
    if (svg) wrapper.append(svg);
    return wrapper;
  };

  const createArrow = (external) => {
    const wrapper = document.createElement('span');
    wrapper.className = external ? 'external-arrow' : 'link-arrow';
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.append(
      external
        ? createSvg([
            ['path', { d: 'M14 5h5v5' }],
            ['path', { d: 'm19 5-8 8' }],
            ['path', { d: 'M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }],
          ])
        : createSvg([['path', { d: 'm9 18 6-6-6-6' }]]),
    );
    return wrapper;
  };

  const createLinkBlock = (block, language) => {
    const link = document.createElement('a');
    link.className = `link-card link-card_${block.style} specular-surface`;
    if (block.icon === 'none') link.classList.add('link-card_no-icon');
    link.href = hrefForTarget(block.target);
    if (block.target.type === 'url' || block.target.type === 'whatsapp') {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    link.setAttribute('aria-label', block.ariaLabels?.[language] || block.labels[language]);

    const glow = document.createElement('span');
    glow.className = 'specular-glow';
    glow.setAttribute('aria-hidden', 'true');
    link.append(glow);

    const icon = createLinkIcon(block);
    if (icon) link.append(icon);

    const copy = document.createElement('span');
    copy.className = 'link-copy';
    const title = document.createElement('strong');
    title.textContent = block.labels[language];
    copy.append(title);
    const subtitleText = block.subtitles?.[language];
    if (subtitleText) {
      const subtitle = document.createElement('small');
      subtitle.textContent = subtitleText;
      copy.append(subtitle);
    }
    link.append(copy, createArrow(block.target.type === 'url'));
    return link;
  };

  const renderBlocks = (documentValue, language) => {
    if (!linkList) return;
    const fragment = document.createDocumentFragment();
    documentValue.blocks.forEach((block) => {
      if (block.type === 'section') {
        const label = document.createElement('p');
        label.className = 'section-label';
        label.textContent = block.labels[language];
        fragment.append(label);
      } else {
        fragment.append(createLinkBlock(block, language));
      }
    });
    linkList.replaceChildren(fragment);
    refreshSpecularSurfaces();
  };

  const renderLanguageControls = (documentValue) => {
    if (!languageSwitch || !headerControls) return;
    const fragment = document.createDocumentFragment();
    documentValue.enabledLocales.forEach((language) => {
      const button = document.createElement('button');
      button.className = 'language-button';
      button.type = 'button';
      button.dataset.language = language;
      button.lang = language;
      button.textContent = language === 'kk' ? 'ҚАЗ' : 'РУС';
      fragment.append(button);
    });
    languageSwitch.replaceChildren(fragment);
    headerControls.hidden = documentValue.enabledLocales.length < 2;
  };

  const renderLogo = (documentValue) => {
    if (!brandMark) return;
    if (!documentValue.profile.logoUrl) {
      const wordmark = document.createElement('strong');
      wordmark.className = 'brand-wordmark';
      wordmark.textContent = 'Bulka';
      brandMark.replaceChildren(wordmark);
      return;
    }
    const image = document.createElement('img');
    image.id = 'brand-logo';
    image.src = canonicalAssetUrl(documentValue.profile.logoUrl);
    image.alt = messages[currentLanguage].brandAlt;
    image.decoding = 'async';
    image.fetchPriority = 'high';
    image.addEventListener(
      'error',
      () => {
        if (image.parentNode !== brandMark) return;
        const wordmark = document.createElement('strong');
        wordmark.className = 'brand-wordmark';
        wordmark.textContent = 'Bulka';
        brandMark.replaceChildren(wordmark);
      },
      { once: true },
    );
    brandMark.replaceChildren(image);
  };

  const applyLanguage = (language, { persist = true } = {}) => {
    const availableLanguages = publishedDocument?.enabledLocales || [...SUPPORTED_LANGUAGES];
    const normalizedLanguage = availableLanguages.includes(language)
      ? language
      : publishedDocument?.defaultLocale || DEFAULT_LANGUAGE;
    const copy = messages[normalizedLanguage];
    currentLanguage = normalizedLanguage;

    document.documentElement.lang = normalizedLanguage;
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const value = copy[element.dataset.i18n];
      if (value) element.textContent = value;
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      const value = copy[element.dataset.i18nAriaLabel];
      if (value) element.setAttribute('aria-label', value);
    });
    document.querySelectorAll('[data-i18n-alt]').forEach((element) => {
      const value = copy[element.dataset.i18nAlt];
      if (value) element.setAttribute('alt', value);
    });

    document.title = copy.title;
    updateMeta('meta[name="description"]', 'content', copy.metaDescription);
    updateMeta('meta[property="og:title"]', 'content', copy.title);
    updateMeta('meta[property="og:description"]', 'content', copy.ogDescription);
    updateMeta('meta[property="og:locale"]', 'content', copy.locale);

    if (publishedDocument) {
      document.title = publishedDocument.seo.title[normalizedLanguage];
      if (pageTitle) pageTitle.textContent = publishedDocument.profile.title[normalizedLanguage];
      if (profileDescription) {
        profileDescription.textContent = publishedDocument.profile.description[normalizedLanguage];
      }
      if (footerCopy) footerCopy.textContent = publishedDocument.profile.footer[normalizedLanguage];
      updateMeta(
        'meta[name="description"]',
        'content',
        publishedDocument.seo.description[normalizedLanguage],
      );
      updateMeta(
        'meta[property="og:title"]',
        'content',
        publishedDocument.seo.title[normalizedLanguage],
      );
      updateMeta(
        'meta[property="og:description"]',
        'content',
        publishedDocument.seo.description[normalizedLanguage],
      );
      const alternateLanguage = publishedDocument.enabledLocales.find(
        (candidate) => candidate !== normalizedLanguage,
      );
      updateMeta(
        'meta[property="og:locale:alternate"]',
        'content',
        alternateLanguage ? messages[alternateLanguage].locale : '',
      );
      const logo = document.getElementById('brand-logo');
      if (logo) logo.setAttribute('alt', copy.brandAlt);
      renderBlocks(publishedDocument, normalizedLanguage);
    }

    updateLanguageButtons(normalizedLanguage);
    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, normalizedLanguage);
      } catch (_error) {
        // Language switching must still work in privacy mode.
      }
    }
  };

  const renderPublishedDocument = (documentValue) => {
    publishedDocument = documentValue;
    profileCard?.classList.remove(
      'taplink-buttons-soft',
      'taplink-buttons-outlined',
      'taplink-buttons-solid',
    );
    profileCard?.classList.add(`taplink-buttons-${documentValue.theme.buttonStyle}`);
    profileCard?.style.setProperty('--radius-control', `${documentValue.theme.radius}px`);

    const backgroundImage = documentValue.theme.backgroundImageUrl
      ? `url(${JSON.stringify(canonicalAssetUrl(documentValue.theme.backgroundImageUrl))})`
      : 'none';
    document.body.style.setProperty('--taplink-background-image', backgroundImage);
    updateMeta(
      'meta[property="og:image"]',
      'content',
      documentValue.seo.ogImageUrl ? canonicalAssetUrl(documentValue.seo.ogImageUrl) : '',
    );
    renderLogo(documentValue);
    renderLanguageControls(documentValue);
    applyLanguage(currentLanguage, { persist: false });
    profileCard?.setAttribute('data-config-source', 'published');
  };

  languageSwitch?.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-language]');
    if (button && languageSwitch.contains(button)) applyLanguage(button.dataset.language);
  });

  currentLanguage = readStoredLanguage();
  applyLanguage(currentLanguage, { persist: false });

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const PROXIMITY = 250;
  const FOLLOW_SPEED = 0.35;
  let states = [];
  let frameId = 0;

  function refreshSpecularSurfaces() {
    states = [...document.querySelectorAll('.specular-surface')].map((surface) => ({
      surface,
      currentX: surface.clientWidth / 2,
      currentY: surface.clientHeight / 2,
      targetX: surface.clientWidth / 2,
      targetY: surface.clientHeight / 2,
      currentOpacity: 0,
      targetOpacity: 0,
    }));
  }

  const renderSpecular = () => {
    let shouldContinue = false;
    states.forEach((state) => {
      state.currentX += (state.targetX - state.currentX) * FOLLOW_SPEED;
      state.currentY += (state.targetY - state.currentY) * FOLLOW_SPEED;
      state.currentOpacity += (state.targetOpacity - state.currentOpacity) * FOLLOW_SPEED;
      state.surface.style.setProperty('--specular-x', `${state.currentX.toFixed(2)}px`);
      state.surface.style.setProperty('--specular-y', `${state.currentY.toFixed(2)}px`);
      state.surface.style.setProperty(
        '--specular-opacity',
        Math.max(0, Math.min(1, state.currentOpacity)).toFixed(3),
      );
      shouldContinue ||= Math.abs(state.targetX - state.currentX) > 0.1;
      shouldContinue ||= Math.abs(state.targetY - state.currentY) > 0.1;
      shouldContinue ||= Math.abs(state.targetOpacity - state.currentOpacity) > 0.01;
    });
    frameId = shouldContinue ? window.requestAnimationFrame(renderSpecular) : 0;
  };

  const requestSpecularFrame = () => {
    if (!frameId) frameId = window.requestAnimationFrame(renderSpecular);
  };

  const hideSpecular = () => {
    states.forEach((state) => {
      state.targetOpacity = 0;
    });
    requestSpecularFrame();
  };

  const updateSpecularTargets = (event) => {
    if (reducedMotion.matches || !finePointer.matches || event.pointerType === 'touch') {
      hideSpecular();
      return;
    }
    states.forEach((state) => {
      const rect = state.surface.getBoundingClientRect();
      const closestX = Math.max(rect.left, Math.min(event.clientX, rect.right));
      const closestY = Math.max(rect.top, Math.min(event.clientY, rect.bottom));
      const distance = Math.hypot(event.clientX - closestX, event.clientY - closestY);
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      state.targetX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
      state.targetY = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
      state.targetOpacity = inside ? 1 : Math.max(0, 1 - distance / PROXIMITY) * 0.42;
    });
    requestSpecularFrame();
  };

  refreshSpecularSurfaces();
  window.addEventListener('pointermove', updateSpecularTargets, { passive: true });
  document.documentElement.addEventListener('pointerleave', hideSpecular, { passive: true });
  window.addEventListener('blur', hideSpecular);
  reducedMotion.addEventListener?.('change', hideSpecular);
  finePointer.addEventListener?.('change', hideSpecular);

  const loadPublishedTaplink = async () => {
    if (typeof window.fetch !== 'function') return;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = window.setTimeout(() => controller?.abort(), 6000);
    try {
      const options = {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      };
      if (controller) options.signal = controller.signal;
      const response = await window.fetch(PUBLIC_CONFIG_URL, options);
      if (!response.ok) return;
      const documentValue = validatePublicPayload(await response.json());
      if (documentValue) renderPublishedDocument(documentValue);
    } catch (_error) {
      // The complete static document intentionally remains visible and interactive.
    } finally {
      window.clearTimeout(timeout);
    }
  };

  void loadPublishedTaplink();
})();

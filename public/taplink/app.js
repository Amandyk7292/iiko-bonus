(() => {
  'use strict';

  const STORAGE_KEY = 'bulka-taplink-language';
  const DEFAULT_LANGUAGE = 'kk';
  const SUPPORTED_LANGUAGES = new Set(['kk', 'ru']);
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
      cities: 'Ақтау · Астана',
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
      cities: 'Актау · Астана',
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
    if (element) element.setAttribute(attribute, value);
  };

  const applyLanguage = (language, { persist = true } = {}) => {
    const normalizedLanguage = SUPPORTED_LANGUAGES.has(language)
      ? language
      : DEFAULT_LANGUAGE;
    const copy = messages[normalizedLanguage];

    document.documentElement.lang = normalizedLanguage;
    document.title = copy.title;
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
    document.querySelectorAll('[data-language]').forEach((button) => {
      const isActive = button.dataset.language === normalizedLanguage;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    updateMeta('meta[name="description"]', 'content', copy.metaDescription);
    updateMeta('meta[property="og:title"]', 'content', copy.title);
    updateMeta('meta[property="og:description"]', 'content', copy.ogDescription);
    updateMeta('meta[property="og:locale"]', 'content', copy.locale);

    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, normalizedLanguage);
      } catch (_error) {
        // Language switching must still work in privacy mode.
      }
    }
  };

  document.querySelectorAll('[data-language]').forEach((button) => {
    button.addEventListener('click', () => applyLanguage(button.dataset.language));
  });
  applyLanguage(readStoredLanguage(), { persist: false });

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const surfaces = [...document.querySelectorAll('.specular-surface')];
  const PROXIMITY = 250;
  const FOLLOW_SPEED = 0.35;
  let frameId = 0;

  const states = surfaces.map((surface) => ({
    surface,
    currentX: surface.clientWidth / 2,
    currentY: surface.clientHeight / 2,
    targetX: surface.clientWidth / 2,
    targetY: surface.clientHeight / 2,
    currentOpacity: 0,
    targetOpacity: 0,
  }));

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
      state.targetOpacity = inside
        ? 1
        : Math.max(0, 1 - distance / PROXIMITY) * 0.42;
    });
    requestSpecularFrame();
  };

  const hideSpecular = () => {
    states.forEach((state) => {
      state.targetOpacity = 0;
    });
    requestSpecularFrame();
  };

  window.addEventListener('pointermove', updateSpecularTargets, { passive: true });
  document.documentElement.addEventListener('pointerleave', hideSpecular, { passive: true });
  window.addEventListener('blur', hideSpecular);
  reducedMotion.addEventListener?.('change', hideSpecular);
  finePointer.addEventListener?.('change', hideSpecular);
})();

(() => {
  'use strict';

  const embeddedInApp = new URLSearchParams(window.location.search).get('embedded') === 'app';
  if (embeddedInApp) {
    document.documentElement.classList.add('embedded-app');
  }

  const copy = {
    ru: {
      title: 'Оплата картой',
      secure: 'Защищённая страница банка',
      loading: 'Открываем безопасную оплату',
      waiting: 'Не закрывайте страницу. Данные карты обрабатывает ForteBank.',
      verifying: 'Проверяем результат оплаты',
      error: 'Не удалось открыть оплату',
      errorHint: 'Вернитесь к заказу и попробуйте ещё раз.',
      back: 'Вернуться к заказам',
      close: 'Закрыть',
    },
    kk: {
      title: 'Картамен төлеу',
      secure: 'Банктің қорғалған беті',
      loading: 'Қауіпсіз төлемді ашып жатырмыз',
      waiting: 'Бетті жаппаңыз. Карта деректерін ForteBank өңдейді.',
      verifying: 'Төлем нәтижесін тексеріп жатырмыз',
      error: 'Төлемді ашу мүмкін болмады',
      errorHint: 'Тапсырысқа оралып, әрекетті қайталаңыз.',
      back: 'Тапсырыстарға оралу',
      close: 'Жабу',
    },
    en: {
      title: 'Card payment',
      secure: 'Secure bank page',
      loading: 'Opening secure payment',
      waiting: 'Keep this page open. Card details are processed by ForteBank.',
      verifying: 'Verifying payment result',
      error: 'Could not open payment',
      errorHint: 'Return to the order and try again.',
      back: 'Return to orders',
      close: 'Close',
    },
  };

  const setupCopy = {
    ru: {
      title: 'Добавление карты',
      loading: 'Открываем форму добавления карты',
      waiting: 'Банк временно спишет 30 ₸ для проверки и автоматически вернёт их.',
      verifying: 'Проверяем привязку карты',
      error: 'Не удалось открыть добавление карты',
      errorHint: 'Вернитесь к картам и проверьте результат или продолжите эту же привязку.',
      back: 'Вернуться к картам',
    },
    kk: {
      title: 'Карта қосу',
      loading: 'Карта қосу бетін ашып жатырмыз',
      waiting: 'Банк тексеру үшін уақытша 30 ₸ алып, автоматты түрде қайтарады.',
      verifying: 'Картаның байланыстырылуын тексеріп жатырмыз',
      error: 'Карта қосу бетін ашу мүмкін болмады',
      errorHint: 'Карталарға оралып, нәтижені тексеріңіз немесе байланыстыруды жалғастырыңыз.',
      back: 'Карталарға оралу',
    },
    en: {
      title: 'Link a card',
      loading: 'Opening card linking',
      waiting:
        'The bank will temporarily charge 30 ₸ for verification and refund it automatically.',
      verifying: 'Checking card linking',
      error: 'Could not open card linking',
      errorHint: 'Return to cards to check the result or resume this card linking.',
      back: 'Return to cards',
    },
  };

  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  let token = fragment.get('token') || '';
  const operationId = fragment.get('order') || query.get('operation') || '';
  const requestedLanguage = fragment.get('language') || query.get('language');
  const language = ['ru', 'kk', 'en'].includes(requestedLanguage) ? requestedLanguage : 'ru';
  let test = fragment.get('test') === '1';
  const purpose =
    (fragment.get('purpose') || query.get('purpose')) === 'card-setup' ? 'card-setup' : 'order';
  const operationPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const tokenPattern = /^[A-Za-z0-9._~-]{16,512}$/;
  const text = { ...copy[language], ...(purpose === 'card-setup' ? setupCopy[language] : {}) };
  const storageKey = `bulka-forte-checkout:${operationId}`;
  // Tab-scoped, short-lived checkout access; never a reusable saved-card token.
  // The non-secret operation reference also supports an authenticated recovery.
  const safeQuery = new URLSearchParams({ operation: operationId, purpose, language });
  if (embeddedInApp) safeQuery.set('embedded', 'app');

  window.history.replaceState(null, '', `${window.location.pathname}?${safeQuery}`);
  document.documentElement.lang = language;
  document.title = `${text.title} — Bulka`;

  const state = document.getElementById('payment-state');
  const title = document.getElementById('state-title');
  const message = document.getElementById('state-message');
  const backButton = document.getElementById('back-to-orders');
  const closeButton = document.getElementById('close-payment');

  document.getElementById('page-title').textContent = text.title;
  document.getElementById('secure-label').textContent = text.secure;
  closeButton.setAttribute('aria-label', text.close);
  title.textContent = text.loading;
  message.textContent = text.waiting;
  backButton.textContent = text.back;

  const returnUrl = (status) =>
    purpose === 'card-setup'
      ? !operationId
        ? '/profile'
        : `/profile?payment=forte&setup=${encodeURIComponent(
            operationId,
          )}&status=${encodeURIComponent(status)}`
      : !operationId
        ? '/orders'
        : `/orders?payment=forte&order=${encodeURIComponent(
            operationId,
          )}&status=${encodeURIComponent(status)}#customer-orders`;

  const leave = (status) => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage can be disabled. */
    }
    window.location.replace(returnUrl(status));
  };

  closeButton.addEventListener('click', () => leave('cancelled'));
  backButton.addEventListener('click', () => leave('returned'));

  let openTimeout;
  let widgetObserver;

  const stopWaiting = () => {
    window.clearTimeout(openTimeout);
    widgetObserver?.disconnect();
  };

  const showError = () => {
    stopWaiting();
    state.hidden = false;
    state.classList.add('error');
    title.textContent = text.error;
    message.textContent = text.errorHint;
    backButton.hidden = false;
  };

  if (!operationPattern.test(operationId)) {
    showError();
    return;
  }

  const finish = (status) => {
    if (status === 'redirected') return;
    if (status === 'successful' || status === 'pending') {
      title.textContent = text.verifying;
      message.textContent = text.waiting;
      window.setTimeout(() => leave(status), 450);
      return;
    }
    leave(status || 'cancelled');
  };

  const open = async () => {
    try {
      if (!tokenPattern.test(token)) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
          if (
            saved &&
            saved.expiresAt > Date.now() &&
            saved.purpose === purpose &&
            tokenPattern.test(saved.token)
          ) {
            token = saved.token;
            test = saved.test === true;
          }
        } catch {
          /* Fall back to the customer's authenticated operation. */
        }
        if (!tokenPattern.test(token)) {
          const path = purpose === 'card-setup' ? 'card-setup' : 'status';
          const response = await fetch(
            `/api/customer/forte-pay/${path}/${encodeURIComponent(operationId)}?resume=1&language=${language}`,
            { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000) },
          );
          if (!response.ok) throw new Error('Resume unavailable');
          const result = await response.json();
          if (['paid', 'failed', 'expired', 'refunded'].includes(result.paymentStatus)) {
            leave('returned');
            return;
          }
          const launch = new URL(result.redirectUrl, window.location.origin);
          if (
            launch.origin !== window.location.origin ||
            launch.pathname !== window.location.pathname
          )
            throw new Error('Invalid resume');
          const params = new URLSearchParams(launch.hash.slice(1));
          if (params.get('order') !== operationId) throw new Error('Different operation');
          token = params.get('token') || '';
          test = params.get('test') === '1';
        }
      }
      if (!tokenPattern.test(token)) throw new Error('Checkout unavailable');
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            token,
            purpose,
            test,
            expiresAt: saved?.token === token ? saved.expiresAt : Date.now() + 30 * 60 * 1000,
          }),
        );
      } catch {
        /* Server recovery remains available without storage. */
      }
      if (typeof window.BeGateway !== 'function') {
        showError();
        return;
      }
      const gateway = new window.BeGateway({
        checkout_url: 'https://securepayments.fortebank.com',
        fromWebview: true,
        checkout: {
          iframe: true,
          test,
          transaction_type: 'payment',
        },
        token,
        closeWidget: finish,
      });

      widgetObserver = new MutationObserver(() => {
        for (const frame of document.querySelectorAll('iframe')) {
          if (frame.dataset.bulkaWidgetObserved === 'true') continue;
          frame.dataset.bulkaWidgetObserved = 'true';
          frame.addEventListener(
            'load',
            () => {
              stopWaiting();
              state.hidden = true;
            },
            { once: true },
          );
        }
      });
      widgetObserver.observe(document.body, { childList: true, subtree: true });
      openTimeout = window.setTimeout(showError, 15000);

      const widgetResult = gateway.createWidget();
      if (widgetResult && typeof widgetResult.catch === 'function') {
        widgetResult.catch(showError);
      }
    } catch {
      showError();
    }
  };
  void open();
})();

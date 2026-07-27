(() => {
  'use strict';

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

  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = fragment.get('token') || '';
  const operationId = fragment.get('order') || '';
  const language = ['ru', 'kk', 'en'].includes(fragment.get('language'))
    ? fragment.get('language')
    : 'ru';
  const test = fragment.get('test') === '1';
  const purpose = fragment.get('purpose') === 'card-setup' ? 'card-setup' : 'order';
  const operationPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const tokenPattern = /^[A-Za-z0-9._~-]{16,512}$/;
  const text = copy[language];

  window.history.replaceState(null, '', window.location.pathname);
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
      ? `/profile?payment=forte&setup=${encodeURIComponent(
          operationId,
        )}&status=${encodeURIComponent(status)}`
      : `/orders?payment=forte&order=${encodeURIComponent(
          operationId,
        )}&status=${encodeURIComponent(status)}#customer-orders`;

  const leave = (status) => {
    window.location.replace(returnUrl(status));
  };

  closeButton.addEventListener('click', () => leave('cancelled'));
  backButton.addEventListener('click', () => leave('failed'));

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

  if (!tokenPattern.test(token) || !operationPattern.test(operationId)) {
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

  try {
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
})();

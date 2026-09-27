(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const branch = location.pathname.split('/').filter(Boolean)[1];
  const storageKey = 'bulka-branch-invite:' + branch;
  let phone = '',
    registrationToken = '',
    busy = false;
  const showError = (message) => {
    $('error').textContent = message;
    $('error').hidden = false;
  };
  async function request(path, body, token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        if (response.status === 429)
          throw new Error('Слишком много попыток. Подождите несколько минут.');
        if (response.status === 401) {
          registrationToken = '';
          throw new Error('Подтверждение истекло. Запросите новый код.');
        }
        throw new Error('Не удалось завершить запрос. Проверьте код или повторите позже.');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError)
        throw new Error(
          'Нет связи с сервером. Проверьте интернет и повторите — приглашение не потеряется.',
        );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    $('error').hidden = true;
    for (const id of ['start', 'verify', 'change']) $(id).disabled = true;
    try {
      await action();
    } catch (error) {
      showError(error.message);
    } finally {
      busy = false;
      for (const id of ['start', 'verify', 'change']) $(id).disabled = false;
    }
  }
  function clearPending() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Optional recovery storage. */
    }
  }
  function showCode(url) {
    $('phone-form').hidden = true;
    $('code-section').hidden = false;
    $('whatsapp').href = url;
  }
  $('phone-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void run(async () => {
      phone = $('phone').value.replace(/\D/g, '');
      if (phone.length === 11 && phone.startsWith('8')) phone = '7' + phone.slice(1);
      if (!/^7\d{10}$/.test(phone)) throw new Error('Введите номер Казахстана: +7 и ещё 10 цифр.');
      phone = '+' + phone;
      registrationToken = '';
      const token = Array.from(crypto.getRandomValues(new Uint8Array(20)), (n) =>
        n.toString(16).padStart(2, '0'),
      ).join('');
      const data = await request('/api/auth/request-otp', { phone, token });
      if (!/^https:\/\/wa\.me\//.test(data.whatsappUrl || ''))
        throw new Error('WhatsApp временно недоступен. Попробуйте позже.');
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ phone, url: data.whatsappUrl, expires: Date.now() + 600000 }),
        );
      } catch {
        /* Remain usable without storage. */
      }
      showCode(data.whatsappUrl);
    });
  });
  $('code-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void run(async () => {
      if (!registrationToken) {
        const data = await request('/api/auth/verify-otp', { phone, code: $('code').value });
        if (data.exists) {
          $('success').textContent =
            'У вас уже есть аккаунт Bulka. Войдите в приложение — повторная регистрация не нужна.';
          $('success').hidden = false;
          $('code-section').hidden = true;
          clearPending();
          return;
        }
        registrationToken = data.registrationToken;
        if (!registrationToken) throw new Error('Запросите новый код подтверждения.');
      }
      const data = await request('/api/branch-invites/' + branch + '/claim', {}, registrationToken);
      $('success').textContent =
        data.status === 'saved'
          ? 'Приглашение от «' +
            data.branchName +
            '» сохранено до ' +
            new Intl.DateTimeFormat('ru-KZ', { timeZone: 'Asia/Almaty' }).format(
              new Date(data.expiresAt),
            ) +
            '. Завершите регистрацию в приложении с этим же номером.'
          : 'Ваш аккаунт уже зарегистрирован. Войдите в приложение с этим номером.';
      $('success').hidden = false;
      $('code-section').hidden = true;
      clearPending();
      registrationToken = '';
    });
  });
  $('change').addEventListener('click', () => {
    registrationToken = '';
    clearPending();
    $('phone-form').hidden = false;
    $('code-section').hidden = true;
    $('code').value = '';
    $('phone').focus();
  });
  void run(async () => {
    const data = await request('/api/branch-invites/' + branch);
    $('branch').textContent = [data.branch.city, data.branch.name].filter(Boolean).join(' · ');
    $('phone-form').hidden = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey));
      if (saved?.expires > Date.now() && /^https:\/\/wa\.me\//.test(saved.url || '')) {
        phone = saved.phone;
        $('phone').value = phone;
        showCode(saved.url);
      } else clearPending();
    } catch {
      clearPending();
    }
  });
})();

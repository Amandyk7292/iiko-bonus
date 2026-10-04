(() => {
  'use strict';
  const fragment = window.location.hash;
  let resetToken = /^#reset=([a-f0-9]{64})$/.exec(fragment)?.[1] || '';
  window.history.replaceState(null, '', window.location.pathname);
  const $ = (id) => document.getElementById(id);
  const form = $('reset-form');
  const password = $('password');
  const confirmation = $('confirmation');
  const save = $('save');
  let busy = false;

  function invalidLink() {
    resetToken = '';
    form.reset();
    form.hidden = true;
    $('title').textContent = 'Ссылка недействительна';
    $('status').textContent = 'Запросите новую ссылку через «Забыли пароль?».';
    $('status').hidden = false;
    $('retry').hidden = false;
    $('check-again').hidden = true;
  }

  async function request(endpoint, body) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`/api/auth/password-reset/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) {
        const error = new Error('request_failed');
        error.code = data.code;
        throw error;
      }
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function validateLink() {
    if (!resetToken) return invalidLink();
    $('check-again').hidden = true;
    $('status').textContent = 'Проверяем ссылку…';
    try {
      await request('validate-link', { resetToken });
      $('status').hidden = true;
      form.hidden = false;
    } catch (error) {
      if (error.code === 'PASSWORD_RESET_LINK_INVALID') return invalidLink();
      $('status').textContent = 'Нет связи. Попробуйте ещё раз.';
      $('check-again').hidden = false;
    }
  }

  document.querySelectorAll('.reveal').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $(button.dataset.input);
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
      button
        .querySelector('use')
        ?.setAttribute(
          'href',
          '/assets/brand/bulka-icons.svg?v=bulka-premium-1#' + (visible ? 'EyeOff' : 'Eye'),
        );
    });
  });
  $('check-again').addEventListener('click', validateLink);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    $('error').hidden = true;
    password.removeAttribute('aria-invalid');
    confirmation.removeAttribute('aria-invalid');
    const value = password.value;
    let message = '';
    let invalidField = password;
    if (
      value.length < 8 ||
      new TextEncoder().encode(value).length > 72 ||
      !/\p{L}/u.test(value) ||
      !/\p{N}/u.test(value)
    ) {
      message = 'Используйте от 8 символов, буквы и цифры.';
    } else if (value !== confirmation.value) {
      message = 'Пароли не совпадают.';
      invalidField = confirmation;
    }
    if (message) {
      $('error').textContent = message;
      $('error').hidden = false;
      invalidField.setAttribute('aria-invalid', 'true');
      invalidField.focus();
      return;
    }
    busy = true;
    save.disabled = true;
    password.disabled = true;
    confirmation.disabled = true;
    document.querySelectorAll('.reveal').forEach((button) => {
      button.disabled = true;
    });
    save.textContent = 'Сохраняем…';
    try {
      await request('complete-link', { resetToken, password: value });
      resetToken = '';
      form.reset();
      form.hidden = true;
      $('title').textContent = 'Пароль сохранён';
      $('status').textContent = 'Теперь можно войти с новым паролем.';
      $('status').hidden = false;
      $('login').hidden = false;
    } catch (error) {
      if (error.code === 'PASSWORD_RESET_LINK_INVALID') {
        invalidLink();
      } else {
        $('error').textContent =
          error.code === 'INVALID_PASSWORD'
            ? 'Используйте от 8 символов, буквы и цифры.'
            : 'Не удалось сохранить. Проверьте интернет и повторите.';
        $('error').hidden = false;
      }
    } finally {
      busy = false;
      save.disabled = false;
      password.disabled = false;
      confirmation.disabled = false;
      document.querySelectorAll('.reveal').forEach((button) => {
        button.disabled = false;
      });
      save.textContent = 'Сохранить пароль';
    }
  });
  void validateLink();
})();

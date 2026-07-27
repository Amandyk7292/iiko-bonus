(() => {
  const root = document.querySelector('main');
  const phone = document.querySelector('#phone');
  const code = document.querySelector('#code');
  const requestButton = document.querySelector('#requestButton');
  const deleteButton = document.querySelector('#deleteButton');
  const phoneStep = document.querySelector('#phoneStep');
  const codeStep = document.querySelector('#codeStep');
  const whatsappLink = document.querySelector('#whatsappLink');
  const status = document.querySelector('#status');
  if (
    !root ||
    !phone ||
    !code ||
    !requestButton ||
    !deleteButton ||
    !phoneStep ||
    !codeStep ||
    !whatsappLink ||
    !status
  ) {
    return;
  }

  const token = Array.from(crypto.getRandomValues(new Uint8Array(18)), (value) =>
    value.toString(36),
  )
    .join('')
    .slice(0, 24);
  const copy = root.dataset;
  const show = (message, error = false) => {
    status.textContent = message;
    status.className = `status${error ? ' error' : ''}`;
  };
  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      throw new Error(body.message || body.error || copy.requestError);
    }
    return body;
  };

  requestButton.addEventListener('click', async () => {
    requestButton.disabled = true;
    try {
      const body = await api('/api/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({
          phone: phone.value,
          token,
          language: document.documentElement.lang,
        }),
      });
      if (body.whatsappUrl) {
        whatsappLink.href = body.whatsappUrl;
        whatsappLink.classList.remove('hidden');
      }
      phoneStep.classList.add('hidden');
      codeStep.classList.remove('hidden');
      show(copy.codeHint);
      code.focus();
    } catch (error) {
      show(error.message, true);
    } finally {
      requestButton.disabled = false;
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (!window.confirm(copy.confirm)) return;
    deleteButton.disabled = true;
    try {
      const session = await api('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.value, code: code.value }),
      });
      if (!session.exists || !session.accessToken) {
        throw new Error(copy.notFound);
      }
      await api('/api/customer/profile', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      codeStep.classList.add('hidden');
      show(copy.success);
    } catch (error) {
      show(error.message, true);
      deleteButton.disabled = false;
    }
  });
})();

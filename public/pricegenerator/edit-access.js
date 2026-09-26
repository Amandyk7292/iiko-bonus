(() => {
  const endpoint = '/admin/api/pricegenerator/access';
  const byId = (id) => document.getElementById(id);
  const dialog = byId('edit-access-dialog');
  const code = byId('edit-access-code');
  const error = byId('edit-access-error');
  function showAccess(access) {
    byId('edit-access-open').hidden = access.canEdit;
    byId('edit-access-lock').hidden = access.via !== 'code';
    byId('edit-access-status').hidden = !access.canEdit;
    byId('edit-access-status').textContent =
      access.via === 'admin' ? 'Вход администратора' : 'Редактирование по коду';
    return access;
  }
  window.BulkaPriceAccess = {
    async status() {
      try {
        const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' });
        if (response.ok) return showAccess(await response.json());
      } catch {
        /* Printing remains available if authentication is unavailable. */
      }
      return showAccess({ canEdit: false, via: null });
    },
  };
  byId('edit-access-open').addEventListener('click', () => {
    error.textContent = '';
    code.value = '';
    dialog.showModal();
    code.focus();
  });
  byId('edit-access-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    code.value = '';
  });
  byId('edit-access-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = byId('edit-access-submit');
    submit.disabled = true;
    error.textContent = '';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось открыть редактирование.');
      code.value = '';
      showAccess(data);
      dialog.close();
      window.dispatchEvent(new Event('pricegenerator-access-change'));
    } catch (caught) {
      error.textContent = caught.message || 'Проверьте подключение и повторите.';
    } finally {
      submit.disabled = false;
    }
  });
  byId('edit-access-lock').addEventListener('click', async () => {
    try {
      const response = await fetch(endpoint, { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) throw new Error();
      window.dispatchEvent(new Event('pricegenerator-access-change'));
    } catch {
      byId('edit-access-status').textContent = 'Не удалось выйти. Повторите попытку.';
    }
  });
})();

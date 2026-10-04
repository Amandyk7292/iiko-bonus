import { readDirectory, filterCashiers, qrImageUrl } from './directory.mjs';

const search = document.getElementById('search');
const city = document.getElementById('city');
const list = document.getElementById('list');
const status = document.getElementById('status');
const refresh = document.getElementById('refresh');
const dialog = document.getElementById('qr-dialog');
const image = document.getElementById('qr-image');
const save = document.getElementById('save-qr');
const copy = document.getElementById('copy-qr');
const qrError = document.getElementById('qr-error');
let items = [];
let current = null;
let request = 0;
let loading = false;
let failed = false;
let previousFocus = null;

function textElement(tag, className, value) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}
function closeDialog() {
  dialog.close();
  current = null;
  previousFocus?.focus();
}
function openQr(row, button) {
  current = row;
  previousFocus = button;
  document.getElementById('qr-title').textContent = row.name;
  document.getElementById('qr-point').textContent = [row.city, row.branchName].filter(Boolean).join(' · ');
  qrError.hidden = true;
  copy.textContent = 'Копировать ссылку';
  save.hidden = true;
  image.hidden = true;
  image.onload = () => { if (current === row) { image.hidden = false; save.hidden = false; } };
  image.onerror = () => { if (current === row) { qrError.hidden = false; save.hidden = true; } };
  image.src = qrImageUrl(row.inviteToken);
  save.href = image.src;
  save.download = `Bulka-QR-${row.id.replace(/[^a-z0-9-]/gi, '')}.png`;
  dialog.showModal();
}
function render() {
  const focusedId = document.activeElement?.getAttribute('data-cashier-id');
  let focusButton = null;
  list.replaceChildren();
  if ((loading || failed) && !items.length) return;
  const rows = filterCashiers(items, city.value, search.value);
  if (!failed) status.textContent = rows.length ? `Кассиры · ${rows.length}` : items.length ? 'Никого не нашли' : 'Кассиров пока нет';
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const card = textElement('article', 'cashier-card', '');
    const avatar = textElement('div', 'avatar', row.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('ru'));
    avatar.setAttribute('aria-hidden', 'true');
    const details = textElement('div', 'cashier-details', '');
    details.append(textElement('h2', '', row.name), textElement('p', 'point-name', row.branchName), textElement('span', 'city-pill', row.city));
    const button = textElement('button', 'qr-button', 'Мой QR');
    button.type = 'button';
    button.dataset.cashierId = row.id;
    button.setAttribute('aria-label', `Открыть QR: ${row.name}`);
    button.addEventListener('click', () => openQr(row, button));
    if (current?.id === row.id) previousFocus = button;
    if (focusedId === row.id) focusButton = button;
    card.append(avatar, details, button);
    fragment.append(card);
  }
  list.append(fragment);
  if (focusButton) focusButton.focus();
  else if (focusedId) search.focus();
}
async function load() {
  if (loading) return;
  const revision = ++request;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  loading = true;
  failed = false;
  refresh.disabled = true;
  list.setAttribute('aria-busy', 'true');
  if (!items.length) {
    status.textContent = 'Загружаем кассиров…';
    list.replaceChildren();
  }
  try {
    const response = await fetch('/api/public/cashier-invites', { signal: controller.signal, cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Список временно недоступен. Попробуйте обновить.');
    const result = await response.json();
    if (revision !== request) return;
    items = readDirectory(result);
    const selectedCity = city.value;
    city.replaceChildren(new Option('Все города', ''));
    [...new Set(items.map((row) => row.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')).forEach((name) => city.add(new Option(name, name)));
    if (selectedCity && !items.some((row) => row.city === selectedCity)) city.add(new Option(selectedCity, selectedCity));
    city.value = selectedCity;
    if (current) {
      const updated = items.find((row) => row.id === current.id);
      if (!updated || updated.inviteToken !== current.inviteToken) closeDialog();
      else {
        Object.assign(current, updated);
        document.getElementById('qr-title').textContent = current.name;
        document.getElementById('qr-point').textContent = [current.city, current.branchName].filter(Boolean).join(' · ');
      }
    }
  } catch {
    if (revision !== request) return;
    failed = true;
    status.textContent = 'Не удалось загрузить кассиров. Обновите список.';
  } finally {
    clearTimeout(timeout);
    if (revision === request) {
      loading = false;
      refresh.disabled = false;
      list.removeAttribute('aria-busy');
      render();
    }
  }
}
document.querySelector('form').addEventListener('submit', (event) => event.preventDefault());
search.addEventListener('input', render);
city.addEventListener('change', render);
refresh.addEventListener('click', load);
const reloadVisible = () => { if (document.visibilityState === 'visible') void load(); };
setInterval(reloadVisible, 60_000);
document.addEventListener('visibilitychange', reloadVisible);
window.addEventListener('focus', reloadVisible);
window.addEventListener('online', reloadVisible);
window.addEventListener('pageshow', (event) => { if (event.persisted) reloadVisible(); });
document.getElementById('close-dialog').addEventListener('click', closeDialog);
dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
dialog.addEventListener('cancel', () => { current = null; previousFocus?.focus(); });
copy.addEventListener('click', async () => {
  if (!current) return;
  const selected = current;
  try {
    const url = new URL('/cashier-register', location.origin);
    url.searchParams.set('cashier', selected.inviteToken);
    await navigator.clipboard.writeText(url.href);
    if (current === selected) copy.textContent = 'Ссылка скопирована';
  } catch {
    if (current === selected) copy.textContent = 'Не удалось скопировать';
  }
});
void load();

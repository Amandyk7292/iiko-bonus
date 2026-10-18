import { finalWheelRotation, publicPrizes, fortuneClaimLinks, publicDraw } from './wheel.mjs';

const $ = (id) => document.getElementById(id);
const parts = location.pathname.split('/').filter(Boolean);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const routeValid =
  parts.length === 3 && parts[0] === 'fortune' && uuid.test(parts[1]) && uuid.test(parts[2]);
const endpoint = routeValid ? `/api/fortune/${parts[1]}/${parts[2]}` : null;
const storageKey = `bulka-fortune:${parts[1]}:${parts[2]}`;
const prizesStorageKey = `${storageKey}:prizes`;
let previousPrizes = [];
try {
  const values = JSON.parse(sessionStorage.getItem(prizesStorageKey) || '[]');
  if (Array.isArray(values))
    previousPrizes = values.filter((value) => {
      try {
        fortuneClaimLinks(value.claimToken);
        return typeof value.label === 'string' && Date.parse(value.expiresAt) > Date.now();
      } catch {
        return false;
      }
    });
} catch {
  /* An unreadable history does not prevent participation. */
}
let prizes = [];
let receiptToken = null;
let rotation = 0;
let busy = false;
let retryAction = load;
let campaignTitle = 'Колесо подарков';
let branchName = 'Bulka';

function showError(error) {
  $('error').textContent = error?.message || 'Не удалось подключиться. Попробуйте ещё раз.';
  $('error').hidden = false;
}
function clearError() {
  $('error').hidden = true;
  $('error').textContent = '';
}
function saved() {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  } catch {
    return null;
  }
}
function remember(value) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    /* Current tab remains usable. */
  }
}
function renderPreviousPrizes(currentToken) {
  const links = previousPrizes
    .filter((value) => value.claimToken !== currentToken && Date.parse(value.expiresAt) > Date.now())
    .map((value) => {
      const link = document.createElement('a');
      link.className = 'button secondary';
      link.href = fortuneClaimLinks(value.claimToken).web;
      link.textContent = value.label;
      return link;
    });
  $('previous-prize-list').replaceChildren(...links);
  $('previous-prizes').hidden = links.length === 0;
}
function keepPrize(result) {
  if (result.win.prizeKind === 'none') return;
  if (!previousPrizes.some((value) => value.claimToken === result.claimToken))
    previousPrizes.push({
      claimToken: result.claimToken,
      label: result.win.prizeLabel,
      expiresAt: result.win.expiresAt,
    });
  try {
    sessionStorage.setItem(prizesStorageKey, JSON.stringify(previousPrizes));
  } catch {
    /* Keep links available in the current page if tab storage is full. */
  }
}
async function request(path, options) {
  const response = await fetch(path, { ...options, cache: 'no-store', credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false)
    throw Object.assign(new Error(result.error || 'Не удалось подключиться. Попробуйте ещё раз.'), {
      code: result.code,
    });
  return result;
}
function drawing(labelRotation = 0) {
  const canvas = $('wheel');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const radius = size / 2;
  const arc = (2 * Math.PI) / prizes.length;
  ctx.clearRect(0, 0, size, size);
  prizes.forEach((prize, index) => {
    const angle = -Math.PI / 2 + index * arc;
    ctx.beginPath();
    ctx.moveTo(radius, radius);
    ctx.arc(radius, radius, radius - 1, angle, angle + arc);
    ctx.closePath();
    ctx.fillStyle = prize.color;
    ctx.fill();
    ctx.strokeStyle = '#faf1e2';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.save();
    ctx.translate(radius, radius);
    const middle = angle + arc / 2;
    const distance = radius * 0.64;
    const upright = prizes.length <= 6;
    if (upright) {
      ctx.translate(Math.cos(middle) * distance, Math.sin(middle) * distance);
      ctx.rotate((-labelRotation * Math.PI) / 180);
    } else ctx.rotate(middle + (Math.cos(middle) < 0 ? Math.PI : 0));
    ctx.fillStyle = contrast(prize.color);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = prizes.length > 10 ? 20 : upright ? 32 : 27;
    const textWidth = upright ? radius * (prizes.length <= 3 ? 0.65 : 0.48) : radius * 0.45;
    ctx.font = `800 ${fontSize}px "Bulka Montserrat", sans-serif`;
    const words = prize.label.split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > textWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    const visible = lines.slice(0, 3);
    visible.forEach((value, row) =>
      ctx.fillText(
        value,
        upright ? 0 : Math.cos(middle) < 0 ? -distance : distance,
        (row - (visible.length - 1) / 2) * (fontSize + 6),
        textWidth,
      ),
    );
    ctx.restore();
  });
}
function luminance(hex) {
  const values = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(hex) {
  const background = luminance(hex);
  const ratio = (color) => {
    const foreground = luminance(color);
    return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
  };
  if (ratio('#782b0e') >= 4.5) return '#782b0e';
  if (ratio('#221008') >= 4.5) return '#221008';
  return ratio('#000000') > ratio('#ffffff') ? '#000000' : '#ffffff';
}
function displayReceipt(receipt) {
  $('receipt').textContent =
    `Чек №${receipt.number} · ${new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 }).format(receipt.total)} ₸`;
  $('receipt-step').hidden = true;
  $('spin-step').hidden = false;
  $('result-step').hidden = true;
  renderPreviousPrizes();
  $('status').textContent = '';
}
function displayWin(result) {
  keepPrize(result);
  drawing(rotation);
  const noPrize = result.win.prizeKind === 'none';
  const links = noPrize ? null : fortuneClaimLinks(result.claimToken);
  $('spin-step').hidden = true;
  $('receipt-step').hidden = true;
  $('result-step').hidden = false;
  $('retry').hidden = true;
  $('status').textContent = '';
  $('prize').textContent = result.win.prizeLabel;
  $('result-kicker').textContent = noPrize ? 'Результат вращения' : 'Ваш подарок';
  const expiry = noPrize ? new Date(NaN) : new Date(result.win.expiresAt);
  $('expiry').textContent = Number.isFinite(expiry.getTime())
    ? `Заберите до ${new Intl.DateTimeFormat('ru-KZ', { day: 'numeric', month: 'long', year: 'numeric' }).format(expiry)}`
    : '';
  $('claim-web').hidden = noPrize;
  $('claim-app').hidden = noPrize;
  $('download').hidden = noPrize;
  if (links) {
    $('claim-web').href = links.web;
    $('claim-app').href = links.app;
  }
  $('wheel-frame').classList.toggle('won', !noPrize);
  renderPreviousPrizes(result.claimToken);
}
async function newReceipt() {
  if (busy) return;
  busy = true;
  receiptToken = null;
  remember(null);
  rotation = 0;
  $('photo').value = '';
  $('receipt').textContent = '';
  $('result-step').hidden = true;
  $('spin-step').hidden = true;
  $('receipt-step').hidden = true;
  $('wheel').style.transition = 'none';
  $('wheel').style.transform = 'rotate(0deg)';
  $('wheel-frame').classList.remove('won');
  $('status').textContent = 'Загружаем колесо…';
  renderPreviousPrizes();
  try {
    await load();
  } finally {
    busy = false;
  }
}
async function load() {
  clearError();
  $('retry').hidden = true;
  renderPreviousPrizes();
  if (!endpoint) {
    showError(new Error('Ссылка на колесо недействительна. Отсканируйте QR в пекарне.'));
    $('status').textContent = '';
    return;
  }
  const previous = saved();
  if (previous?.result) {
    try {
      const result = publicDraw(previous.result);
      prizes = result.wheel;
      drawing();
      $('title').textContent = previous.campaignTitle || campaignTitle;
      $('branch').textContent = previous.branchName || branchName;
      const index = prizes.findIndex((prize) => prize.id === result.win.prizeId);
      rotation = finalWheelRotation(index, prizes.length);
      $('wheel').style.transition = 'none';
      $('wheel').style.transform = `rotate(${rotation}deg)`;
      displayWin(result);
      return;
    } catch {
      remember(null);
    }
  }
  try {
    const result = await request(endpoint);
    if (result.enabled !== true) throw new Error('Колесо сейчас недоступно');
    prizes = publicPrizes(result.campaign?.prizes);
    drawing();
    campaignTitle = result.campaign.title || campaignTitle;
    branchName = result.branch?.name || branchName;
    $('title').textContent = campaignTitle;
    $('branch').textContent = branchName;
    if (previous?.receiptToken && previous.receipt) {
      receiptToken = previous.receiptToken;
      displayReceipt(previous.receipt);
    } else {
      $('status').textContent = '';
      $('receipt-step').hidden = false;
    }
  } catch (error) {
    showError(error);
    $('status').textContent = '';
    $('retry').hidden = false;
    retryAction = load;
  }
}
async function upload() {
  const file = $('photo').files[0];
  if (!file || busy) return;
  clearError();
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  ) {
    showError(new Error('Выберите фото JPEG, PNG или WebP до 8 МБ'));
    $('photo').value = '';
    return;
  }
  busy = true;
  $('photo').disabled = true;
  document.querySelector('.upload').classList.add('busy');
  $('status').textContent = 'Ищем чек…';
  try {
    const body = new FormData();
    body.append('photo', file);
    const result = await request(`${endpoint}/receipt`, { method: 'POST', body });
    if (!result.receiptToken || !result.receipt) throw new Error('Не удалось проверить чек');
    receiptToken = result.receiptToken;
    remember({ receiptToken, receipt: result.receipt, campaignTitle, branchName });
    displayReceipt(result.receipt);
  } catch (error) {
    showError(error);
    $('status').textContent = '';
  } finally {
    busy = false;
    $('photo').disabled = false;
    $('photo').value = '';
    document.querySelector('.upload').classList.remove('busy');
  }
}
async function spin() {
  if (busy || !receiptToken) return;
  clearError();
  busy = true;
  $('spin').disabled = true;
  $('spin').textContent = 'Выбираем подарок…';
  $('retry').hidden = true;
  try {
    const result = publicDraw(
      await request(`${endpoint}/spin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptToken }),
      }),
    );
    prizes = result.wheel;
    const index = prizes.findIndex((prize) => prize.id === result.win.prizeId);
    drawing();
    remember({ ...saved(), receiptToken, result });
    rotation = finalWheelRotation(index, prizes.length, rotation);
    $('wheel').style.transition = '';
    $('wheel').style.transform = `rotate(${rotation}deg)`;
    $('spin').textContent = 'Колесо вращается…';
    $('status').textContent = '';
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      await new Promise((resolve) => setTimeout(resolve, 5300));
    displayWin(result);
  } catch (error) {
    showError(error);
    if (
      ['FORTUNE_EXPIRED', 'FORTUNE_RECEIPT_INVALID', 'FORTUNE_RECEIPT_USED'].includes(error.code)
    ) {
      receiptToken = null;
      remember(null);
      $('spin-step').hidden = true;
      $('receipt-step').hidden = false;
      $('status').textContent = '';
    } else {
      $('retry').hidden = false;
      retryAction = spin;
    }
  } finally {
    busy = false;
    $('spin').disabled = false;
    $('spin').textContent = 'Крутить колесо';
  }
}
$('photo').addEventListener('change', upload);
$('spin').addEventListener('click', spin);
$('retry').addEventListener('click', () => retryAction());
$('new-receipt').addEventListener('click', newReceipt);
load();
document.fonts.ready.then(() => {
  if (prizes.length) drawing($('result-step').hidden ? 0 : rotation);
});

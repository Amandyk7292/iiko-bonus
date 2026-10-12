export function finalWheelRotation(index, count, previous = 0) {
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(count) ||
    count < 1 ||
    index < 0 ||
    index >= count
  ) {
    throw new Error('Invalid wheel result');
  }
  const center = ((index + 0.5) * 360) / count;
  const aligned = (((360 - center) % 360) + 360) % 360;
  return Math.ceil(previous / 360) * 360 + 6 * 360 + aligned;
}

export const safeColor = (value) => (/^#[0-9a-f]{6}$/i.test(String(value)) ? value : '#ffdd83');

export function publicPrizes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24)
    throw new Error('Колесо пока недоступно');
  const ids = new Set();
  return value.map((prize) => {
    if (
      !prize ||
      typeof prize.id !== 'string' ||
      ids.has(prize.id) ||
      typeof prize.label !== 'string'
    ) {
      throw new Error('Колесо пока недоступно');
    }
    ids.add(prize.id);
    return { id: prize.id, label: prize.label.slice(0, 100), color: safeColor(prize.color) };
  });
}

export function fortuneClaimLinks(token) {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token || ''))
    throw new Error('Не удалось получить ссылку на подарок');
  const fragment = `fortune=${encodeURIComponent(token)}`;
  return { web: `/profile?register=1#${fragment}`, app: `bulka://profile?register=1#${fragment}` };
}

export function publicDraw(value) {
  const wheel = publicPrizes(value?.wheel);
  const win = value?.win;
  if (
    !win ||
    !wheel.some((prize) => prize.id === win.prizeId) ||
    typeof win.prizeLabel !== 'string' ||
    !win.prizeLabel ||
    !['bonus', 'gift', 'none'].includes(win.prizeKind)
  )
    throw new Error('Не удалось показать подарок. Повторите проверку.');
  if (win.prizeKind !== 'none') fortuneClaimLinks(value.claimToken);
  return { win, wheel, ...(win.prizeKind !== 'none' ? { claimToken: value.claimToken } : {}) };
}

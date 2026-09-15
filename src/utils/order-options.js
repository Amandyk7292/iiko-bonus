// Read the immutable selections saved with the order, never today's menu.
function optionSummary(item = {}, language = 'ru') {
  const label = (value) =>
    typeof value === 'string'
      ? value.trim()
      : String(value?.[language] || value?.ru || value?.kk || value?.en || '').trim();
  const priced = (option) => {
    const name = label(option?.title || option?.name || option?.translations);
    const delta = Number(option?.priceDelta ?? option?.price_delta ?? 0);
    return name ? `${name}${delta > 0 ? ` (+${delta} ₸)` : ''}` : '';
  };
  const lines = [];
  for (const group of Array.isArray(item.modifiers) ? item.modifiers : []) {
    if (!group || typeof group !== 'object') continue;
    if (Array.isArray(group.options)) {
      const choices = group.options.map(priced).filter(Boolean);
      const title = label(group.title || group.name);
      if (choices.length) lines.push(`${title ? `${title}: ` : ''}${choices.join(', ')}`);
    } else if (group.name) {
      lines.push(`${label(group.name)}${Number(group.quantity) > 1 ? ` × ${group.quantity}` : ''}`);
    }
  }
  const config = item.configuration || {};
  const titles = {
    ru: ['Вес', 'Начинка', 'Оформление', 'Надпись', 'Свечи', 'Пример'],
    kk: ['Салмақ', 'Салмасы', 'Безендіру', 'Жазу', 'Шамдар', 'Үлгі'],
    en: ['Weight', 'Filling', 'Design', 'Inscription', 'Candles', 'Reference'],
  };
  const names = titles[language] || titles.ru;
  ['weight', 'filling', 'design'].forEach((key, index) => {
    const value = typeof config[key] === 'string' ? config[key] : priced(config[key]);
    if (value) lines.push(`${names[index]}: ${value}`);
  });
  if (config.inscription) lines.push(`${names[3]}: ${config.inscription}`);
  if (Number(config.candles) > 0) lines.push(`${names[4]}: ${config.candles}`);
  if (config.referenceUrl) lines.push(`${names[5]}: ${config.referenceUrl}`);
  return lines.join('; ');
}
function withOrderOptions(item) {
  const optionSummaries = Object.fromEntries(
    ['ru', 'kk', 'en'].map((lang) => [
      lang,
      optionSummary(item, lang) || item.optionSummaries?.[lang] || '',
    ]),
  );
  return Object.values(optionSummaries).some(Boolean)
    ? { ...item, optionSummary: optionSummaries.ru, optionSummaries }
    : item;
}
module.exports = { optionSummary, withOrderOptions };

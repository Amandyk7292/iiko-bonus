const fs = require('node:fs');
const path = require('node:path');

const key = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
const entries = fs
  .readFileSync(path.join(__dirname, '../data/customer-catalog-translations.txt'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => {
    const [ru, kk, en] = line.split('|');
    return { ru, kk, en };
  });
const copies = new Map(
  entries.flatMap((entry) => Object.values(entry).map((value) => [key(value), entry])),
);
const descriptions = require('../data/customer-catalog-descriptions.json');

function catalogNameTranslations(value, supplied = {}) {
  const known = copies.get(key(value));
  const result = { ru: value };
  for (const language of ['kk', 'en']) {
    const text = typeof supplied?.[language] === 'string' ? supplied[language].trim() : '';
    // Older entries sometimes copied the Russian source into all languages.
    const translated = text && key(text) !== key(value) ? text : known?.[language];
    if (translated) result[language] = translated;
  }
  if (supplied?.ru) result.ru = supplied.ru;
  return result;
}

function localizeCatalogField(override, field, fallback, language = 'ru') {
  const raw = override?.[`custom_${field}`] || override?.[field] || fallback || '';
  const supplied = override?.[`${field}_translations`];
  if (field === 'name') {
    const translated = catalogNameTranslations(raw, supplied);
    return translated[language] || translated.ru || raw;
  }
  const explicit = supplied?.[language];
  if (explicit && key(explicit) !== key(raw)) return explicit;
  const known = descriptions.find((entry) =>
    [entry.source, entry.ru, entry.kk, entry.en].some((value) => key(value) === key(raw)),
  );
  return known?.[language] || explicit || supplied?.ru || raw;
}

module.exports = { catalogNameTranslations, localizeCatalogField };

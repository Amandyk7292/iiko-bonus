const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  catalogNameTranslations,
  localizeCatalogField,
} = require('../src/utils/catalog-localization.util');

test('catalog has complete translations and the offline client uses the same dictionary', () => {
  const source = fs
    .readFileSync(path.join(__dirname, '../src/data/customer-catalog-translations.txt'), 'utf8')
    .trim();
  const generated = fs.readFileSync(
    path.join(__dirname, '../BulkaAndroid/lib/core/catalog_copy.g.dart'),
    'utf8',
  );
  assert.equal(generated.split("r'''\n")[1].split("\n''';")[0], source);
  for (const row of source.split(/\r?\n/)) {
    const [ru, kk, en, extra] = row.split('|');
    assert.ok(ru && kk && en && !extra, `Incomplete row: ${row}`);
    const names = catalogNameTranslations(ru);
    assert.equal(names.kk, kk, ru);
    assert.equal(names.en, en, ru);
  }
});

test('real administrator translations win; duplicated Russian text uses the catalog translation', () => {
  const name = 'Плюшка Московская';
  const dictionary = catalogNameTranslations(name);
  assert.notEqual(dictionary.kk, name);
  assert.notEqual(dictionary.en, name);
  assert.equal(
    localizeCatalogField({ name_translations: { kk: name, en: name } }, 'name', name, 'en'),
    dictionary.en,
  );
  assert.equal(
    localizeCatalogField({ name_translations: { en: 'House sugar bun' } }, 'name', name, 'en'),
    'House sugar bun',
  );
  assert.equal(
    localizeCatalogField(null, 'name', 'New seasonal product', 'en'),
    'New seasonal product',
  );
});

test('bilingual legacy descriptions become a single selected-language description', () => {
  const descriptions = require('../src/data/customer-catalog-descriptions.json');
  for (const entry of descriptions) {
    for (const language of ['ru', 'kk', 'en']) {
      assert.equal(
        localizeCatalogField(null, 'description', entry.source, language),
        entry[language],
      );
    }
    assert.equal(
      localizeCatalogField(
        { description_translations: { en: 'Updated recipe' } },
        'description',
        entry.source,
        'en',
      ),
      'Updated recipe',
    );
  }
});

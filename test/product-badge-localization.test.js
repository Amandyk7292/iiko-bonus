const test = require('node:test');
const assert = require('node:assert/strict');
const { publicBadgeMap, badgeDto } = require('../src/services/product-badges.service');

test('badge labels follow customer language with Russian fallback', async () => {
  const rows = [
    { id: 'spicy', label: 'Острое', label_kk: 'Ащы', background: '#dd4422', foreground: '#ffffff' },
    { id: 'old', label: 'Хит', label_kk: '', background: '#782b0e', foreground: '#ffffff' },
  ];
  const db = {
    from(table) {
      return {
        select() {
          return this;
        },
        order() {
          return this;
        },
        async limit() {
          return {
            data:
              table === 'product_badges'
                ? rows
                : [
                    { product_id: 'one', badge_ids: ['spicy', 'old'] },
                    { product_id: 'two', badge_ids: ['spicy'] },
                  ],
          };
        },
      };
    },
  };
  const ru = await publicBadgeMap(db, 'ru');
  const kk = await publicBadgeMap(db, 'kk');
  assert.deepEqual(
    ru.get('one').map((b) => b.label),
    ['Острое', 'Хит'],
  );
  assert.deepEqual(
    kk.get('one').map((b) => b.label),
    ['Ащы', 'Хит'],
  );
  assert.equal(kk.get('two')[0].label, 'Ащы');
  assert.equal(kk.get('two')[0].background, '#dd4422');
  assert.equal(badgeDto(rows[0]).label, 'Острое');
  assert.equal(badgeDto(rows[0]).labelKk, 'Ащы');
  assert.equal(badgeDto(rows[0], 'en').label, 'Острое');
});

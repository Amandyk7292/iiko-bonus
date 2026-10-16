const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const calendar = require('../public/assets/brand/bulka-calendar.js');

test('calendar validates real Gregorian dates rather than only ISO-shaped strings', () => {
  for (const value of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31'])
    assert.equal(calendar.iso(calendar.parse(value)), value);
  for (const value of [
    '2023-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '0000-01-01',
    '2026-1-01',
    '2026-10-16T00:00',
  ])
    assert.equal(calendar.parse(value), null);
});
test('calendar month and day keyboard navigation preserves local calendar semantics', () => {
  assert.equal(calendar.shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(calendar.shiftDay('2024-03-01', -1), '2024-02-29');
  assert.equal(calendar.shiftMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(calendar.shiftMonth('2024-02-29', 12), '2025-02-28');
  assert.equal(calendar.shiftMonth('2026-03-31', -1), '2026-02-28');
  assert.equal(calendar.shiftDay('0001-01-01', -1), '');
  assert.equal(calendar.shiftDay('9999-12-31', 1), '');
});
test('calendar range includes endpoints and never accepts invalid or contradictory dates', () => {
  assert.equal(calendar.inRange('2026-10-16', '2026-10-16', '2026-10-20'), true);
  assert.equal(calendar.inRange('2026-10-20', '2026-10-16', '2026-10-20'), true);
  for (const value of ['', '2026-10-15', '2026-10-21', '2026-02-30'])
    assert.equal(calendar.inRange(value, '2026-10-16', '2026-10-20'), false);
  assert.equal(calendar.inRange('2026-10-16', '2026-10-20', '2026-10-10'), false);
});
test('calendar grid starts on Monday and spans exactly six weeks across year boundaries', () => {
  const days = calendar.daysForMonth('2027-01');
  assert.equal(days.length, 42);
  assert.equal(days[0], '2026-12-28');
  assert.equal(days[41], '2027-02-07');
  assert.equal(calendar.parse(days[0]).getUTCDay(), 1);
  assert.equal(new Set(days).size, 42);
  assert.deepEqual(calendar.daysForMonth('not-a-month'), []);
});
test('standalone screens load one external shared calendar and expose no native date picker', () => {
  for (const [directory, id] of [
    ['rounds', 'round-date'],
    ['pricegenerator', 'made-date'],
  ]) {
    const html = fs.readFileSync(
      path.join(__dirname, '../public', directory, 'index.html'),
      'utf8',
    );
    assert.match(html, /src="\/assets\/brand\/bulka-calendar\.js\?/);
    assert.match(html, /href="\/assets\/brand\/bulka-calendar\.css\?/);
    assert.match(html, new RegExp(`id="${id}"\\s+type="text"\\s+data-bulka-calendar[^>]*required`));
    assert.doesNotMatch(html, /type="date"/);
  }
  const source = fs.readFileSync(
    path.join(__dirname, '../public/assets/brand/bulka-calendar.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /showPicker|innerHTML|\.style\.|onclick\s*=/);
  assert.match(source, /setCustomValidity/);
  assert.match(source, /addEventListener\('invalid'/);
  assert.match(source, /new Event\('change', \{ bubbles: true \}\)/);
});

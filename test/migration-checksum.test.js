const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checksum } = require('../scripts/migration-checksum');

test('applied checkout migration verifies despite a terminal newline', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20260909180000_checkout_bonus.sql'),
    'utf8',
  );
  assert.equal(
    checksum(sql + '\n\n'),
    '68a4901bbe5d377911f7718bbe770af7b2fcc5453c0a131c6638e48b36510dd6',
  );
});

test('migration checksum still rejects a changed SQL command', () => {
  assert.notEqual(checksum('select 1;\n'), checksum('select 2;\n'));
});

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  checksum,
  migrationArtifacts,
  planLegacyHistoryReconciliation,
  stripOuterTransaction,
  validateAppliedHistory,
  validateMigrationFilenames,
} = require('../scripts/apply-migrations');

test('migration runner strips only an outer transaction wrapper', () => {
  assert.equal(stripOuterTransaction('begin;\nselect 1;\ncommit;'), 'select 1;');
  assert.equal(stripOuterTransaction('select 1;'), 'select 1;');
});

test('migration runner discovers only canonical timestamped migrations', () => {
  const artifacts = migrationArtifacts();
  assert.equal(
    artifacts.at(-1).filename,
    '20260804100000_disable_whatsapp_payment_receipt_messages.sql',
  );
  assert.equal(artifacts[0].filename, '20260426000000_production_hardening.sql');
  assert.equal(
    artifacts.some((artifact) => artifact.filename === 'supabase_schema.sql'),
    false,
  );
  assert.equal(
    artifacts.every((artifact) => artifact.file.includes('supabase')),
    true,
  );
  assert.match(artifacts.at(-1).checksum, /^[a-f0-9]{64}$/);
});

test('migration filenames require one unique timestamp', () => {
  assert.doesNotThrow(() =>
    validateMigrationFilenames(['20260725110000_first.sql', '20260725120000_second.sql']),
  );
  assert.throws(() => validateMigrationFilenames(['030_legacy.sql']), /Invalid migration filename/);
  assert.throws(
    () => validateMigrationFilenames(['20260725110000_first.sql', '20260725110000_duplicate.sql']),
    /Duplicate migration timestamp/,
  );
});

test('migration history rejects edited, removed files and ordering gaps', () => {
  const artifacts = [
    { filename: '001.sql', checksum: checksum('one') },
    { filename: '002.sql', checksum: checksum('two') },
  ];
  assert.throws(
    () =>
      validateAppliedHistory(artifacts, new Map([['001.sql', { checksum: checksum('edited') }]])),
    /Checksum mismatch/,
  );
  assert.throws(
    () => validateAppliedHistory(artifacts, new Map([['002.sql', { checksum: checksum('two') }]])),
    /history has a gap/,
  );
  assert.throws(
    () =>
      validateAppliedHistory(
        artifacts,
        new Map([['removed.sql', { checksum: checksum('removed') }]]),
      ),
    /missing from the canonical directory/,
  );
});

test('legacy migration ledger reconciliation is explicit and checksum-safe', () => {
  const artifacts = migrationArtifacts();
  const legacyChecksum = 'a349c68ea6997d18b368b6ec3af61af95fb68c9eef662521c199ec9bd6a35951';
  const actions = planLegacyHistoryReconciliation(
    artifacts,
    new Map([
      ['004_menu_admin.sql', { checksum: legacyChecksum }],
      ['supabase_schema.sql', { checksum: checksum('mutable snapshot') }],
    ]),
  );

  assert.deepEqual(
    actions.map(({ type, legacyFilename, canonicalFilename }) => ({
      type,
      legacyFilename,
      canonicalFilename,
    })),
    [
      {
        type: 'rename',
        legacyFilename: '004_menu_admin.sql',
        canonicalFilename: '20260712010000_menu_admin.sql',
      },
      {
        type: 'delete_snapshot',
        legacyFilename: 'supabase_schema.sql',
        canonicalFilename: undefined,
      },
    ],
  );
  assert.throws(
    () =>
      planLegacyHistoryReconciliation(
        artifacts,
        new Map([['004_menu_admin.sql', { checksum: checksum('unexpected edit') }]]),
      ),
    /refusing automatic ledger reconciliation/,
  );
});

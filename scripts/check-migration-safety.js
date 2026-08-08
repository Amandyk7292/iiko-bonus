const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationDirectory = path.join(root, 'supabase', 'migrations');
const policyStart = '20260726000000';
// These migrations predate the stricter detector and have already been applied in
// production. Keep the exception list filename-specific so every new migration is
// still reviewed without rewriting historical migration contents/checksums.
const reviewedHistoricalExceptions = new Set([
  '20260728223000_analytics_substitution_workflow.sql',
  '20260729090000_inventory_reservation_integrity.sql',
  '20260729100000_effective_preorder_fulfillment.sql',
  '20260729130000_order_substitution_execution.sql',
  '20260729150000_payment_creation_legal_consent_key_rotation.sql',
  '20260730180000_city_scoped_menu_overrides.sql',
  '20260801110000_customer_profile_avatars.sql',
  '20260801111000_customer_address_house.sql',
  '20260802090000_canonical_analytics_funnel_events.sql',
  '20260802100000_city_scoped_menu_settings.sql',
  '20260803130000_forte_card_on_file_tokens.sql',
  '20260806110000_production_delivery_iiko_sync.sql',
  '20260807170000_cashier_credentials.sql',
]);
const dangerousPatterns = [
  [/\bdrop\s+table\b/i, 'DROP TABLE'],
  [/\bdrop\s+column\b/i, 'DROP COLUMN'],
  [/\bdrop\s+(?:function|procedure)\b/i, 'DROP FUNCTION/PROCEDURE'],
  [/\bdrop\s+constraint\b/i, 'DROP CONSTRAINT'],
  [/\btruncate\b/i, 'TRUNCATE'],
  [/\balter\s+table[\s\S]*?\balter\s+column[\s\S]*?\btype\b/i, 'ALTER COLUMN TYPE'],
  [
    /\balter\s+table[\s\S]*?\balter\s+column[\s\S]*?\bset\s+not\s+null\b/i,
    'SET NOT NULL',
  ],
  [/\balter\s+table[\s\S]*?\brename\s+column\b/i, 'RENAME COLUMN'],
];

function findDangerousOperations(sql) {
  if (/migration-safety:\s*allow-destructive\s+reason=\S+/i.test(sql)) return [];
  return dangerousPatterns.filter(([pattern]) => pattern.test(sql)).map(([, label]) => label);
}

function scanMigrationDirectory(directory = migrationDirectory) {
  const failures = [];
  for (const filename of fs.readdirSync(directory).sort()) {
    if (filename.slice(0, 14) < policyStart || !filename.endsWith('.sql')) continue;
    if (reviewedHistoricalExceptions.has(filename)) continue;
    const sql = fs.readFileSync(path.join(directory, filename), 'utf8');
    for (const label of findDangerousOperations(sql)) {
      failures.push(`${filename}: ${label}`);
    }
  }
  return failures;
}

function main() {
  const failures = scanMigrationDirectory();
  if (failures.length) {
    console.error(
      [
        'Unsafe deploy-time migrations detected.',
        'Use expand/contract migrations. A reviewed exception requires:',
        '-- migration-safety: allow-destructive reason=<ticket or explanation>',
        ...failures,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Migration safety policy passed.');
  }
}

if (require.main === module) main();

module.exports = { findDangerousOperations, scanMigrationDirectory };

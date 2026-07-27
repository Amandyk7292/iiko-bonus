const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationDirectory = path.join(root, 'supabase', 'migrations');
const policyStart = '20260726000000';
const dangerousPatterns = [
  [/\bdrop\s+table\b/i, 'DROP TABLE'],
  [/\bdrop\s+column\b/i, 'DROP COLUMN'],
  [/\btruncate\b/i, 'TRUNCATE'],
  [/\balter\s+table[\s\S]*?\balter\s+column[\s\S]*?\btype\b/i, 'ALTER COLUMN TYPE'],
  [/\balter\s+table[\s\S]*?\brename\s+column\b/i, 'RENAME COLUMN'],
];

const failures = [];
for (const filename of fs.readdirSync(migrationDirectory).sort()) {
  if (filename.slice(0, 14) < policyStart || !filename.endsWith('.sql')) continue;
  const sql = fs.readFileSync(path.join(migrationDirectory, filename), 'utf8');
  if (/migration-safety:\s*allow-destructive\s+reason=/i.test(sql)) continue;
  for (const [pattern, label] of dangerousPatterns) {
    if (pattern.test(sql)) failures.push(`${filename}: ${label}`);
  }
}

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

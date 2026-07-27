const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || undefined });

const projectRoot = path.resolve(__dirname, '..');
const migrationsDirectory = path.join(projectRoot, 'supabase', 'migrations');
const shouldApply = process.argv.includes('--apply');
const shouldBaselineExisting = process.argv.includes('--baseline-existing');
const baselineThroughArgument = process.argv.find((argument) =>
  argument.startsWith('--baseline-through='),
);
const baselineThrough = baselineThroughArgument
  ? baselineThroughArgument.slice('--baseline-through='.length)
  : '';
const connectionString =
  process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const LEDGER_TABLE = 'public.bulka_schema_migrations';
const LOCK_NAME = 'bulka-schema-migrations-v1';
const MIGRATION_FILENAME_PATTERN = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const BASELINE_MARKER_PREFIX = '-- Baseline marker:';
const LEGACY_SNAPSHOT_FILENAME = 'supabase_schema.sql';
const LEGACY_MIGRATION_ALIASES = new Map(
  Object.entries({
    '004_menu_admin.sql': '20260712010000_menu_admin.sql',
    '005_menu_override_name_price.sql': '20260712020000_menu_override_name_price.sql',
    '006_menu_translations.sql': '20260712030000_menu_translations.sql',
    '007_security_and_orders.sql': '20260712040000_security_and_orders.sql',
    '008_kaspi_refunds.sql': '20260712050000_kaspi_refunds.sql',
    '009_order_fulfillment.sql': '20260713190000_order_fulfillment.sql',
    '010_backfill_branch_labels.sql': '20260713203000_backfill_branch_labels.sql',
    '011_delivery_zones.sql': '20260714070000_delivery_zones.sql',
    '012_release_product_features.sql': '20260714120000_release_product_features.sql',
    '013_commerce_operations_suite.sql': '20260715090000_commerce_operations_suite.sql',
    '014_financial_branch_courier_hardening.sql':
      '20260715120000_financial_branch_courier_hardening.sql',
    '015_wallet_realtime_sync.sql': '20260715150000_wallet_realtime_sync.sql',
    '016_push_device_tokens.sql': '20260715193000_push_device_tokens.sql',
    '017_customer_arrival.sql': '20260716120000_customer_arrival.sql',
    '018_client_experience_suite.sql': '20260716160000_client_experience_suite.sql',
    '019_product_details_eta.sql': '20260716190000_product_details_eta.sql',
    '020_order_type_catalogs.sql': '20260716200000_order_type_catalogs.sql',
    '020_site_ip_access.sql': '20260716210000_site_ip_access.sql',
    '021_contact_center.sql': '20260718120000_contact_center.sql',
    '022_product_storage_conditions.sql': '20260719174500_product_storage_conditions.sql',
    '023_yandex_delivery.sql': '20260720090000_yandex_delivery.sql',
    '024_whatsapp_assistant_console.sql': '20260722093000_whatsapp_assistant_console.sql',
    '025_whatsapp_ai_providers.sql': '20260722120000_whatsapp_ai_providers.sql',
    '026_customer_password_auth.sql': '20260722223000_customer_password_auth.sql',
    '027_admin_operations_realtime.sql': '20260723120000_admin_operations_realtime.sql',
    '028_whatsapp_outbox.sql': '20260723170000_whatsapp_outbox.sql',
    '029_forte_compliance_receipts_astana.sql':
      '20260725100000_forte_compliance_receipts_astana.sql',
  }),
);
const LEGACY_CHECKSUM_EXCEPTIONS = new Map(
  Object.entries({
    '004_menu_admin.sql': 'a349c68ea6997d18b368b6ec3af61af95fb68c9eef662521c199ec9bd6a35951',
    '005_menu_override_name_price.sql':
      'f3734e29c231c5ecfd2ed28980e641f3b6d8a866bed72493309acfc67e876617',
    '006_menu_translations.sql':
      '7ac97661e02d2a2d00c9aa823b859670599e4bbd439649b62e85f55655ff8f7d',
    '007_security_and_orders.sql':
      '1c215e1a056de244fa3518b7a6f35bbf9601c2f678d65d9be34a930c20196d72',
    '008_kaspi_refunds.sql':
      '7170f16d44e5c6c9e067ae1af15b71e34ecd8424987e5f61f0baebe1f2ec29ac',
    '014_financial_branch_courier_hardening.sql':
      '0321402a6ab9d2789f14c2ee2a126818ba2e5b739084c36d01a322e4c513eedd',
  }),
);

function fail(message) {
  console.error(`Migration aborted: ${message}`);
  process.exitCode = 1;
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function stripOuterTransaction(sql) {
  const withoutBom = String(sql || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!/^begin\s*;/i.test(withoutBom) || !/commit\s*;\s*$/i.test(withoutBom)) {
    return withoutBom;
  }
  return withoutBom
    .replace(/^begin\s*;/i, '')
    .replace(/commit\s*;\s*$/i, '')
    .trim();
}

function validateMigrationFilenames(filenames) {
  const timestamps = new Set();
  for (const filename of filenames) {
    const match = MIGRATION_FILENAME_PATTERN.exec(filename);
    if (!match) {
      throw new Error(
        `Invalid migration filename ${filename}. Use YYYYMMDDHHMMSS_snake_case.sql.`,
      );
    }
    if (timestamps.has(match[1])) {
      throw new Error(`Duplicate migration timestamp ${match[1]} in ${filename}.`);
    }
    timestamps.add(match[1]);
  }
}

function migrationArtifacts() {
  if (!fs.existsSync(migrationsDirectory)) {
    throw new Error(`Canonical migration directory not found: ${migrationsDirectory}`);
  }
  const filenames = fs
    .readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  validateMigrationFilenames(filenames);
  return filenames.map((filename) => path.join(migrationsDirectory, filename)).map((file) => {
    const rawSql = fs
      .readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, '')
      .trim();
    if (!rawSql) throw new Error(`SQL file is empty: ${file}`);
    return {
      filename: path.basename(file),
      file,
      sql: stripOuterTransaction(rawSql),
      checksum: checksum(rawSql),
      bytes: Buffer.byteLength(rawSql),
    };
  });
}

async function ensureLedger(client) {
  await client.query(`
    create table if not exists ${LEDGER_TABLE} (
      filename text primary key,
      checksum varchar(64) not null
        check (checksum ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz not null default now(),
      execution_ms integer not null default 0
        check (execution_ms >= 0)
    );
    revoke all on table ${LEDGER_TABLE} from public, anon, authenticated;
    grant select on table ${LEDGER_TABLE} to service_role;
  `);
}

async function existingSchemaDetected(client) {
  const { rows } = await client.query(
    `select to_regclass('public.customers') is not null as exists`,
  );
  return Boolean(rows[0]?.exists);
}

async function validateExistingBaseline(client) {
  const { rows } = await client.query(`
    select
      to_regclass('public.customers') is not null as customers,
      to_regclass('public.whatsapp_assistant_settings') is not null as assistant_settings,
      to_regclass('public.customer_credentials') is not null as customer_credentials,
      to_regclass('public.customer_support_messages') is not null as support_messages,
      to_regprocedure('public.get_admin_stats_scoped(uuid[])') is not null as admin_stats
  `);
  const state = rows[0] || {};
  const missing = Object.entries(state)
    .filter(([, exists]) => !exists)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(
      `Existing database cannot be baselined because required objects are missing: ${missing.join(', ')}`,
    );
  }
}

async function readApplied(client) {
  const { rows } = await client.query(
    `select filename, checksum, applied_at from ${LEDGER_TABLE} order by applied_at, filename`,
  );
  return new Map(rows.map((row) => [row.filename, row]));
}

function planLegacyHistoryReconciliation(artifacts, applied) {
  const artifactsByName = new Map(artifacts.map((artifact) => [artifact.filename, artifact]));
  const actions = [];

  for (const [legacyFilename, row] of applied) {
    if (legacyFilename === LEGACY_SNAPSHOT_FILENAME) {
      actions.push({
        type: 'delete_snapshot',
        legacyFilename,
        legacyChecksum: row.checksum,
      });
      continue;
    }

    const canonicalFilename = LEGACY_MIGRATION_ALIASES.get(legacyFilename);
    if (!canonicalFilename) continue;
    const artifact = artifactsByName.get(canonicalFilename);
    if (!artifact) {
      throw new Error(
        `Legacy migration ${legacyFilename} maps to missing canonical file ${canonicalFilename}.`,
      );
    }
    const acceptedLegacyChecksum = LEGACY_CHECKSUM_EXCEPTIONS.get(legacyFilename);
    if (row.checksum !== artifact.checksum && row.checksum !== acceptedLegacyChecksum) {
      throw new Error(
        `Checksum mismatch for legacy migration ${legacyFilename}; refusing automatic ledger reconciliation.`,
      );
    }
    const canonicalRow = applied.get(canonicalFilename);
    if (canonicalRow && canonicalRow.checksum !== artifact.checksum) {
      throw new Error(
        `Checksum mismatch for canonical migration ${canonicalFilename}; refusing legacy deduplication.`,
      );
    }
    actions.push({
      type: canonicalRow ? 'delete_duplicate' : 'rename',
      legacyFilename,
      legacyChecksum: row.checksum,
      canonicalFilename,
      canonicalChecksum: artifact.checksum,
    });
  }

  return actions;
}

async function reconcileLegacyHistory(client, artifacts, applied) {
  const actions = planLegacyHistoryReconciliation(artifacts, applied);
  if (!actions.length) return { applied, reconciled: false };

  await client.query('begin');
  try {
    for (const action of actions) {
      if (action.type === 'rename') {
        const result = await client.query(
          `
            update ${LEDGER_TABLE}
            set filename = $1, checksum = $2
            where filename = $3 and checksum = $4
          `,
          [
            action.canonicalFilename,
            action.canonicalChecksum,
            action.legacyFilename,
            action.legacyChecksum,
          ],
        );
        if (result.rowCount !== 1) {
          throw new Error(`Legacy migration row changed concurrently: ${action.legacyFilename}.`);
        }
      } else {
        const result = await client.query(
          `delete from ${LEDGER_TABLE} where filename = $1 and checksum = $2`,
          [action.legacyFilename, action.legacyChecksum],
        );
        if (result.rowCount !== 1) {
          throw new Error(`Legacy migration row changed concurrently: ${action.legacyFilename}.`);
        }
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }

  const renamed = actions.filter((action) => action.type === 'rename').length;
  const removed = actions.length - renamed;
  console.log(
    `Legacy migration ledger reconciled: ${renamed} renamed, ${removed} obsolete row(s) removed.`,
  );
  return { applied: await readApplied(client), reconciled: true };
}

async function recordBaselineMarkers(client, artifacts, applied) {
  if (!baselineThrough) {
    throw new Error('--baseline-existing requires --baseline-through=<filename>.');
  }
  const baselineIndex = artifacts.findIndex((artifact) => artifact.filename === baselineThrough);
  if (baselineIndex < 0) {
    throw new Error(`Baseline migration was not found: ${baselineThrough}`);
  }
  const missingMarkers = artifacts
    .slice(0, baselineIndex + 1)
    .filter(
      (artifact) =>
        artifact.sql.startsWith(BASELINE_MARKER_PREFIX) && !applied.has(artifact.filename),
    );
  if (!missingMarkers.length) return applied;

  await validateExistingBaseline(client);
  await client.query('begin');
  try {
    for (const artifact of missingMarkers) {
      await client.query(
        `
          insert into ${LEDGER_TABLE} (filename, checksum, execution_ms)
          values ($1, $2, 0)
          on conflict (filename) do nothing
        `,
        [artifact.filename, artifact.checksum],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
  console.log(`Recorded ${missingMarkers.length} verified baseline marker(s).`);
  return readApplied(client);
}

function validateAppliedHistory(artifacts, applied) {
  const artifactNames = new Set(artifacts.map((artifact) => artifact.filename));
  const removedApplied = [...applied.keys()].filter((filename) => !artifactNames.has(filename));
  if (removedApplied.length) {
    throw new Error(
      `Applied migration files are missing from the canonical directory: ${removedApplied.join(', ')}.`,
    );
  }
  let missingEarlier = null;
  for (const artifact of artifacts) {
    const row = applied.get(artifact.filename);
    if (!row) {
      missingEarlier ||= artifact.filename;
      continue;
    }
    if (row.checksum !== artifact.checksum) {
      throw new Error(
        `Checksum mismatch for applied migration ${artifact.filename}. Create a new migration instead of editing migration history.`,
      );
    }
    if (missingEarlier) {
      throw new Error(
        `Migration history has a gap: ${missingEarlier} is missing but ${artifact.filename} is already recorded.`,
      );
    }
  }
}

async function baselineExisting(client, artifacts) {
  if (!baselineThrough) {
    throw new Error('--baseline-existing requires --baseline-through=<filename>.');
  }
  const baselineIndex = artifacts.findIndex((artifact) => artifact.filename === baselineThrough);
  if (baselineIndex < 0) {
    throw new Error(`Baseline migration was not found: ${baselineThrough}`);
  }
  await validateExistingBaseline(client);
  const baselineArtifacts = artifacts.slice(0, baselineIndex + 1);
  await client.query('begin');
  try {
    for (const artifact of baselineArtifacts) {
      await client.query(
        `
          insert into ${LEDGER_TABLE} (filename, checksum, execution_ms)
          values ($1, $2, 0)
          on conflict (filename) do nothing
        `,
        [artifact.filename, artifact.checksum],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  console.log(
    `Existing database baselined through ${baselineThrough} (${baselineArtifacts.length} files).`,
  );
}

async function applyArtifact(client, artifact) {
  const startedAt = Date.now();
  await client.query('begin');
  try {
    await client.query("set local statement_timeout = '10min'");
    await client.query("set local lock_timeout = '30s'");
    await client.query(artifact.sql);
    await client.query(
      `
        insert into ${LEDGER_TABLE} (filename, checksum, execution_ms)
        values ($1, $2, $3)
      `,
      [artifact.filename, artifact.checksum, Math.max(0, Date.now() - startedAt)],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
  console.log(`Applied ${artifact.filename} in ${Date.now() - startedAt} ms.`);
}

async function applyMigrations(artifacts) {
  if (!connectionString) {
    throw new Error('SUPABASE_DB_URL (or DATABASE_URL/POSTGRES_URL) is required for --apply.');
  }
  const sslDisabled = String(process.env.SUPABASE_DB_SSL || '').toLowerCase() === 'false';
  const allowUnverifiedCertificate =
    String(process.env.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'false';
  const client = new Client({
    connectionString,
    ssl: sslDisabled ? false : allowUnverifiedCertificate ? { rejectUnauthorized: false } : true,
    application_name: 'bulka-bonus-migrations',
  });

  try {
    await client.connect();
    await ensureLedger(client);
    await client.query('select pg_advisory_lock(hashtext($1))', [LOCK_NAME]);
    let applied = await readApplied(client);
    const reconciliation = await reconcileLegacyHistory(client, artifacts, applied);
    applied = reconciliation.applied;
    if (reconciliation.reconciled && shouldBaselineExisting) {
      applied = await recordBaselineMarkers(client, artifacts, applied);
    }
    if (applied.size === 0 && (await existingSchemaDetected(client))) {
      if (!shouldBaselineExisting) {
        throw new Error(
          'The database already has a schema but no migration ledger. Run once with --baseline-existing --baseline-through=<last verified migration>.',
        );
      }
      await baselineExisting(client, artifacts);
      applied = await readApplied(client);
    }
    validateAppliedHistory(artifacts, applied);
    const pending = artifacts.filter((artifact) => !applied.has(artifact.filename));
    if (!pending.length) {
      console.log('Database is current. No SQL migrations were applied.');
      return;
    }
    for (const artifact of pending) await applyArtifact(client, artifact);
    console.log(`Migration completed: ${pending.length} new SQL file(s) applied.`);
  } finally {
    await client
      .query('select pg_advisory_unlock(hashtext($1))', [LOCK_NAME])
      .catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

async function main() {
  const artifacts = migrationArtifacts();
  if (!shouldApply) {
    const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
    console.log(
      `Canonical migration set is valid: ${artifacts.length} ordered SQL files (${totalBytes} bytes).`,
    );
    for (const artifact of artifacts) {
      console.log(
        ` - ${path.relative(process.cwd(), artifact.file)} ${artifact.checksum.slice(0, 12)}`,
      );
    }
    console.log('No database changes were made. At deploy time only unrecorded files are applied.');
    console.log(
      'supabase_schema.sql is a mutable bootstrap snapshot and is intentionally excluded from the migration ledger.',
    );
    if (!connectionString) {
      console.log(
        'Set SUPABASE_DB_URL (or DATABASE_URL/POSTGRES_URL) before running npm run db:migrate.',
      );
    }
    return;
  }
  await applyMigrations(artifacts);
}

if (require.main === module) {
  main().catch((error) => fail(error instanceof Error ? error.message : 'Unknown migration error'));
}

module.exports = {
  checksum,
  migrationArtifacts,
  planLegacyHistoryReconciliation,
  stripOuterTransaction,
  validateAppliedHistory,
  validateMigrationFilenames,
};

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

require('dotenv').config();

const schemaPath = path.resolve(__dirname, '..', 'supabase_schema.sql');
const shouldApply = process.argv.includes('--apply');
const connectionString =
  process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

function fail(message) {
  console.error(`Migration aborted: ${message}`);
  process.exitCode = 1;
}

async function main() {
  if (!fs.existsSync(schemaPath)) {
    fail(`Schema file not found: ${schemaPath}`);
    return;
  }

  const sql = fs.readFileSync(schemaPath, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!sql) {
    fail('supabase_schema.sql is empty.');
    return;
  }

  if (!shouldApply) {
    console.log(`Migration plan is ready: ${path.relative(process.cwd(), schemaPath)} (${sql.length} bytes).`);
    console.log('No database changes were made. Run `npm run db:migrate` to apply it.');
    if (!connectionString) {
      console.log('Before applying, set SUPABASE_DB_URL (or DATABASE_URL/POSTGRES_URL) to a Supabase PostgreSQL connection string.');
    }
    return;
  }

  if (!connectionString) {
    fail('SUPABASE_DB_URL (or DATABASE_URL/POSTGRES_URL) is required for --apply.');
    return;
  }

  const sslDisabled = String(process.env.SUPABASE_DB_SSL || '').toLowerCase() === 'false';
  const allowUnverifiedCertificate =
    String(process.env.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'false';
  const client = new Client({
    connectionString,
    // Keep TLS enabled by default. Some managed poolers provide an
    // intermediate certificate absent from the local OS store; accepting it
    // requires an explicit opt-out and never becomes the default behaviour.
    ssl: sslDisabled
      ? false
      : allowUnverifiedCertificate
      ? { rejectUnauthorized: false }
      : true,
    application_name: 'bulka-bonus-migrations',
  });

  try {
    await client.connect();
    await client.query('begin');
    await client.query("set local statement_timeout = '10min'");
    await client.query(sql);
    await client.query('commit');
    console.log('Supabase schema migration completed successfully.');
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // The connection can fail before a transaction begins.
    }
    fail(error instanceof Error ? error.message : 'Unknown PostgreSQL migration error');
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : 'Unknown migration error'));

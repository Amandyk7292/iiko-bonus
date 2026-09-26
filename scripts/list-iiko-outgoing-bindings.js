#!/usr/bin/env node
// Read-only directory export. Never prints raw iiko responses, account data or errors.
const cities = ['aktau', 'astana'];
const safeCode = (error) =>
  /^IIKO_REPORT_[A-Z_]+$/.test(error?.code || '') ? error.code : 'DIRECTORY_UNAVAILABLE';
const text = (value) => (typeof value === 'string' ? value : null);
const asRows = (value) => (Array.isArray(value) ? value : value ? [value] : []);

async function collectBindingDirectory({ db, client, includeRms = false }) {
  const result = { checkedAt: new Date().toISOString(), branches: [], sources: [], errors: [] };
  try {
    const { data, error } = await db
      .from('bulka_locations')
      .select('id,name,address,city,active')
      .eq('active', true)
      .abortSignal(AbortSignal.timeout(15000));
    if (error) throw error;
    result.branches = (data || []).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      address: text(row.address),
      city: text(row.city),
    }));
  } catch (error) {
    result.errors.push({ source: 'bulka_locations', code: safeCode(error) });
  }
  let servers;
  try {
    servers = await client.listServers();
  } catch (error) {
    result.errors.push({ source: 'iiko_server_registry', code: safeCode(error) });
    return result;
  }
  for (const city of cities) {
    const sources = servers.filter(
      (server) =>
        server.city === city &&
        server.active &&
        (server.kind === 'chain' || (includeRms && server.kind === 'rms')),
    );
    if (!sources.length) result.errors.push({ city, code: 'DIRECTORY_SOURCE_MISSING' });
    for (const source of sources) {
      const output = { city, serverId: source.id, kind: source.kind, departments: [] };
      result.sources.push(output);
      if (!source.configured) {
        result.errors.push({ city, serverId: source.id, code: 'IIKO_REPORT_NOT_CONFIGURED' });
        continue;
      }
      try {
        const response = await client.withSession(source.id, (request) =>
          request('corporation/departments', undefined, 'xml'),
        );
        if (!Object.hasOwn(response || {}, 'corporateItemDtoes'))
          throw new Error('Invalid directory');
        output.departments = asRows(response.corporateItemDtoes?.corporateItemDto).map((row) => ({
          id: text(row.id),
          name: text(row.name),
          address: text(row.address),
        }));
      } catch (error) {
        result.errors.push({ city, serverId: source.id, code: safeCode(error) });
      }
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'node scripts/list-iiko-outgoing-bindings.js [--rms]\nRead-only bakery and department IDs for Aktau and Astana. --rms also reads RMS directories. No mappings are inferred or saved.',
    );
    return;
  }
  if (args.some((arg) => arg !== '--rms')) throw new Error('Invalid options');
  const { supabase } = require('../src/config/supabase');
  const { IikoDashboardClient } = require('../src/services/iiko-dashboard-client');
  const result = await collectBindingDirectory({
    db: supabase,
    client: new IikoDashboardClient(),
    includeRms: args.includes('--rms'),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
if (require.main === module)
  main().catch(() => {
    console.error('DIRECTORY_UNAVAILABLE: use --help and check configured backend credentials.');
    process.exitCode = 1;
  });
module.exports = { collectBindingDirectory };

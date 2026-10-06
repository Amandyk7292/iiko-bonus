const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('photo-first release requires 1.14.3 without changing general plugin enforcement', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const branch = randomUUID();
  const otherBranch = randomUUID();
  const terminal = '9b5efb9d-2c17-376e-01a0-4284aa5509be';
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table bulka_locations(id uuid primary key, active boolean default true);
    create table pos_devices(terminal_id uuid primary key, branch_id uuid, active boolean default true,
      last_health_at timestamptz default now(), connected_to_main boolean default true,
      health_payload jsonb default '{"photoPrinterReady":true}', plugin_version text default '1.14.3');
    create table pos_plugin_policy(singleton boolean primary key, latest_version text,
      download_url text, guide_url text, updated_at timestamptz, minimum_version text, enforce_minimum boolean);
    insert into pos_plugin_policy values(true,'1.14.2','old','old',now(),'1.9.0',false);`);
  await db.query('insert into bulka_locations(id) values($1),($2)', [branch, otherBranch]);
  await db.query('insert into pos_devices(terminal_id,branch_id) values($1,$2)', [
    terminal,
    branch,
  ]);
  const migration = fs.readFileSync(
    'supabase/migrations/20261006235500_pickup_photo_first_release.sql',
    'utf8',
  );
  await db.exec(migration);
  const ready = async (selectedBranch = branch, selectedTerminal = terminal) =>
    (
      await db.query('select pickup_photo_printer_ready($1,$2) r', [
        selectedBranch,
        selectedTerminal,
      ])
    ).rows[0].r;
  for (const version of ['1.14.0', '1.14.1', '1.14.2', '1.13.99', 'unknown', '1.14.3-beta']) {
    await db.query('update pos_devices set plugin_version=$1', [version]);
    assert.equal(await ready(), false, version);
  }
  for (const version of ['1.14.3', '1.14.4', '1.15.0', '2.0.0']) {
    await db.query('update pos_devices set plugin_version=$1', [version]);
    assert.equal(await ready(), true, version);
  }
  assert.equal(await ready(branch, null), true);
  assert.equal(await ready(otherBranch), false);
  assert.equal(await ready(branch, randomUUID()), false);
  for (const mutation of [
    'update pos_devices set active=false',
    'update pos_devices set connected_to_main=false',
    "update pos_devices set last_health_at=now()-interval '3 minutes'",
    "update pos_devices set health_payload='{}'",
    'update pos_devices set health_payload=\' {"photoPrinterReady":false}\'',
    'update bulka_locations set active=false',
  ]) {
    await db.exec(mutation);
    assert.equal(await ready(), false, mutation);
    await db.exec(`update pos_devices set active=true,connected_to_main=true,last_health_at=now(),
      health_payload='{"photoPrinterReady":true}'; update bulka_locations set active=true;`);
  }
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(
      db.exec(`set role ${role}; select pickup_photo_printer_ready('${branch}')`),
      /permission denied/,
    );
    await db.exec('reset role');
  }
  await db.exec(
    `set role service_role; select pickup_photo_printer_ready('${branch}'); reset role;`,
  );
  let policy = (await db.query('select * from pos_plugin_policy')).rows[0];
  assert.equal(policy.latest_version, '1.14.3');
  assert.equal(policy.download_url, '/downloads/BulkaPlugin-1.14.3-update.zip');
  assert.equal(policy.guide_url, '/docs/iiko-plugin-1.14.3.html');
  assert.equal(policy.minimum_version, '1.9.0');
  assert.equal(policy.enforce_minimum, false);
  for (const existingVersion of ['1.15.0', '2.0.0', 'custom']) {
    await db.query(
      "update pos_plugin_policy set latest_version=$1,download_url='custom',guide_url='custom',minimum_version='1.13.0',enforce_minimum=true",
      [existingVersion],
    );
    await db.exec(migration);
    policy = (await db.query('select * from pos_plugin_policy')).rows[0];
    assert.equal(policy.latest_version, existingVersion);
    assert.equal(policy.download_url, 'custom');
    assert.equal(policy.guide_url, 'custom');
    assert.equal(policy.minimum_version, '1.13.0');
    assert.equal(policy.enforce_minimum, true);
  }
});

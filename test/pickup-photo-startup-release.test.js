const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

for (const release of [
  { from: '1.14.3', to: '1.14.4', migration: '20261006235600_pickup_photo_startup_recovery_release.sql' },
  { from: '1.14.4', to: '1.14.5', migration: '20261006235700_pickup_photo_receipt_printer_release.sql' },
]) test(`photo release ${release.to} preserves administrator enforcement and newer releases`, async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create table pos_plugin_policy(singleton boolean primary key, latest_version text,
    download_url text, guide_url text, updated_at timestamptz, minimum_version text, enforce_minimum boolean);
    insert into pos_plugin_policy values(true,'${release.from}','old','old',now(),'1.13.0',true);`);
  const migration = fs.readFileSync(
    `supabase/migrations/${release.migration}`,
    'utf8',
  );
  await db.exec(migration);
  let policy = (await db.query('select * from pos_plugin_policy')).rows[0];
  assert.equal(policy.latest_version, release.to);
  assert.equal(policy.download_url, `/downloads/BulkaPlugin-${release.to}-update.zip`);
  assert.equal(policy.guide_url, `/docs/iiko-plugin-${release.to}.html`);
  assert.equal(policy.minimum_version, '1.13.0');
  assert.equal(policy.enforce_minimum, true);
  for (const version of [release.to, '1.15.0', 'custom']) {
    await db.query(
      "update pos_plugin_policy set latest_version=$1,download_url='custom',guide_url='custom'",
      [version],
    );
    await db.exec(migration);
    policy = (await db.query('select * from pos_plugin_policy')).rows[0];
    assert.equal(policy.latest_version, version);
    assert.equal(policy.download_url, 'custom');
    assert.equal(policy.guide_url, 'custom');
    assert.equal(policy.minimum_version, '1.13.0');
    assert.equal(policy.enforce_minimum, true);
  }
});

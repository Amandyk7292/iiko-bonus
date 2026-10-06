const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('startup recovery release preserves administrator enforcement and newer releases', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create table pos_plugin_policy(singleton boolean primary key, latest_version text,
    download_url text, guide_url text, updated_at timestamptz, minimum_version text, enforce_minimum boolean);
    insert into pos_plugin_policy values(true,'1.14.3','old','old',now(),'1.13.0',true);`);
  const migration = fs.readFileSync(
    'supabase/migrations/20261006235600_pickup_photo_startup_recovery_release.sql',
    'utf8',
  );
  await db.exec(migration);
  let policy = (await db.query('select * from pos_plugin_policy')).rows[0];
  assert.equal(policy.latest_version, '1.14.4');
  assert.equal(policy.download_url, '/downloads/BulkaPlugin-1.14.4-update.zip');
  assert.equal(policy.guide_url, '/docs/iiko-plugin-1.14.4.html');
  assert.equal(policy.minimum_version, '1.13.0');
  assert.equal(policy.enforce_minimum, true);
  for (const version of ['1.14.4', '1.15.0', 'custom']) {
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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('receipt latency release preserves enforcement, custom policy and newer releases', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table pos_plugin_policy (
      singleton boolean primary key, latest_version text, minimum_version text,
      enforce_minimum boolean, download_url text, guide_url text, updated_at timestamptz
    ); insert into pos_plugin_policy values
      (true,'1.14.6','1.13.0',true,'old.zip','old.html',now());`);
    const migration = fs.readFileSync(
      'supabase/migrations/20261019090000_front_receipt_latency_release.sql',
      'utf8',
    );
    await db.exec(migration);
    const read = async () => (await db.query('select * from pos_plugin_policy')).rows[0];
    const upgraded = await read();
    assert.equal(upgraded.latest_version, '1.15.1');
    assert.equal(upgraded.minimum_version, '1.13.0');
    assert.equal(upgraded.enforce_minimum, true);
    assert.equal(upgraded.download_url, '/downloads/BulkaPlugin-1.15.1-update.zip');
    await db.exec(migration);
    assert.deepEqual(await read(), upgraded);
    for (const version of ['1.16.0', 'custom-reviewed']) {
      await db.query('update pos_plugin_policy set latest_version=$1,download_url=$2', [
        version,
        'custom.zip',
      ]);
      await db.exec(migration);
      const preserved = await read();
      assert.equal(preserved.latest_version, version);
      assert.equal(preserved.download_url, 'custom.zip');
    }
  } finally {
    await db.close();
  }
});

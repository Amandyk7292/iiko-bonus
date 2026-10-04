const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { database } = require('./photo-report-database.cjs');
const store = require('../../src/services/branch-photo-telegram-store.service');
const NOW = new Date('2026-10-05T04:00:00Z');
async function fixture(t, { bindOwner = true } = {}) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec('create role anon;create role authenticated;create role service_role;');
  await pg.exec(
    readFileSync('supabase/migrations/20261004170000_branch_photo_telegram.sql', 'utf8'),
  );
  const db = database(pg);
  const options = { db, now: NOW, ownerUsername: 'amandyk7292', ownerUserId: '101' };
  if (bindOwner)
    await store.observeUser(
      { id: '101', chatId: '101', username: 'amandyk7292', private: true },
      options,
    );
  return { pg, db, options, store };
}
module.exports = { fixture, NOW };

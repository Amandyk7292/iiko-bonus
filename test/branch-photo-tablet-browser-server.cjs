// Isolated production-router browser fixture. No live database/storage/API calls.
require('./test-env.cjs');
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-photo-report-browser-fixture';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { database } = require('./helpers/photo-report-database.cjs');
const { applyDeviceMigration } = require('./helpers/photo-report-device-fixture.cjs');
const { supabase } = require('../src/config/supabase');
const reports = require('../src/services/branch-photo-reports.service');
const devices = require('../src/services/branch-photo-devices.service');
const adminDevices = require('../src/services/branch-photo-device-admin.service');
const { readDeviceCookie } = require('../src/utils/branch-photo-device-cookie.util');
const A = '11111111-1111-4111-8111-111111111111';
const objects = new Map();
require('../src/services/branch-photo-storage.service').photoStorage = () => ({
  from: () => ({
    upload: async (name, data) => {
      objects.set(name, data);
      return {};
    },
  }),
});

(async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon;create role authenticated;create role service_role;
    create table bulka_locations(id uuid primary key,name text,city text,active boolean,sort_order int default 0);
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text);
    insert into bulka_locations values('${A}','Планшет · тестовая точка','Актау',true,0);`);
  for (const name of [
    '20261001150000_branch_closing_photo_reports.sql',
    '20261002120000_round_the_clock_shifts.sql',
  ])
    await pg.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'));
  await applyDeviceMigration(pg);
  const db = database(pg);
  supabase.from = db.from;
  supabase.rpc = db.rpc;
  const qr = await reports.ensureQr({ role: 'owner' }, A, { db });
  const app = express();
  app.use(express.json());
  app.get('/api/branch-reports/__fixture__/qr', (_req, res) => res.json({ url: qr.url }));
  app.post('/api/branch-reports/__fixture__/approve', async (req, res, next) => {
    try {
      const token = readDeviceCookie(req);
      const d = await devices.findDevice(token, { db });
      const state = await devices.status(
        new URLSearchParams(new URL(qr.url).hash.slice(1)).get('t'),
        token,
        { db },
      );
      await adminDevices.approve(
        { role: 'owner' },
        d.id,
        { code: state.pairingCode, name: 'Планшет браузера' },
        { db },
      );
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/branch-reports/__fixture__/expire', async (_req, res, next) => {
    try {
      await pg.exec("update branch_closing_sessions set expires_at=now()-interval '1 second'");
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/branch-reports/__fixture__/state', async (_req, res, next) => {
    try {
      res.json({
        objects: objects.size,
        reports: (await pg.query('select photo_count from branch_closing_reports')).rows,
        permanentSessions: (
          await pg.query(
            'select count(*)::int n from branch_closing_sessions where expires_at is null',
          )
        ).rows[0].n,
      });
    } catch (error) {
      next(error);
    }
  });
  app.use(
    require('../src/middlewares/content-security-policy.middleware')
      .contentSecurityPolicyMiddleware,
  );
  app.use(require('../src/routes/branch-photo-reports.routes'));
  app.use(express.static(path.resolve(__dirname, '../public')));
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ error: error.message, code: error.code }),
  );
  const server = app.listen(Number(process.env.PHOTO_TABLET_TEST_PORT || 4180), '127.0.0.1');
  app.post('/api/branch-reports/__fixture__/shutdown', (_req, res) => {
    res.json({ success: true });
    setTimeout(() => {
      server.close(async () => {
        await pg.close();
        process.exit(0);
      });
      server.closeAllConnections();
    }, 100);
  });
})().catch((error) => {
  console.error('Isolated photo-report fixture failed:', error.message);
  process.exitCode = 1;
});

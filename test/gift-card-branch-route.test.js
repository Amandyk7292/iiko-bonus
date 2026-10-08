// Isolated route/branch contract regression: no server, socket or external API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const root = require('node:path').resolve(__dirname, '..');
const test = require('node:test');
const { PGlite } = require(root + '/node_modules/@electric-sql/pglite');
async function main() {
  const pg = new PGlite();
  const branchA = randomUUID(),
    branchB = randomUUID(),
    reservation = randomUUID();
  try {
    await pg.exec(
      'create table gift_card_pos_reservations(id uuid primary key,branch_id uuid,status text,cancel_request_id uuid,cancelled_at timestamptz,updated_at timestamptz)',
    );
    const sql = fs
      .readFileSync(root + '/supabase/migrations/20260729160000_business_foundation.sql', 'utf8')
      .match(/create or replace function public\.cancel_gift_card_for_iiko\([\s\S]*?\$\$;/i)[0];
    await pg.exec(sql);
    await pg.query(
      "insert into gift_card_pos_reservations(id,branch_id,status) values($1,$2,'active')",
      [reservation, branchB],
    );
    let reservationReads = 0;
    const db = {
      from(table) {
        const q = {
          select() {
            return q;
          },
          eq() {
            return q;
          },
          async maybeSingle() {
            if (table === 'bulka_locations') return { data: { id: branchA }, error: null };
            if (table === 'gift_card_pos_reservations') {
              reservationReads++;
              return { data: { branch_id: branchB }, error: null };
            }
            throw Error(table);
          },
        };
        return q;
      },
      async rpc(name, args) {
        throw Error('Cross-branch mutation must not reach settlement');
      },
    };
    const load = Module._load;
    let router;
    try {
      Module._load = function (request, parent, isMain) {
        if (request === '../config/supabase') return { supabase: db };
        if (request === '../controllers/loyalty.controller')
          return new Proxy({}, { get: () => (_req, res) => res.json({ unused: true }) });
        if (request === '../middlewares/pos-transport.middleware')
          return {
            posTransportMiddleware(req, _res, next) {
              req.pairedPos = { branch_id: branchA, token_hash: 'fixture' };
              next();
            },
          };
        if (request === '../middlewares/rate-limit.middleware')
          return {
            webhookRateLimit(_req, _res, next) {
              next();
            },
          };
        if (request === '../services/pickup-handoff.service')
          return { verifyPluginPickupHandoff: async () => ({}) };
        return load.call(this, request, parent, isMain);
      };
      router = require(root + '/src/routes/loyalty.routes');
    } finally {
      Module._load = load;
    }
    async function invoke(url) {
      return new Promise((resolve, reject) => {
        const req = {
          method: 'POST',
          url,
          originalUrl: url,
          headers: {},
          body: { reservationId: reservation, idempotencyKey: randomUUID() },
        };
        Object.defineProperty(req, 'path', {
          get() {
            return req.url.split('?')[0];
          },
        });
        const headers = {};
        const res = {
          statusCode: 200,
          setHeader(k, v) {
            headers[k] = v;
          },
          getHeader(k) {
            return headers[k];
          },
          status(value) {
            this.statusCode = value;
            return this;
          },
          json(body) {
            resolve({ status: this.statusCode, body });
            return this;
          },
        };
        router.handle(req, res, (error) => reject(error || Error('unmatched route')));
      });
    }
    const canonical = await invoke('/api/loyalty/gift-cards/cancel');
    assert.equal(canonical.status, 401);
    assert.equal(reservationReads, 1);
    assert.equal(
      (await pg.query('select status from gift_card_pos_reservations')).rows[0].status,
      'active',
    );
    const alias = await invoke('/api/loyalty/GIFT-CARDS/cancel');
    assert.equal(alias.status, 401);
    assert.equal(reservationReads, 2);
    assert.equal(
      (await pg.query('select status from gift_card_pos_reservations')).rows[0].status,
      'active',
    );
  } finally {
    await pg.close();
  }
}
test('branch scope is enforced for canonical and case-insensitive gift-card routes', main);

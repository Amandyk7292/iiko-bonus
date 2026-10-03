const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { database } = require('./helpers/photo-report-database.cjs');
const service = require('../src/services/cashier-production.service');
const iiko = require('../src/services/cashier-production-iiko.service');
const bindings = require('../src/services/cashier-production-binding.service');
const { XMLParser } = require('fast-xml-parser');
const pg = new PGlite();
const db = database(pg);
const unitId = randomUUID(),
  sourceStore = randomUUID(),
  targetStore = randomUUID(),
  department = randomUUID();
test.before(async () => {
  await pg.exec(`create role anon;create role authenticated;create role service_role;
   create table bulka_locations(id uuid primary key,name text,address text,city text,active boolean default true);
   create table display_stock_changes(id uuid primary key,branch_id uuid,product_id text,product_name text,unit text,
    before_quantity numeric(14,3),after_quantity numeric(14,3),reason text,created_at timestamptz);
   create table display_stock_report_resets(branch_id uuid,business_date date,reset_at timestamptz,primary key(branch_id,business_date));`);
  await pg.exec(
    readFileSync('supabase/migrations/20261003180000_cashier_iiko_production.sql', 'utf8'),
  );
});
test.after(() => pg.close());
async function fixture({ city = 'Актау', bound = true, mainUnit = 'шт' } = {}) {
  const branch = randomUUID(),
    product = randomUUID();
  const date = (
    await pg.query("select (now() at time zone 'Asia/Aqtau')::date::text as business_day")
  ).rows[0].business_day;
  await pg.query('insert into bulka_locations values($1,$2,$3,$4,true)', [
    branch,
    'Точка',
    'Улица1',
    city,
  ]);
  if (bound)
    await pg.query(
      `insert into cashier_iiko_production_bindings
    (branch_id,server_id,department_id,source_store_id,target_store_id,enabled,updated_by)
    values($1,'aktau-chain',$2,$3,$4,true,'owner')`,
      [branch, department, sourceStore, targetStore],
    );
  const admin = {
    role: 'cashier',
    branchIds: [branch],
    selectedBranchId: randomUUID(),
    sub: 'cashier-a',
  };
  const add = async ({
    quantity = 1,
    unit = 'шт',
    reason = 'receipt',
    at = null,
    before = 0,
    productId = product,
  } = {}) => {
    const id = randomUUID();
    await pg.query('insert into display_stock_changes values($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      id,
      branch,
      productId,
      'Булочка',
      unit,
      before,
      before == null ? quantity : before + quantity,
      reason,
      at || `${date}T12:00:00+05:00`,
    ]);
    return id;
  };
  const reports = {
    listServers: async () => [{ id: 'aktau-chain', city: 'aktau', active: true, configured: true }],
    client: {
      withSession: async (_id, work) =>
        work(async (path) => {
          if (path === 'corporation/departments')
            return {
              corporateItemDtoes: { corporateItemDto: [{ id: department, name: 'Точка' }] },
            };
          if (path === 'corporation/stores')
            return {
              corporateItemDtoes: {
                corporateItemDto: [
                  { id: sourceStore, name: 'Сырьё', parentId: department },
                  { id: targetStore, name: 'Витрина', parentId: department },
                ],
              },
            };
          if (path.startsWith('v2/entities/products'))
            return [
              { id: product, name: 'Булочка', mainUnit: unitId, type: 'DISH', deleted: false },
            ];
          assert.match(path, /rootType=MeasureUnit/);
          return [{ id: unitId, name: mainUnit, deleted: false }];
        }),
    },
  };
  let sends = 0,
    reads = 0,
    createStatus = 'created',
    lookupStatus = 'unknown';
  const options = {
    db,
    reports,
    create: async (act, { beforeSend }) => {
      if (!(await beforeSend())) return { status: 'unknown' };
      sends++;
      assert.equal(act.branch_id, branch);
      return { status: createStatus, documentNumber: 'BP1' };
    },
    find: async () => {
      reads++;
      return { status: lookupStatus, documentNumber: 'BP1' };
    },
  };
  return {
    branch,
    product,
    date,
    admin,
    add,
    options,
    get sends() {
      return sends;
    },
    get reads() {
      return reads;
    },
    setCreate: (v) => {
      createStatus = v;
    },
    setLookup: (v) => {
      lookupStatus = v;
    },
    report: () => service.getCashierProductionReport(admin, date, options),
    send: (eventIds, requestId = randomUUID()) =>
      service.submitCashierProductionAct(admin, { requestId, date, eventIds }, options),
  };
}
test('candidate quantities come only from positive explicit receipt rows, grouped by ID and unit', async () => {
  const f = await fixture();
  const ids = [await f.add({ quantity: 2 }), await f.add({ quantity: 3 })];
  await f.add({ quantity: 10, reason: 'correction' });
  await f.add({ quantity: 5, reason: 'recount' });
  await f.add({ quantity: 100, before: null });
  await f.add({ quantity: -2 });
  const report = await f.report();
  assert.equal(report.branch.id, f.branch);
  assert.equal(report.products.length, 1);
  assert.equal(report.products[0].quantity, 5);
  assert.equal(report.products[0].eligible, true);
  assert.deepEqual(report.products[0].eventIds.sort(), ids.sort());
});

test('manual created confirmation preserves allocation, frozen manifest and first verification; conflicting repeats fail', async () => {
  const f = await fixture(),
    a = await f.add(),
    id = randomUUID();
  f.setCreate('unknown');
  await f.send([a], id);
  await pg.query(
    'update cashier_iiko_production_bindings set server_id=$2,department_id=$3,source_store_id=$4,target_store_id=$5 where branch_id=$1',
    [f.branch, 'different-server', randomUUID(), randomUUID(), randomUUID()],
  );
  const unconfirmed = await service.listUnconfirmedProductionActs(f.branch, f.options);
  assert.deepEqual(
    unconfirmed.map((a) => a.id),
    [id],
  );
  assert.deepEqual(unconfirmed[0].items, [
    { productName: 'Булочка', productId: f.product, quantity: 1, unit: 'шт' },
  ]);
  assert.equal(unconfirmed[0].serverId, 'aktau-chain');
  assert.equal(unconfirmed[0].departmentId, department);
  assert.equal(unconfirmed[0].sourceStoreId, sourceStore);
  assert.equal(unconfirmed[0].targetStoreId, targetStore);
  assert.equal(
    (await f.report()).acts[0].items,
    undefined,
    'cashier act response does not expose private manifest',
  );
  const before = (
    await pg.query('select manifest from cashier_iiko_production_acts where id=$1', [id])
  ).rows[0].manifest;
  const confirmed = await service.resolveProductionAct(
    f.branch,
    id,
    { action: 'created', documentNumber: '  I-123  ', confirmed: true },
    { ...f.options, actor: 'owner-first' },
  );
  assert.equal(confirmed.status, 'created');
  assert.equal(confirmed.documentNumber, 'I-123');
  assert.equal(confirmed.verification.actor, 'owner-first');
  const again = await service.resolveProductionAct(
    f.branch,
    id,
    { action: 'created', documentNumber: 'I-123', confirmed: true },
    { ...f.options, actor: 'owner-second' },
  );
  assert.deepEqual(again.verification, confirmed.verification);
  for (const input of [
    { action: 'not_created', confirmed: true },
    { action: 'created', documentNumber: 'I-456', confirmed: true },
  ])
    await assert.rejects(
      service.resolveProductionAct(f.branch, id, input, f.options),
      (e) => e.code === 'IIKO_PRODUCTION_REQUEST_CONFLICT',
    );
  const late = await db.rpc('finish_cashier_production_send', {
    p_branch: f.branch,
    p_request: id,
    p_status: 'failed',
    p_error: 'late failure',
  });
  assert.ifError(late.error);
  assert.equal(late.data.status, 'created');
  assert.deepEqual(
    (await pg.query('select manifest from cashier_iiko_production_acts where id=$1', [id])).rows[0]
      .manifest,
    before,
  );
  assert.equal((await f.report()).products.length, 0);
  assert.deepEqual(await service.listUnconfirmedProductionActs(f.branch, f.options), []);
  assert.equal(f.sends, 1);
});

test('manual not-created requires expired actual-send lease and preserves terminal decision against late finish', async () => {
  const f = await fixture(),
    a = await f.add({ quantity: 3 }),
    id = randomUUID();
  f.setCreate('unknown');
  await f.send([a], id);
  const input = { action: 'not_created', confirmed: true };
  await assert.rejects(
    service.resolveProductionAct(f.branch, id, input, f.options),
    (e) => e.code === 'IIKO_PRODUCTION_SEND_IN_PROGRESS',
  );
  await assert.rejects(
    service.resolveProductionAct(randomUUID(), id, input, f.options),
    (e) => e.code === 'IIKO_PRODUCTION_BRANCH_UNAVAILABLE',
  );
  const other = await fixture();
  await assert.rejects(
    service.resolveProductionAct(other.branch, id, input, other.options),
    (e) => e.code === 'IIKO_PRODUCTION_REQUEST_CONFLICT',
  );
  await assert.rejects(
    service.resolveProductionAct(f.branch, id, { ...input, confirmed: false }, f.options),
    (e) => e.code === 'IIKO_PRODUCTION_INPUT_INVALID',
  );
  await pg.query(
    "update cashier_iiko_production_acts set send_started_at=now()-interval '6 minutes' where id=$1",
    [id],
  );
  const confirmed = await service.resolveProductionAct(f.branch, id, input, {
    ...f.options,
    actor: 'verified-owner',
  });
  assert.equal(confirmed.status, 'failed');
  assert.equal(confirmed.errorCode, 'IIKO_PRODUCTION_NOT_CREATED');
  assert.equal((await f.report()).products[0].quantity, 3);
  const again = await service.resolveProductionAct(f.branch, id, input, {
    ...f.options,
    actor: 'other-owner',
  });
  assert.deepEqual(again.verification, confirmed.verification);
  const late = await db.rpc('finish_cashier_production_send', {
    p_branch: f.branch,
    p_request: id,
    p_status: 'created',
    p_number: 'late-doc',
  });
  assert.ifError(late.error);
  assert.equal(late.data.status, 'failed');
  assert.equal((await f.send([a], id)).act.status, 'failed');
  assert.equal(f.sends, 1);
  f.setCreate('created');
  assert.equal((await f.send([a])).act.status, 'created');
  assert.equal(f.sends, 2);
  assert.equal(
    (await pg.query('select count(*) n from display_stock_changes where branch_id=$1', [f.branch]))
      .rows[0].n,
    1,
  );
});

test('late queued send after authoritative manual release is fenced before any XML and cannot overwrite confirmation', async () => {
  const f = await fixture(),
    a = await f.add(),
    id = randomUUID();
  let entered, release;
  const enteredPromise = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let imports = 0;
  f.options.create = async (act, { beforeSend }) => {
    entered();
    await gate;
    if (!(await beforeSend())) return { status: 'unknown' };
    imports++;
    return { status: 'created', documentNumber: 'late' };
  };
  const request = f.send([a], id);
  await enteredPromise;
  await pg.query(
    "update cashier_iiko_production_acts set updated_at=now()-interval '2 minutes' where id=$1",
    [id],
  );
  const live = await service.getCashierProductionReport(f.admin, f.date, {
    ...f.options,
    now: Date.now() + 120000,
  });
  assert.equal(live.acts[0].status, 'sending', 'a live local promise is not aged into unknown');
  // Another server process may classify a lost/queued write as unknown; the DB fence is authoritative.
  await db.rpc('finish_cashier_production_send', {
    p_branch: f.branch,
    p_request: id,
    p_status: 'unknown',
  });
  const resolved = await service.resolveProductionAct(
    f.branch,
    id,
    { action: 'not_created', confirmed: true },
    { ...f.options, actor: 'owner' },
  );
  assert.equal(resolved.status, 'failed');
  release();
  assert.equal((await request).act.status, 'failed');
  assert.equal(imports, 0);
  assert.equal((await f.report()).products[0].quantity, 1);
  const start = await db.rpc('start_cashier_production_http', {
    p_branch: f.branch,
    p_request: id,
  });
  assert.ifError(start.error);
  assert.equal(start.data, false);
});

test('privileged production decisions have no public, anon or authenticated execution grants', async () => {
  for (const role of ['anon', 'authenticated']) {
    const result = await pg.query(
      `select has_function_privilege($1,'public.resolve_cashier_production_act(uuid,uuid,text,text,boolean,text)','EXECUTE') allowed,
      has_function_privilege($1,'public.start_cashier_production_http(uuid,uuid)','EXECUTE') send_allowed,
      has_table_privilege($1,'public.cashier_iiko_production_acts','UPDATE') update_allowed`,
      [role],
    );
    assert.deepEqual(result.rows[0], {
      allowed: false,
      send_allowed: false,
      update_allowed: false,
    });
  }
});
test('one act freezes selected server quantities and no local stock write; another UUID cannot reuse events', async () => {
  const f = await fixture();
  const a = await f.add({ quantity: 2 }),
    b = await f.add({ quantity: 3 }),
    id = randomUUID();
  const first = await f.send([b, a], id);
  assert.equal(first.act.status, 'created');
  const row = (await pg.query('select * from cashier_iiko_production_acts where id=$1', [id]))
    .rows[0];
  assert.equal(row.source_store_id, sourceStore);
  assert.equal(row.target_store_id, targetStore);
  assert.equal(row.manifest.items[0].quantity, 5);
  assert.equal(row.manifest.items[0].productId, f.product);
  assert.equal(row.manifest.items[0].amountUnit, unitId);
  assert.equal(row.manifest.postImmediately, false);
  assert.equal((await f.send([a, b], id)).act.id, id);
  assert.equal(f.sends, 1);
  await assert.rejects(f.send([a, b]), (e) => e.code === 'IIKO_PRODUCTION_EVENTS_CHANGED');
  await assert.rejects(f.send([a], id), (e) => e.code === 'IIKO_PRODUCTION_REQUEST_CONFLICT');
  assert.equal((await f.report()).products.length, 0);
  assert.equal(
    (await pg.query('select count(*) n from display_stock_changes where branch_id=$1', [f.branch]))
      .rows[0].n,
    2,
  );
});
test('unknown keeps event allocation, duplicate payload never reimports, read reconciliation confirms created', async () => {
  const f = await fixture();
  f.setCreate('unknown');
  const a = await f.add(),
    id = randomUUID();
  assert.equal((await f.send([a], id)).act.status, 'unknown');
  assert.equal((await f.send([a], id)).act.status, 'unknown');
  assert.equal(f.sends, 1);
  await assert.rejects(f.send([a]), (e) => e.code === 'IIKO_PRODUCTION_EVENTS_CHANGED');
  f.setLookup('created');
  assert.equal((await f.report()).acts[0].status, 'created');
  assert.equal(f.sends, 1);
  assert.ok(f.reads >= 2);
});
test('definitive failed creation releases rows for a fresh explicit request but never repeats old UUID', async () => {
  const f = await fixture();
  f.setCreate('failed');
  const a = await f.add(),
    id = randomUUID();
  assert.equal((await f.send([a], id)).act.status, 'failed');
  assert.equal((await f.report()).products[0].quantity, 1);
  f.setCreate('created');
  assert.equal((await f.send([a], id)).act.status, 'failed');
  assert.equal(f.sends, 1);
  assert.equal((await f.send([a])).act.status, 'created');
  assert.equal(f.sends, 2);
});
test('report reset does not release submitted events or change frozen duplicate request; old unallocated events are hidden', async () => {
  const f = await fixture();
  const a = await f.add(),
    old = await f.add(),
    id = randomUUID();
  await f.send([a], id);
  await pg.query('insert into display_stock_report_resets values($1,$2,$3)', [
    f.branch,
    f.date,
    `${f.date}T13:00:00+05:00`,
  ]);
  const next = await f.add({ quantity: 4, at: `${f.date}T14:00:00+05:00` });
  assert.deepEqual((await f.report()).products[0].eventIds, [next]);
  assert.equal((await f.send([a], id)).act.status, 'created');
  assert.equal(f.sends, 1);
  await assert.rejects(f.send([old]), (e) => e.code === 'IIKO_PRODUCTION_EVENTS_CHANGED');
});
test('fractional main-unit mismatch, custom IDs and cross-city prefixes stay ineligible', async () => {
  const f = await fixture();
  await f.add({ quantity: 0.125, unit: 'кг' });
  await f.add({ productId: `astana:${f.product}` });
  await f.add({ productId: `custom-${randomUUID()}` });
  const report = await f.report();
  assert.ok(report.products.every((p) => !p.eligible));
  assert.ok(report.products.some((p) => p.reasonCode === 'IIKO_PRODUCTION_UNIT_MISMATCH'));
  assert.ok(report.products.some((p) => p.reasonCode === 'IIKO_PRODUCTION_PRODUCT_UNMAPPED'));
});

test('main-unit fractional amounts are eligible and preserve their exact receipt delta in the frozen act', async () => {
  const f = await fixture({ mainUnit: 'кг' });
  const a = await f.add({ quantity: 0.125, unit: 'кг' }),
    b = await f.add({ quantity: 2, unit: 'кг' }),
    id = randomUUID();
  assert.equal((await f.report()).products[0].quantity, 2.125);
  assert.equal((await f.report()).products[0].eligible, true);
  assert.equal((await f.send([b, a], id)).act.status, 'created');
  const row = (
    await pg.query('select manifest from cashier_iiko_production_acts where id=$1', [id])
  ).rows[0];
  assert.equal(row.manifest.items[0].quantity, 2.125);
  assert.equal(row.manifest.items[0].amountUnit, unitId);
});

test('historical unit aliases become one canonical production item and retry never writes a second XML', async () => {
  const f = await fixture(),
    ids = [
      await f.add({ quantity: 2, unit: 'шт' }),
      await f.add({ quantity: 3, unit: 'шт.', productId: f.product.toUpperCase() }),
    ],
    id = randomUUID(),
    xmls = [];
  f.options.create = (act, options) =>
    iiko.createProductionDocument(act, {
      ...options,
      reports: {
        client: {
          withSession: async (server, work) => {
            assert.equal(server, 'aktau-chain');
            return work(async (path, xml, format, bodyFormat) => {
              assert.equal(path, 'documents/import/productionDocument');
              assert.equal(format, 'xml');
              assert.equal(bodyFormat, 'xml');
              xmls.push(xml);
              return {
                documentValidationResult: {
                  valid: true,
                  warning: false,
                  documentNumber: iiko.numberFor(act),
                },
              };
            });
          },
        },
      },
    });
  assert.ok((await f.report()).products.every((p) => p.eligible));
  assert.equal((await f.send(ids, id)).act.status, 'created');
  const parsed = new XMLParser().parse(xmls[0]);
  assert.equal(parsed.document.items.item.amount, 5);
  assert.equal(parsed.document.items.item.product, f.product);
  assert.equal(parsed.document.items.item.amountUnit, unitId);
  assert.equal((await f.send(ids, id)).act.status, 'created');
  assert.equal(xmls.length, 1);
  assert.equal((await f.report()).products.length, 0);
});

test('local canonical amount preflight failure releases events and has zero upstream writes', async () => {
  const f = await fixture(),
    ids = [
      await f.add({ quantity: 60000, unit: 'шт' }),
      await f.add({ quantity: 60000, unit: 'шт.' }),
    ],
    id = randomUUID();
  let imports = 0;
  f.options.create = (act, options) =>
    iiko.createProductionDocument(act, {
      ...options,
      reports: {
        client: {
          withSession: async () => {
            imports++;
            throw Error('Must not enter a session');
          },
        },
      },
    });
  const response = await f.send(ids, id);
  assert.equal(response.act.status, 'failed');
  assert.equal(imports, 0);
  assert.equal((await f.report()).products.length, 2);
  assert.equal((await f.send(ids, id)).act.status, 'failed');
  assert.equal(imports, 0);
  assert.equal(
    (
      await pg.query('select count(*) n from cashier_iiko_production_allocations where act_id=$1', [
        id,
      ])
    ).rows[0].n,
    0,
  );
});

test('candidates respect exact assigned point and local midnight boundaries independent of event paging', async () => {
  const f = await fixture(),
    other = await fixture();
  const ids = [
    await f.add({ at: `${f.date}T00:00:00+05:00` }),
    await f.add({ at: `${f.date}T23:59:59.999+05:00` }),
  ];
  const tomorrow = new Date(`${f.date}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  await f.add({ at: `${f.date}T00:00:00+06:00`, quantity: 999 });
  await f.add({ at: `${tomorrow.toISOString().slice(0, 10)}T00:00:00+05:00`, quantity: 999 });
  await other.add({ quantity: 999 });
  for (let i = 0; i < 105; i++) ids.push(await f.add());
  const report = await f.report();
  assert.equal(report.products[0].quantity, 107);
  assert.deepEqual(report.products[0].eventIds.sort(), ids.sort());
});
test('cashier role/assigned point, missing binding and mismatched city never import', async () => {
  const f = await fixture({ bound: false });
  await f.add();
  assert.equal((await f.report()).enabled, false);
  await assert.rejects(
    service.getCashierProductionReport({ role: 'owner', branchIds: [f.branch] }, f.date, f.options),
    { statusCode: 403 },
  );
  await assert.rejects(
    service.getCashierProductionReport(
      { role: 'cashier', branchIds: [f.branch, randomUUID()] },
      f.date,
      f.options,
    ),
    { statusCode: 403 },
  );
  const wrong = await fixture({ city: 'Астана' });
  await wrong.add();
  const report = await wrong.report();
  assert.equal(report.enabled, false);
  assert.equal(report.unavailableReasonCode, 'IIKO_PRODUCTION_CITY_MISMATCH');
  assert.equal(wrong.sends, 0);
});
test('database claim validates date/snapshot revision and recomputes amount without trusting passed product quantity', async () => {
  const f = await fixture(),
    a = await f.add({ quantity: 2.125, unit: 'кг' });
  const binding = (
    await pg.query('select * from cashier_iiko_production_bindings where branch_id=$1', [f.branch])
  ).rows[0];
  const args = {
    p_branch: f.branch,
    p_date: f.date,
    p_request: randomUUID(),
    p_actor: 'cashier',
    p_event_ids: [a],
    p_products: [
      {
        localProductId: f.product,
        unit: 'кг',
        productId: f.product,
        amountUnit: unitId,
        quantity: 999,
      },
    ],
    p_binding_revision: binding.updated_at,
  };
  assert.ok(
    (
      await db.rpc('claim_cashier_production_act', {
        ...args,
        p_binding_revision: '2000-01-01T00:00:00Z',
      })
    ).error,
  );
  const result = await db.rpc('claim_cashier_production_act', args);
  assert.ifError(result.error);
  assert.equal(result.data.manifest.items[0].quantity, 2.125);
  const duplicate = await db.rpc('claim_cashier_production_act', {
    ...args,
    p_request: randomUUID(),
  });
  assert.match(duplicate.error.message, /EVENTS_CHANGED/);
});

test('binding saves only explicit same-department stores at an active same-city point', async () => {
  const f = await fixture({ bound: false });
  const input = {
    serverId: 'aktau-chain',
    departmentId: department,
    sourceStoreId: sourceStore,
    targetStoreId: targetStore,
    enabled: true,
    postImmediately: false,
  };
  await assert.rejects(
    bindings.saveProductionBinding(f.branch, { ...input, targetStoreId: randomUUID() }, f.options),
    (e) => e.code === 'IIKO_PRODUCTION_STORE_MISMATCH',
  );
  assert.equal(await bindings.readProductionBinding(f.branch, f.options), null);
  assert.deepEqual(
    await bindings.saveProductionBinding(f.branch, input, { ...f.options, actor: 'owner' }),
    input,
  );
  assert.deepEqual(await bindings.readProductionBinding(f.branch, f.options), input);
  await pg.query('update bulka_locations set active=false where id=$1', [f.branch]);
  await assert.rejects(
    bindings.saveProductionBinding(f.branch, input, f.options),
    (e) => e.code === 'IIKO_PRODUCTION_BRANCH_UNAVAILABLE',
  );
});

test('claim-before-send interruption is publicly resumable after session restart without a new act or double import', async () => {
  const f = await fixture(),
    a = await f.add({ quantity: 2 }),
    id = randomUUID();
  let interrupted = false;
  f.options.db = {
    ...db,
    rpc: async (name, args) => {
      if (name === 'begin_cashier_production_send' && !interrupted) {
        interrupted = true;
        return { error: new Error('Injected interruption before send') };
      }
      return db.rpc(name, args);
    },
  };
  await assert.rejects(f.send([a], id), /Injected interruption/);
  assert.equal(f.sends, 0);
  const report = await f.report(),
    pending = report.acts[0];
  assert.equal(pending.status, 'pending');
  assert.equal(pending.id, id);
  assert.equal(pending.date, f.date);
  assert.deepEqual(pending.eventIds, [a]);
  assert.equal(report.products.length, 0);
  assert.equal(f.sends, 0, 'GET does not create documents');
  const response = await service.submitCashierProductionAct(
    { ...f.admin, sub: 'cashier-new-session' },
    { requestId: pending.id, date: pending.date, eventIds: pending.eventIds },
    f.options,
  );
  assert.equal(response.act.status, 'created');
  assert.equal(f.sends, 1);
  await f.send([a], id);
  assert.equal(f.sends, 1);
  assert.equal(
    (
      await pg.query('select count(*) n from cashier_iiko_production_acts where branch_id=$1', [
        f.branch,
      ])
    ).rows[0].n,
    1,
  );
});

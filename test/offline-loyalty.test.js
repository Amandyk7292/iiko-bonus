const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const customerId = crypto.randomUUID(),
  branchId = crypto.randomUUID();
const phone = '77000000001';
let loseCommitAcknowledgement = false;
function stub(module, exports) {
  const path = require.resolve(module);
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}
const supabase = {
  from(table) {
    assert.ok(['customers', 'loyalty_reservations', 'iiko_operation_logs'].includes(table));
    const clauses = [],
      values = [];
    let insert = false,
      limit = 100;
    const read = async () =>
      insert
        ? { data: null, error: null }
        : {
            data: (
              await db.query(
                `select * from ${table}${clauses.length ? ' where ' + clauses.join(' and ') : ''} limit ${limit}`,
                values,
              )
            ).rows,
          };
    const query = {
      select() {
        return query;
      },
      eq(key, value) {
        assert.match(key, /^[a-z_]+$/);
        values.push(value);
        clauses.push(`${key}=$${values.length}`);
        return query;
      },
      in(key, entries) {
        assert.match(key, /^[a-z_]+$/);
        const refs = entries.map((value) => {
          values.push(value);
          return `$${values.length}`;
        });
        clauses.push(`${key} in (${refs.join(',')})`);
        return query;
      },
      limit(value) {
        limit = Number(value);
        return query;
      },
      insert() {
        insert = true;
        return query;
      },
      async maybeSingle() {
        const result = await read();
        return { ...result, data: result.data?.[0] || null };
      },
      async single() {
        return query.maybeSingle();
      },
      then(resolve, reject) {
        return read().then(resolve, reject);
      },
    };
    return query;
  },
  async rpc(name, args) {
    assert.ok(
      [
        'reserve_branch_loyalty_balance',
        'commit_branch_loyalty_reservation',
        'cancel_branch_loyalty_reservation',
        'family_bonus_owner_at',
      ].includes(name),
    );
    try {
      const keys = Object.keys(args);
      const result = await db.query(
        `select ${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(',')}) as result`,
        keys.map((key) => (Array.isArray(args[key]) ? JSON.stringify(args[key]) : args[key])),
      );
      if (name === 'commit_branch_loyalty_reservation' && loseCommitAcknowledgement) {
        loseCommitAcknowledgement = false;
        return { error: new Error('Simulated lost acknowledgement after committed credit') };
      }
      return { data: result.rows[0].result };
    } catch (error) {
      return { error };
    }
  },
};
stub('../src/config/supabase', { supabase });
stub('../src/services/settings.service', {
  getSettings: async () => ({
    max_discount_percent: 50,
    base_cashback_percent: 5,
    bonus_activation: { enabled: false },
  }),
});
stub('../src/services/tier.service', { getActiveLoyaltyTiers: async () => [] });
stub('../src/services/loyalty-sync.service', { queueCustomerLoyaltySync() {} });
stub('../src/services/push.service', { notifyBonusChange: async () => {} });
const customerService = require('../src/services/customer.service');
customerService.activatePendingBonusesSafe = async () => {};
const { resolveOfflineLoyaltyCustomer } = require('../src/services/offline-loyalty.service');
const { earnOfflineBonus } = require('../src/controllers/loyalty.controller');
const { loyaltyOfflineEarnBodySchema } = require('../src/contracts/loyalty.contract');
const read = (file) => fs.readFileSync(file, 'utf8');
const functionSql = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n$$;', start) + 4);
};

test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key, phone text, name text default 'Adult', deleted_at timestamptz, balance numeric default 0,
      total_spent numeric default 0, created_at timestamptz default now(), updated_at timestamptz default now());
    create table transactions(id uuid primary key default gen_random_uuid(), customer_id uuid, order_id text,
      type text, amount numeric, order_total numeric, description text, items jsonb, branch_id uuid,
      available_at timestamptz, activated_at timestamptz, created_at timestamptz default now(), timestamp timestamptz default now());
    create table bulka_locations(id uuid primary key,active boolean default true);
    create table iiko_operation_logs(branch_id uuid,created_at timestamptz);`);
  await db.exec(functionSql(read('supabase_schema.sql'), 'apply_loyalty_transaction'));
  const base = read('supabase/migrations/20260713190000_order_fulfillment.sql');
  const end =
    base.indexOf(';', base.indexOf('grant execute on function public.cancel_loyalty_reservation')) +
    1;
  await db.exec(
    base.slice(base.indexOf('create table if not exists public.loyalty_reservations'), end),
  );
  const scoped = read('supabase/migrations/20260810110000_backend_rbac_financial_hardening.sql');
  await db.exec(scoped.slice(0, scoped.indexOf('alter table public.gift_cards')));
  await db.exec(read('supabase/migrations/20260910190000_loyalty_retry_after_cancel.sql'));
  await db.exec(read('supabase/migrations/20261002170000_customer_family.sql'));
  await db.exec(read('supabase/migrations/20261002172500_family_offline_bonus.sql'));
  await db.query('insert into customers(id,phone) values($1,$2)', [customerId, phone]);
  await db.query('insert into bulka_locations(id) values($1)', [branchId]);
});
test.after(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await db.close();
});

function receipt(capturedPhone = phone) {
  const scanned = new Date(Date.now() - 3 * 86400000);
  const window = Math.floor(scanned.getTime() / 300000);
  const hash = crypto
    .createHmac('sha256', process.env.BULKA_SECRET)
    .update(`${capturedPhone}:${window}`)
    .digest('hex')
    .slice(0, 16);
  return {
    customerCode: `BULKA-OTP-${capturedPhone}-${window}-${hash}`,
    scannedAtUtc: scanned.toISOString(),
    paidAtUtc: new Date(scanned.getTime() + 60000).toISOString(),
    orderId: crypto.randomUUID(),
    orderTotal: 1000,
    items: [{ productId: 'test', productName: 'Булочка', amount: 2, price: 500, total: 1000 }],
  };
}
const response = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
async function send(body, context = { posBranchId: branchId, posAuthMode: 'branch' }) {
  const res = response();
  await earnOfflineBonus({ ...context, body: { ...body } }, res);
  return res;
}

test('a QR scanned before an outage is verified at scan time without weakening live search', async () => {
  const body = receipt();
  await assert.rejects(customerService.searchCustomers(body.customerCode), /Срок действия QR/);
  assert.equal(await resolveOfflineLoyaltyCustomer(body), customerId);
  await assert.rejects(
    resolveOfflineLoyaltyCustomer({
      ...body,
      customerCode: body.customerCode.slice(0, -16) + '0'.repeat(16),
    }),
    /поддельный/,
  );
  await assert.rejects(
    resolveOfflineLoyaltyCustomer({ ...body, scannedAtUtc: new Date().toISOString() }),
    /Некорректное время/,
  );
  await assert.rejects(
    resolveOfflineLoyaltyCustomer({ ...body, customerCode: '+77000000001' }),
    /QR-код/,
  );
});

test('offline accrual requires branch authentication and cannot carry a write-off', async () => {
  const body = receipt();
  assert.equal((await send(body, { posAuthMode: 'legacy' })).statusCode, 401);
  assert.equal(
    (await send({ ...body, customerCode: body.customerCode.slice(0, -16) + '0'.repeat(16) }))
      .statusCode,
    422,
  );
  assert.equal(loyaltyOfflineEarnBodySchema.safeParse(body).success, true);
  assert.equal(
    loyaltyOfflineEarnBodySchema.safeParse({ ...body, discountAmount: 100 }).success,
    false,
  );
  assert.equal(loyaltyOfflineEarnBodySchema.safeParse({ ...body, customerId }).success, false);
  const router = require('../src/routes/loyalty.routes');
  const route = router.stack.find(
    (layer) => layer.route?.path === '/api/loyalty/offline-earn',
  ).route;
  assert.ok(route.stack.some((layer) => layer.handle.name === 'branchPosAuthMiddleware'));
});

test('offline replay asks the historical bonus mapper for the verified scan instant', async () => {
  const body = receipt();
  const parent = crypto.randomUUID();
  let captured;
  assert.equal(
    await resolveOfflineLoyaltyCustomer(body, {
      bonusOwnerAt: async (id, at) => {
        captured = { id, at };
        return parent;
      },
    }),
    parent,
  );
  assert.deepEqual(captured, { id: customerId, at: body.scannedAtUtc });
  await assert.rejects(
    resolveOfflineLoyaltyCustomer(
      { ...body, customerCode: 'BULKA-FAMILY:opaque' },
      {
        bonusOwnerAt: () =>
          assert.fail('an online-only family QR must not reach the historical mapper'),
      },
    ),
    /QR-код/,
  );
});

test('default family mapping honors feature flag and fails instead of redirecting deleted historical owners', async () => {
  const body = receipt();
  const owner = crypto.randomUUID(),
    group = crypto.randomUUID(),
    member = crypto.randomUUID();
  const joined = new Date(Date.parse(body.scannedAtUtc) - 86400000).toISOString();
  const removed = new Date(Date.parse(body.scannedAtUtc) + 86400000).toISOString();
  await db.query('insert into customers(id,phone) values($1,$2)', [owner, '77000000002']);
  await db.query('insert into family_groups(id,owner_customer_id) values($1,$2)', [group, owner]);
  await db.query(
    "insert into family_members(id,group_id,customer_id,name,relation,status,created_at,updated_at) values($1,$2,$3,'Adult','wife','removed',$4,$5)",
    [member, group, customerId, joined, removed],
  );
  const previous = process.env.CUSTOMER_FAMILY_ENABLED;
  try {
    process.env.CUSTOMER_FAMILY_ENABLED = 'false';
    assert.equal(await resolveOfflineLoyaltyCustomer(body), customerId);
    process.env.CUSTOMER_FAMILY_ENABLED = 'true';
    assert.equal(await resolveOfflineLoyaltyCustomer(body), owner);
    await db.query('update customers set deleted_at=now() where id=$1', [owner]);
    await assert.rejects(resolveOfflineLoyaltyCustomer(body), (error) => error.statusCode === 404);
  } finally {
    if (previous === undefined) delete process.env.CUSTOMER_FAMILY_ENABLED;
    else process.env.CUSTOMER_FAMILY_ENABLED = previous;
  }
});

test('a paid offline receipt earns once after a lost response and repeated reconnects', async () => {
  const body = receipt();
  loseCommitAcknowledgement = true;
  const first = await send(body);
  assert.equal(first.statusCode, 500);
  for (let retry = 0; retry < 3; retry++) {
    const result = await send(body);
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(result.body.duplicate, true);
  }
  const state = (
    await db.query('select balance,total_spent from customers where id=$1', [customerId])
  ).rows[0];
  assert.equal(Number(state.balance), 50);
  assert.equal(Number(state.total_spent), 1000);
  const transactions = (
    await db.query('select type,amount from transactions where customer_id=$1', [customerId])
  ).rows;
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].type, 'deposit');
  assert.equal(Number(transactions[0].amount), 50);
});

test('a delayed family receipt credits its original owner once after leaving and losing the commit response', async () => {
  const actor = crypto.randomUUID(),
    owner = crypto.randomUUID(),
    group = crypto.randomUUID(),
    member = crypto.randomUUID();
  const actorPhone = '77000000009';
  const body = receipt(actorPhone);
  const joined = new Date(Date.parse(body.scannedAtUtc) - 86400000).toISOString();
  const removed = new Date(Date.parse(body.scannedAtUtc) + 86400000).toISOString();
  await db.query('insert into customers(id,phone) values($1,$2),($3,$4)', [
    actor,
    actorPhone,
    owner,
    '77000000008',
  ]);
  await db.query('insert into family_groups(id,owner_customer_id) values($1,$2)', [group, owner]);
  await db.query(
    "insert into family_members(id,group_id,customer_id,name,relation,status,created_at,updated_at) values($1,$2,$3,'Adult','brother','removed',$4,$5)",
    [member, group, actor, joined, removed],
  );
  const previous = process.env.CUSTOMER_FAMILY_ENABLED;
  try {
    process.env.CUSTOMER_FAMILY_ENABLED = 'true';
    loseCommitAcknowledgement = true;
    assert.equal((await send(body)).statusCode, 500);
    for (let retry = 0; retry < 3; retry++) {
      const result = await send(body);
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
      assert.equal(result.body.duplicate, true);
    }
    const ownerState = (
      await db.query('select balance,total_spent from customers where id=$1', [owner])
    ).rows[0];
    assert.equal(Number(ownerState.balance), 50);
    assert.equal(Number(ownerState.total_spent), 1000);
    assert.equal(
      Number(
        (await db.query('select balance from customers where id=$1', [actor])).rows[0].balance,
      ),
      0,
    );
    assert.equal(
      (
        await db.query('select customer_id from transactions where customer_id in ($1,$2)', [
          actor,
          owner,
        ])
      ).rows.length,
      1,
    );
  } finally {
    if (previous === undefined) delete process.env.CUSTOMER_FAMILY_ENABLED;
    else process.env.CUSTOMER_FAMILY_ENABLED = previous;
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const sqlFunction = (source, name) => {
  const start = source.indexOf('create or replace function public.' + name + '(');
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('$$;', start) + 3);
};
test.before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table customers(id uuid primary key,balance numeric,total_spent numeric default 0,created_at timestamptz default now(),updated_at timestamptz);
    create table transactions(id uuid default gen_random_uuid(),customer_id uuid,order_id text,type text,amount numeric,order_total numeric,
      description text,items jsonb,available_at timestamptz,activated_at timestamptz,timestamp timestamptz default now());
    create table loyalty_reservations(customer_id uuid,status text,discount_amount numeric,expires_at timestamptz);`);
  await db.exec(
    sqlFunction(readFileSync('supabase_schema.sql', 'utf8'), 'apply_loyalty_transaction'),
  );
  await db.exec(
    sqlFunction(
      readFileSync(
        'supabase/migrations/20260907140000_customer_bonus_expiration_dates.sql',
        'utf8',
      ),
      'customer_bonus_activity',
    ),
  );
  await db.exec(
    readFileSync('supabase/migrations/20261004102000_bonus_expiry_activity_lock.sql', 'utf8'),
  );
});
test.after(() => db.close());
async function inactive() {
  const customer = randomUUID();
  await db.query(
    "insert into customers(id,balance,created_at) values($1,1000,now()-interval '120 days')",
    [customer],
  );
  await db.query(
    "insert into transactions(customer_id,order_id,type,amount,timestamp) values($1,'old','deposit',1000,now()-interval '100 days')",
    [customer],
  );
  return customer;
}
test('real expiration worker rechecks activity after a purchase with pending cashback and unchanged active balance', async (t) => {
  const customer = await inactive();
  let purchased = false,
    cutoff;
  const client = {
    from() {
      return {
        select() {
          return this;
        },
        gt() {
          return this;
        },
        order() {
          return this;
        },
        async range() {
          return {
            data: (await db.query('select * from customers where id=$1', [customer])).rows,
            error: null,
          };
        },
      };
    },
    async rpc(name, args) {
      if (name === 'customer_bonus_activity')
        return {
          data: (await db.query('select * from customer_bonus_activity($1)', [args.p_customer_ids]))
            .rows,
          error: null,
        };
      assert.equal(name, 'expire_customer_bonus');
      cutoff = args.p_inactive_before;
      assert.ok(Date.parse(cutoff) < Date.now());
      await db.query(
        "select apply_loyalty_transaction($1,'fresh-purchase',0,60,2000,2000,1,'[]')",
        [customer],
      );
      purchased = true;
      return {
        data: (
          await db.query('select expire_customer_bonus($1,$2,$3,$4) result', [
            args.p_customer_id,
            args.p_expected_balance,
            args.p_order_id,
            args.p_inactive_before,
          ])
        ).rows[0].result,
        error: null,
      };
    },
  };
  const cached = new Map();
  const stub = (path, exports) => {
    const id = require.resolve(path);
    cached.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };
  stub('../src/config/supabase', { supabase: client });
  stub('../src/services/loyalty-sync.service', { queueCustomerLoyaltySync() {} });
  stub('../src/services/realtime.service', { publish() {} });
  stub('../src/services/settings.service', { getSettings: async () => ({}) });
  const path = require.resolve('../src/services/customer.service');
  cached.set(path, require.cache[path]);
  delete require.cache[path];
  t.after(() => {
    for (const [id, old] of cached)
      if (old) require.cache[id] = old;
      else delete require.cache[id];
  });
  const result = await require(path).checkAndExpireInactiveBonuses(90);
  assert.equal(purchased, true);
  assert.equal(result.expiredCount, 0);
  assert.equal(result.totalExpiredAmount, 0);
  assert.equal(
    Number(
      (await db.query('select balance from customers where id=$1', [customer])).rows[0].balance,
    ),
    1000,
  );
});
test('inactive expiry protects held bonuses, stays idempotent, and rejects calls without a policy cutoff', async () => {
  const customer = await inactive(),
    cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  await db.query("insert into loyalty_reservations values($1,'active',400,'infinity')", [customer]);
  assert.equal(
    Number(
      (await db.query("select expire_customer_bonus($1,1000,'burn',$2) n", [customer, cutoff]))
        .rows[0].n,
    ),
    600,
  );
  assert.equal(
    Number(
      (await db.query("select expire_customer_bonus($1,1000,'burn',$2) n", [customer, cutoff]))
        .rows[0].n,
    ),
    0,
  );
  assert.equal(
    Number(
      (await db.query("select expire_customer_bonus($1,400,'legacy-burn') n", [customer])).rows[0]
        .n,
    ),
    0,
  );
  assert.equal(
    Number(
      (await db.query('select balance from customers where id=$1', [customer])).rows[0].balance,
    ),
    400,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) n from transactions where customer_id=$1 and type='expiration'",
          [customer],
        )
      ).rows[0].n,
    ),
    1,
  );
  for (const role of ['anon', 'authenticated'])
    assert.equal(
      (
        await db.query('select has_function_privilege($1,$2,$3) allowed', [
          role,
          'expire_customer_bonus(uuid,numeric,text,timestamp with time zone)',
          'EXECUTE',
        ])
      ).rows[0].allowed,
      false,
    );
});

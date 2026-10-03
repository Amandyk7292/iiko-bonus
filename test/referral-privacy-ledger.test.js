// Isolated SQL audit: no remote database, SMS, orders, or payments.
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const { randomUUID, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const Module = require('node:module');
const project = require('node:path').resolve(__dirname, '..');
const requireProject = createRequire(project + '/package.json');
const { PGlite } = requireProject('@electric-sql/pglite');
const db = new PGlite();
const sql = (name) => readFileSync(project + '/supabase/migrations/' + name, 'utf8');
const hash = () => randomBytes(32).toString('hex');
function extractFunction(source, name) {
  const start = source.search(
    new RegExp('create(?: or replace)? function public\\.' + name + '\\('),
  );
  assert(start >= 0, 'actual SQL function found: ' + name);
  const end = source.indexOf('$$;', start);
  assert(end > start, 'actual SQL function terminator found: ' + name);
  return source.slice(start, end + 3);
}
async function fixture() {
  const owner = randomUUID(),
    friend = randomUUID(),
    order = randomUUID(),
    code = 'BULKA-' + randomUUID().slice(0, 8);
  for (const id of [owner, friend]) {
    await db.query('insert into customers(id,phone) values($1,$2)', [
      id,
      id === owner ? '+77750000001' : '+77750000002',
    ]);
    await db.query('select remember_stable_referral_device($1,$2,$3,$4,$5,$6,$7)', [
      id,
      hash(),
      hash(),
      'android_id',
      hash(),
      hash(),
      false,
    ]);
  }
  await db.query('insert into referral_codes(customer_id,code) values($1,$2)', [owner, code]);
  await db.query('select redeem_referral_code($1,$2)', [friend, code]);
  await db.query(
    "insert into kaspi_orders(id,customer_id,amount,status,fulfillment_status) values($1,$2,2000,'paid','completed')",
    [order, friend],
  );
  const reward = (await db.query('select process_referral_purchase($1) result', [friend])).rows[0]
    .result;
  assert.equal(reward.status, 'rewarded');
  return { owner, friend, order };
}
async function balance(id) {
  return Number(
    (await db.query('select balance from customers where id=$1', [id])).rows[0].balance,
  );
}
class Query {
  constructor(table) {
    this.table = table;
    this.columns = '*';
    this.op = 'select';
    this.filters = [];
    this.values = [];
  }
  select(columns = '*') {
    this.columns = columns;
    return this;
  }
  eq(column, value) {
    this.values.push(value);
    this.filters.push(column + '=$' + this.values.length);
    return this;
  }
  in(column, values) {
    this.values.push(values);
    this.filters.push(column + '=any($' + this.values.length + ')');
    return this;
  }
  insert(payload) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  async execute(single = false) {
    try {
      let query,
        values = this.values;
      if (this.op === 'insert') {
        const keys = Object.keys(this.payload);
        values = Object.values(this.payload);
        query =
          'insert into ' +
          this.table +
          '(' +
          keys.join(',') +
          ') values(' +
          keys.map((_, i) => '$' + (i + 1)).join(',') +
          ') returning ' +
          this.columns;
      } else if (this.op === 'update') {
        const keys = Object.keys(this.payload),
          offset = this.values.length;
        values = [...this.values, ...Object.values(this.payload)];
        query =
          'update ' +
          this.table +
          ' set ' +
          keys.map((k, i) => k + '=$' + (offset + i + 1)).join(',') +
          (this.filters.length ? ' where ' + this.filters.join(' and ') : '') +
          ' returning ' +
          this.columns;
      } else
        query =
          'select ' +
          this.columns +
          ' from ' +
          this.table +
          (this.filters.length ? ' where ' + this.filters.join(' and ') : '');
      const result = await db.query(query, values);
      return { data: single ? result.rows[0] || null : result.rows, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }
  single() {
    return this.execute(true);
  }
  maybeSingle() {
    return this.execute(true);
  }
  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}
const adapter = {
  from: (table) => new Query(table),
  async rpc(name, args) {
    assert.equal(name, 'delete_customer_personal_data_complete');
    try {
      const result = await db.query(
        'select delete_customer_personal_data_complete($1,$2,$3) result',
        [args.p_customer_id, args.p_deleted_phone, args.p_request_id],
      );
      return { data: result.rows[0].result, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};
function loadActualPrivacyService() {
  const configPath = project + '/src/config/supabase.js',
    cached = new Module(configPath);
  cached.exports = { supabase: adapter };
  cached.loaded = true;
  require.cache[configPath] = cached;
  return requireProject(project + '/src/services/privacy.service.js');
}
async function run() {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    alter default privileges in schema public grant all on tables to service_role;
    create table settings(key text primary key,value text);
    create table customers(id uuid primary key,name text,balance numeric default 0,total_spent numeric default 0,updated_at timestamptz,
      phone text,last_name text,email text,birth_date date,gender text,region text,telegram_id text,fcm_token text,
      preferred_language text,tags text[] default '{}',deleted_at timestamptz,created_at timestamptz default now());
    create table bulka_locations(id uuid primary key,name text);
    create table kaspi_orders(id uuid primary key,customer_id uuid,amount numeric,branch_id uuid,status text,partially_refunded_amount numeric default 0,
      phone text,additional_phone text,fulfillment_type text,delivery_address jsonb,delivery_latitude numeric,delivery_longitude numeric,
      comment text,qr_token text,updated_at timestamptz,fulfillment_status text,refund_status text);
    create table loyalty_reservations(id uuid primary key,customer_id uuid,order_total numeric,discount_amount numeric default 0,
      status text,committed_at timestamptz,pos_branch_id uuid,expires_at timestamptz default now()+interval '1 day');
    create table transactions(id uuid default gen_random_uuid(),customer_id uuid,order_id text,type text,amount numeric,description text,branch_id uuid);`);
  const suite = sql('20260715090000_commerce_operations_suite.sql');
  await db.exec(
    suite.slice(
      suite.indexOf('create table if not exists public.referral_codes'),
      suite.indexOf('create table if not exists public.targeted_promotions'),
    ),
  );
  for (const file of [
    '20260927010000_referral_links_first_purchase.sql',
    '20260927120000_referral_controls.sql',
    '20260929100000_referral_unlimited_device_owner.sql',
    '20260930120000_referral_stable_device.sql',
    '20261001010000_referral_device_history_permissions.sql',
  ])
    await db.exec(sql(file));
  await db.query("update settings set value=$1 where key='bonus_referral'", [
    JSON.stringify({
      enabled: true,
      inviter_bonus: 1000,
      friend_bonus: 500,
      min_first_order: 0,
      max_invites_per_day: 0,
      max_rewards_per_month: 0,
      max_reward_amount_per_month: 0,
    }),
  ]);

  // Empty ancillary tables make the real complete privacy-deletion RPC executable.
  for (const table of [
    'promotion_redemptions',
    'order_reviews',
    'customer_credentials',
    'customer_refresh_tokens',
    'customer_addresses',
    'customer_favorites',
    'customer_recent_products',
    'customer_cart_snapshots',
    'customer_notifications',
    'customer_app_events',
    'marketing_deliveries',
    'customer_push_tokens',
    'customer_notification_preferences',
    'customer_live_activity_tokens',
    'customer_support_requests',
    'inventory_reservations',
    'fulfillment_slot_reservations',
    'customer_payment_method_setups',
    'customer_payment_methods',
    'promotion_reservations',
    'gift_card_transactions',
    'payment_receipts',
  ]) {
    await db.exec('create table ' + table + '(id uuid,customer_id uuid)');
  }
  await db.exec(`create table whatsapp_conversations(customer_id uuid,phone text,chat_jid text);
    create table whatsapp_outbox(customer_id uuid,chat_jid text);
    create table targeted_promotions(customer_ids uuid[]);
    create table gift_cards(purchaser_customer_id uuid,recipient_customer_id uuid,recipient_name text,message text);
    create table customer_privacy_requests(id uuid default gen_random_uuid(),customer_id uuid,request_type text,status text,export_payload jsonb,
      export_expires_at timestamptz,payload_purged_at timestamptz,completed_at timestamptz,error text);`);
  await db.exec(`alter table customer_support_requests add column attachments jsonb;
    alter table whatsapp_outbox add column payload jsonb;
    create table personal_accounts(customer_id uuid,balance_minor bigint,blocked boolean);
    create table personal_account_topups(customer_id uuid,status text);
    create table family_members(id uuid,group_id uuid,customer_id uuid,status text,blocked boolean,auth_version integer,qr_version integer,updated_at timestamptz);
    create table family_groups(id uuid,owner_customer_id uuid);
    create table family_invitations(group_id uuid,recipient_customer_id uuid,status text,answered_at timestamptz);
    create table family_audit(group_id uuid,actor_customer_id uuid,member_id uuid,action text,details jsonb);`);
  await db.exec(
    extractFunction(sql('20260912090000_personal_account.sql'), 'personal_account_customer_guard'),
  );
  await db.exec(
    'create trigger personal_account_customer_deletion before update of deleted_at on customers for each row execute function personal_account_customer_guard()',
  );
  await db.exec(
    extractFunction(sql('20261002171000_family_pos_wallet.sql'), 'family_revoke_deleted_customer'),
  );
  await db.exec(
    'create trigger family_customer_deleted after update of deleted_at on customers for each row execute function family_revoke_deleted_customer()',
  );
  await db.exec(
    extractFunction(
      sql('20260726120000_privacy_lifecycle_hardening.sql'),
      'delete_customer_personal_data',
    ),
  );
  await db.exec(
    extractFunction(
      sql('20260729120000_privacy_payment_method_lifecycle.sql'),
      'delete_customer_personal_data_complete',
    ),
  );

  await db.exec(sql('20261004103000_referral_reward_privacy_ledger.sql'));
  const baseline = await fixture();
  await db.query("update kaspi_orders set status='refunded' where id=$1", [baseline.order]);
  const baselineResult = (
    await db.query('select reverse_referral_purchase($1) result', [baseline.friend])
  ).rows[0].result;
  assert.equal(baselineResult.status, 'reversed');
  assert.equal(await balance(baseline.friend), 0);

  const f = await fixture();
  const ownerBonusBeforeDeletion = await balance(f.owner);
  assert.equal(ownerBonusBeforeDeletion, 1000);
  const { deleteCustomerData } = loadActualPrivacyService();
  const deletion = await deleteCustomerData(f.owner, { db: adapter });
  assert.equal(deletion, true);
  assert.ok(
    (await db.query('select deleted_at from customers where id=$1', [f.owner])).rows[0].deleted_at,
  );
  assert.equal(await balance(f.friend), 500);
  const redemptions = Number(
    (
      await db.query('select count(*) n from referral_redemptions where referred_customer_id=$1', [
        f.friend,
      ])
    ).rows[0].n,
  );
  assert.equal(redemptions, 0);
  await db.query("update kaspi_orders set status='refunded' where id=$1", [f.order]);
  const firstPurchase = (
    await db.query(
      'select state,amount,refunded_amount from referral_first_purchases where customer_id=$1',
      [f.friend],
    )
  ).rows[0];
  const reversal = (await db.query('select reverse_referral_purchase($1) result', [f.friend]))
    .rows[0].result;
  assert.equal(Number(firstPurchase.refunded_amount), 2000);
  assert.equal(reversal.status, 'reversed');
  assert.equal(await balance(f.friend), 0);
  assert.equal(
    (await db.query('select reverse_referral_purchase($1) result', [f.friend])).rows[0].result
      .status,
    'unchanged',
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) n from referral_events where customer_id=$1 and kind='reversal'",
          [f.friend],
        )
      ).rows[0].n,
    ),
    1,
  );
  const held = await fixture();
  await deleteCustomerData(held.owner, { db: adapter });
  await db.query('update customers set balance=100 where id=$1', [held.friend]);
  await db.query(
    "insert into loyalty_reservations(id,customer_id,discount_amount,status,expires_at) values($1,$2,50,'active','infinity')",
    [randomUUID(), held.friend],
  );
  await db.query("update kaspi_orders set status='refunded' where id=$1", [held.order]);
  assert.equal(
    (await db.query('select reverse_referral_purchase($1) result', [held.friend])).rows[0].result
      .status,
    'reversed',
  );
  const debt = (
    await db.query('select balance,referral_bonus_debt from customers where id=$1', [held.friend])
  ).rows[0];
  assert.equal(Number(debt.balance), 50);
  assert.equal(Number(debt.referral_bonus_debt), 450);
  const deletedOwner = (
    await db.query('select balance,referral_bonus_debt from customers where id=$1', [held.owner])
  ).rows[0];
  assert.equal(Number(deletedOwner.balance), 0);
  assert.equal(Number(deletedOwner.referral_bonus_debt), 0);
  assert.equal(
    (await db.query('select reverse_referral_purchase($1) result', [held.friend])).rows[0].result
      .status,
    'unchanged',
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) n from referral_events where customer_id=$1 and kind='reversal'",
          [held.friend],
        )
      ).rows[0].n,
    ),
    1,
  );
  const guardCustomer = randomUUID();
  await db.query('insert into customers(id,balance,phone) values($1,1000,$2)', [
    guardCustomer,
    '+77750000003',
  ]);
  await db.query(
    'insert into personal_accounts(customer_id,balance_minor,blocked) values($1,100000,false)',
    [guardCustomer],
  );
  await assert.rejects(
    deleteCustomerData(guardCustomer, { db: adapter }),
    /personal account has unsettled funds/,
  );
  assert.equal(
    (await db.query('select deleted_at from customers where id=$1', [guardCustomer])).rows[0]
      .deleted_at,
    null,
  );
  console.log(
    JSON.stringify({
      baselineRefund: baselineResult.status,
      baselineFriendBalance: await balance(baseline.friend),
      realPrivacyServiceDeletion: deletion,
      ownerBonusBeforeDeletion,
      personalFunds: 0,
      personalMoneyDeletionControl: 'blocked',
      remainingRedemptionRows: redemptions,
      firstPurchase,
      refundAfterOwnerDeletion: reversal.status,
      friendBalanceAfterFullRefund: await balance(f.friend),
    }),
  );
}
require('node:test')(
  'real privacy deletion preserves durable referral reversals and cash deletion guards',
  async () => {
    try {
      await run();
    } finally {
      await db.close();
    }
  },
);

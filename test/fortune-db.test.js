const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
const branch = randomUUID(),
  otherBranch = randomUUID(),
  customer = randomUUID(),
  otherCustomer = randomUUID();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const migration = readFileSync('supabase/migrations/20261011170000_fortune_wheel.sql', 'utf8');
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.bulka_locations(id uuid primary key,name text,active boolean);
    create table public.customers(id uuid primary key,balance numeric not null default 0,deleted_at timestamptz,updated_at timestamptz);
    create table public.transactions(id uuid primary key default gen_random_uuid(),customer_id uuid,order_id text,type text,amount numeric,
      description text,available_at timestamptz,activated_at timestamptz,timestamp timestamptz default now());`);
  await db.exec(migration);
  await db.query("insert into bulka_locations values($1,'Main',true),($2,'Other',true)", [
    branch,
    otherBranch,
  ]);
  await db.query('insert into customers(id) values($1),($2)', [customer, otherCustomer]);
});
test.after(() => db.close());
const prize = (kind, weight, stock = null) => ({
  id: randomUUID(),
  label: kind === 'none' ? 'Next time' : kind,
  color: '#ffbf28',
  kind,
  weight,
  stockLimit: stock,
  validityDays: 7,
  active: true,
  bonusAmount: kind === 'bonus' ? 100 : null,
});
function config(prizes = [prize('gift', 90, 1), prize('none', 10)]) {
  return {
    title: 'Fortune QA',
    status: 'active',
    branchIds: [branch],
    startsAt: null,
    endsAt: null,
    minReceiptAmount: 100,
    maxReceiptAgeHours: 24,
    prizes,
  };
}
async function rpc(name, args) {
  return (
    await db.query(
      `select ${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) result`,
      args,
    )
  ).rows[0].result;
}
const save = (cfg, id = null, version = null) => rpc('fortune_save_campaign', [id, version, cfg]);
async function proof(
  campaign,
  {
    guest = randomUUID(),
    sale = randomUUID(),
    identity = `fiscal:${randomUUID()}`,
    receipt = null,
    branchId = branch,
  } = {},
) {
  const token = hash(randomUUID()),
    guestHash = hash(guest),
    id = randomUUID();
  const row = await rpc('fortune_verify_receipt', [
    id,
    token,
    guestHash,
    campaign.id,
    branchId,
    'iiko-qa',
    sale,
    identity,
    receipt || { closedAt: new Date().toISOString(), total: 1000, number: '387' },
  ]);
  return { row, token, guestHash, claimHash: hash(randomUUID()), drawId: randomUUID() };
}
const spin = (value, random = 0) =>
  rpc('fortune_spin', [value.token, value.guestHash, value.drawId, value.claimHash, random]);
const claim = (value, id = customer) => rpc('fortune_claim', [value.claimHash, id]);

test('stock is reserved at spin, concurrent attempts cannot oversell, repeat does not consume stock', async () => {
  const campaign = await save(config());
  const a = await proof(campaign),
    b = await proof(campaign);
  const [first, second] = await Promise.all([spin(a), spin(b)]);
  assert.equal(first.prize_snapshot.kind, 'gift');
  assert.equal(second.prize_snapshot.kind, 'none');
  assert.equal(first.status, 'pending');
  assert.equal(first.prize_snapshot.stockLimit, undefined);
  assert.equal(first.prize_snapshot.weight, undefined);
  assert.ok(
    first.wheel_snapshot.every(
      (sector) => Object.keys(sector).sort().join(',') === 'color,id,label',
    ),
  );
  const again = await spin(a, 0.999);
  assert.equal(again.id, first.id);
  assert.equal(again.repeated, true);
  assert.deepEqual(again.wheel_snapshot, first.wheel_snapshot);
  const count = (
    await db.query('select count(*)::int n from fortune_draws where campaign_id=$1', [campaign.id])
  ).rows[0].n;
  assert.equal(count, 2);
});
test('one fiscal sale cannot spin again with another guest or another campaign, both unique identities guard aliases', async () => {
  const firstCampaign = await save(config()),
    secondCampaign = await save(config());
  const first = await proof(firstCampaign);
  await spin(first);
  const sameSale = await proof(secondCampaign, { sale: first.row.sale_guid });
  await assert.rejects(spin(sameSale), /FORTUNE_RECEIPT_USED/);
  const sameFiscal = await proof(firstCampaign, { identity: first.row.receipt_identity });
  await assert.rejects(spin(sameFiscal), /FORTUNE_RECEIPT_USED/);
  await assert.rejects(
    rpc('fortune_spin', [first.token, hash('attacker'), randomUUID(), hash('new'), 0]),
    /FORTUNE_RECEIPT_INVALID/,
  );
});
test('account binding is idempotent, cannot transfer to another customer and does not extend expiry', async () => {
  const campaign = await save(config()),
    p = await proof(campaign),
    draw = await spin(p);
  const first = await claim(p),
    again = await claim(p);
  assert.equal(first.status, 'claimed');
  assert.equal(again.id, first.id);
  assert.equal(first.expires_at, draw.expires_at);
  await assert.rejects(claim(p, otherCustomer), /FORTUNE_CLAIM_INVALID/);
});
test('bonus redemption credits the balance and transaction once, with immutable winning amount', async () => {
  const cfg = config([prize('bonus', 90), prize('none', 10)]),
    campaign = await save(cfg),
    p = await proof(campaign);
  const draw = await spin(p);
  await claim(p);
  cfg.prizes[0].bonusAmount = 500;
  cfg.prizes[0].label = 'Edited prize';
  await save(cfg, campaign.id, campaign.version);
  const before = Number(
    (await db.query('select balance from customers where id=$1', [customer])).rows[0].balance,
  );
  const [first, again] = await Promise.all([
    rpc('fortune_redeem_bonus', [draw.id, customer]),
    rpc('fortune_redeem_bonus', [draw.id, customer]),
  ]);
  assert.equal(Number(first.balance), before + 100);
  assert.equal(Number(again.balance), before + 100);
  assert.equal(first.repeated, false);
  assert.equal(again.repeated, true);
  assert.equal(
    (
      await db.query('select count(*)::int n from transactions where order_id=$1', [
        `FORTUNE-${draw.id}`,
      ])
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    rpc('fortune_redeem_bonus', [draw.id, otherCustomer]),
    /FORTUNE_CLAIM_INVALID/,
  );
});
test('expired vouchers reject new claim and redemption; redeemed retries remain idempotent', async () => {
  const campaign = await save(config([prize('bonus', 90), prize('none', 10)])),
    p = await proof(campaign),
    draw = await spin(p);
  await db.query(
    "update fortune_draws set won_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",
    [draw.id],
  );
  await assert.rejects(claim(p), /FORTUNE_EXPIRED/);
  const another = await proof(campaign),
    second = await spin(another);
  await claim(another);
  await db.query(
    "update fortune_draws set won_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",
    [second.id],
  );
  await assert.rejects(rpc('fortune_redeem_bonus', [second.id, customer]), /FORTUNE_EXPIRED/);
});
test('staff gift redemption checks claimed account and allowed branch, and cannot double issue', async () => {
  const campaign = await save(config()),
    p = await proof(campaign),
    draw = await spin(p);
  await assert.rejects(
    rpc('fortune_redeem_gift', [draw.id, [branch], 'cashier']),
    /FORTUNE_CLAIM_INVALID/,
  );
  await claim(p);
  await assert.rejects(
    rpc('fortune_redeem_gift', [draw.id, [otherBranch], 'cashier']),
    /FORTUNE_FORBIDDEN/,
  );
  const first = await rpc('fortune_redeem_gift', [draw.id, [branch], 'cashier']);
  const again = await rpc('fortune_redeem_gift', [draw.id, [branch], 'cashier']);
  assert.equal(first.status, 'redeemed');
  assert.equal(first.redeemed_by, 'cashier');
  assert.equal(again.repeated, true);
});
test('expected version prevents conflicting saves; issued prize ids/caps are protected and counts are read-only', async () => {
  const cfg = config(),
    campaign = await save(cfg),
    p = await proof(campaign);
  await spin(p);
  await assert.rejects(save(cfg, campaign.id, 0), /FORTUNE_VERSION_CONFLICT/);
  cfg.prizes[0].stockLimit = 0;
  await assert.rejects(save(cfg, campaign.id, 1), /FORTUNE_CONFIG_INVALID/);
  cfg.prizes[0].stockLimit = 10;
  cfg.prizes[0].issuedCount = 999999;
  const updated = await save(cfg, campaign.id, 1);
  assert.equal(updated.config.prizes[0].issuedCount, 1);
  assert.equal(updated.version, 2);
  const raw = (await db.query('select config from fortune_campaigns where id=$1', [campaign.id]))
    .rows[0].config;
  assert.equal(raw.prizes[0].issuedCount, undefined);
  cfg.prizes = [cfg.prizes[1]];
  cfg.status = 'draft';
  await assert.rejects(save(cfg, campaign.id, 2), /FORTUNE_CONFIG_INVALID/);
});
test('branch, receipt age/minimum and proof TTL remain enforced at spin time', async () => {
  const cfg = config(),
    campaign = await save(cfg);
  await assert.rejects(proof(campaign, { branchId: otherBranch }), /FORTUNE_UNAVAILABLE/);
  await assert.rejects(
    proof(campaign, { receipt: { closedAt: new Date().toISOString(), total: 10 } }),
    /FORTUNE_RECEIPT_INVALID/,
  );
  await assert.rejects(
    proof(campaign, {
      receipt: { closedAt: new Date(Date.now() - 25 * 3600000).toISOString(), total: 1000 },
    }),
    /FORTUNE_RECEIPT_INVALID/,
  );
  const p = await proof(campaign);
  await db.query(
    "update fortune_receipt_proofs set verified_at=now()-interval '1 hour',expires_at=now()-interval '30 minutes' where id=$1",
    [p.row.id],
  );
  await assert.rejects(spin(p), /FORTUNE_EXPIRED/);
  const current = await proof(campaign);
  cfg.minReceiptAmount = 2000;
  await save(cfg, campaign.id, 1);
  await assert.rejects(spin(current), /FORTUNE_RECEIPT_INVALID/);
});
test('probabilities require 100% and unlimited no-prize fallback; zero/random boundaries are deterministic', async () => {
  const invalid = config();
  invalid.prizes[0].weight = 60;
  await assert.rejects(save(invalid), /FORTUNE_CONFIG_INVALID/);
  invalid.prizes = [prize('gift', 100, 1)];
  await assert.rejects(save(invalid), /FORTUNE_CONFIG_INVALID/);
  const campaign = await save(config()),
    a = await proof(campaign),
    b = await proof(campaign);
  assert.equal((await spin(a, 0.9)).prize_snapshot.kind, 'none');
  await assert.rejects(spin(b, 1), /FORTUNE_CONFIG_INVALID/);
  await assert.rejects(spin(b, -0.1), /FORTUNE_CONFIG_INVALID/);
  assert.equal((await spin(b, 0)).prize_snapshot.kind, 'gift');
});
test('public roles cannot inspect private campaign odds, insert winners or execute reward RPCs', async () => {
  const permissions = (
    await db.query(`select
    has_table_privilege('anon','fortune_campaigns','select') anon_read,
    has_table_privilege('authenticated','fortune_draws','insert') customer_write,
    has_table_privilege('service_role','fortune_draws','update') backend_write,
    has_function_privilege('anon','fortune_spin(text,text,uuid,text,numeric)','execute') anon_spin,
    has_function_privilege('authenticated','fortune_redeem_bonus(uuid,uuid)','execute') customer_bonus,
    has_function_privilege('service_role','fortune_redeem_bonus(uuid,uuid)','execute') backend_bonus,
    has_function_privilege('anon','fortune_campaign_list()','execute') anon_campaigns,
    has_function_privilege('authenticated','fortune_campaign_list()','execute') customer_campaigns,
    has_function_privilege('service_role','fortune_campaign_list()','execute') backend_campaigns`)
  ).rows[0];
  assert.deepEqual(permissions, {
    anon_read: false,
    customer_write: false,
    backend_write: false,
    anon_spin: false,
    customer_bonus: false,
    backend_bonus: true,
    anon_campaigns: false,
    customer_campaigns: false,
    backend_campaigns: true,
  });
});

test('bulk campaign list includes reserved counts and no-prize outcomes cannot bind to an account', async () => {
  const campaign = await save(config()),
    giftProof = await proof(campaign),
    noneProof = await proof(campaign);
  const gift = await spin(giftProof),
    none = await spin(noneProof);
  assert.equal(none.prize_snapshot.kind, 'none');
  await assert.rejects(claim(noneProof), /FORTUNE_CLAIM_INVALID/);
  const rows = await rpc('fortune_campaign_list', []),
    listed = rows.find((row) => row.id === campaign.id);
  assert.ok(rows.length <= 100);
  assert.equal(listed.config.prizes.find((prize) => prize.id === gift.prize_id).issuedCount, 1);
  assert.equal(listed.config.prizes.find((prize) => prize.id === none.prize_id).issuedCount, 1);
});

test('missing configuration fields, invalid active-sector counts and null branch scopes fail closed', async () => {
  const incomplete = config();
  delete incomplete.prizes[0].weight;
  await assert.rejects(save(incomplete), /FORTUNE_CONFIG_INVALID/);
  const oneActive = config([prize('none', 100), { ...prize('gift', 0), active: false }]);
  await assert.rejects(save(oneActive), /FORTUNE_CONFIG_INVALID/);
  const campaign = await save(config()),
    p = await proof(campaign),
    draw = await spin(p);
  await claim(p);
  await assert.rejects(
    rpc('fortune_redeem_gift', [draw.id, [null], 'cashier']),
    /FORTUNE_FORBIDDEN/,
  );
});

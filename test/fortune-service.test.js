require('./test-env.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createFortuneService } = require('../src/services/fortune.service');
const { createFortuneAdminService } = require('../src/services/fortune-admin.service');
const { hash, opaqueToken, claimToken } = require('../src/services/fortune-common');

const branchId = randomUUID(),
  campaignId = randomUUID(),
  customerId = randomUUID(),
  drawId = randomUUID();
const branches = [{ id: branchId, name: '19а ЖК Жасыл дала', city: 'Актау', active: true }];
const config = () => ({
  title: 'Подарки',
  status: 'active',
  branchIds: [branchId],
  startsAt: null,
  endsAt: null,
  minReceiptAmount: 100,
  maxReceiptAgeHours: 25,
  prizes: [
    {
      id: randomUUID(),
      label: 'Круассан',
      color: '#ffbf28',
      kind: 'gift',
      weight: 90,
      stockLimit: 10,
      issuedCount: 1,
      validityDays: 7,
      active: true,
      bonusAmount: null,
    },
    {
      id: randomUUID(),
      label: 'Следующий раз',
      color: '#f5e4c3',
      kind: 'none',
      weight: 10,
      stockLimit: null,
      issuedCount: 0,
      validityDays: 1,
      active: true,
      bonusAmount: null,
    },
  ],
});
const campaign = () => ({
  id: campaignId,
  title: 'Подарки',
  status: 'active',
  branch_ids: [branchId],
  config: config(),
  version: 2,
});
const draw = (guestHash, customer = null) => ({
  id: drawId,
  campaign_id: campaignId,
  branch_id: branchId,
  proof_id: randomUUID(),
  server_id: 'aktau-chain',
  sale_guid: randomUUID(),
  receipt_identity: hash('fiscal'),
  guest_hash: guestHash,
  claim_hash: hash('private-claim'),
  prize_id: randomUUID(),
  prize_snapshot: {
    id: randomUUID(),
    label: 'Круассан',
    color: '#ffbf28',
    kind: 'gift',
    bonusAmount: null,
    validityDays: 7,
  },
  wheel_snapshot: [{ id: randomUUID(), label: 'Круассан', color: '#ffbf28' }],
  receipt: { number: '100070', total: 180, closedAt: new Date().toISOString() },
  status: customer ? 'claimed' : 'pending',
  customer_id: customer,
  won_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  claimed_at: customer ? new Date().toISOString() : null,
  redeemed_at: null,
});
function database(tables = {}, handler = async () => null) {
  const queries = [],
    calls = [];
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.options = {};
      queries.push(this);
    }
    select(columns, options) {
      this.columns = columns;
      this.options = options || {};
      return this;
    }
    eq(key, value) {
      this.filters.push(['eq', key, value]);
      return this;
    }
    neq(key, value) {
      this.filters.push(['neq', key, value]);
      return this;
    }
    gt(key, value) {
      this.filters.push(['gt', key, value]);
      return this;
    }
    lte(key, value) {
      this.filters.push(['lte', key, value]);
      return this;
    }
    order(key, options) {
      this.sort = [key, options];
      return this;
    }
    limit(value) {
      this.limitValue = value;
      return this;
    }
    range(from, to) {
      this.rangeValue = [from, to];
      return this;
    }
    maybeSingle() {
      this.single = true;
      return this;
    }
    then(resolve, reject) {
      let rows = (tables[this.table] || []).filter((row) =>
        this.filters.every(([op, key, value]) =>
          op === 'eq'
            ? row[key] === value
            : op === 'neq'
              ? row[key] !== value
              : op === 'gt'
                ? row[key] > value
                : row[key] <= value,
        ),
      );
      const count = rows.length;
      if (this.limitValue) rows = rows.slice(0, this.limitValue);
      if (this.rangeValue) rows = rows.slice(this.rangeValue[0], this.rangeValue[1] + 1);
      return Promise.resolve({
        data: this.single ? rows[0] || null : rows,
        count,
        error: null,
      }).then(resolve, reject);
    }
  }
  return {
    queries,
    calls,
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: await handler(name, args), error: null };
    },
  };
}
const privateKeys = [
  'claim_hash',
  'token_hash',
  'guest_hash',
  'receipt_identity',
  'sale_guid',
  'server_id',
  'proof_id',
  'weight',
  'stockLimit',
  'issuedCount',
];
function privateFree(value) {
  const json = JSON.stringify(value);
  for (const key of privateKeys)
    assert.ok(!json.includes(`"${key}"`), `Private field ${key} must not leak`);
}

test('public wheel returns a whitelist and rejects paused/wrong branch before receipt verification', async () => {
  const row = campaign(),
    db = database({ fortune_campaigns: [row] });
  const service = createFortuneService({ db, locations: async () => branches });
  const result = await service.wheel(campaignId, branchId);
  privateFree(result);
  assert.deepEqual(Object.keys(result.campaign.prizes[0]).sort(), ['color', 'id', 'label']);
  await assert.rejects(service.wheel(campaignId, randomUUID()), { code: 'FORTUNE_UNAVAILABLE' });
  row.status = 'paused';
  await assert.rejects(service.wheel(campaignId, branchId), { code: 'FORTUNE_UNAVAILABLE' });
});
test('verified receipt proof binds campaign and guest, hashes opaque token and never returns fiscal internals', async () => {
  let verifyInput;
  const canonical = {
    branchId,
    serverId: 'aktau-chain',
    saleGuid: randomUUID(),
    receiptIdentity: hash('fiscal'),
    closedAt: new Date().toISOString(),
    total: 180,
    fiscalSign: '12345',
    registrationNumber: '123456789012',
  };
  const db = database({ fortune_campaigns: [campaign()] }, async (name, args) => {
    assert.equal(name, 'fortune_verify_receipt');
    return { id: args.p_id };
  });
  const service = createFortuneService({
    db,
    locations: async () => branches,
    verifyReceipt: async (input) => {
      verifyInput = input;
      return canonical;
    },
  });
  const image = Buffer.from('synthetic-image'),
    guestHash = hash('guest');
  const result = await service.receipt(campaignId, branchId, guestHash, image);
  assert.equal(verifyInput.image, image);
  assert.equal(verifyInput.maxAgeDays, 2);
  assert.match(result.receiptToken, /^[A-Za-z0-9_-]{43}$/);
  privateFree(result);
  const args = db.calls[0].args;
  assert.equal(args.p_token_hash, hash(result.receiptToken));
  assert.equal(args.p_guest_hash, guestHash);
  assert.equal(args.p_campaign_id, campaignId);
  assert.equal(args.p_branch_id, branchId);
  assert.equal(args.p_receipt.number, '12345');
  assert.equal(args.p_server_id, canonical.serverId);
  assert.equal(JSON.stringify(args).includes(result.receiptToken), false);
});
test('receipt source mismatches, nonfinite sums and stale timestamps cannot create eligible proofs', async () => {
  const base = {
    branchId,
    serverId: 'aktau-chain',
    saleGuid: randomUUID(),
    receiptIdentity: hash('fiscal'),
    closedAt: new Date().toISOString(),
    total: 180,
  };
  for (const patch of [
    { branchId: randomUUID() },
    { total: NaN },
    { total: 99 },
    { closedAt: new Date(Date.now() - 26 * 3600000).toISOString() },
  ]) {
    const db = database({ fortune_campaigns: [campaign()] });
    const service = createFortuneService({
      db,
      locations: async () => branches,
      verifyReceipt: async () => ({ ...base, ...patch }),
    });
    await assert.rejects(service.receipt(campaignId, branchId, hash('guest'), Buffer.from('x')), {
      code: 'FORTUNE_RECEIPT_INVALID',
    });
    assert.equal(db.calls.length, 0);
  }
});
test('spin proof is bound to exact QR URL and guest; retries regenerate original winning claim token', async () => {
  const receiptToken = opaqueToken(),
    guestHash = hash('guest'),
    proofs = [
      {
        campaign_id: campaignId,
        branch_id: branchId,
        token_hash: hash(receiptToken),
        guest_hash: guestHash,
        receipt_identity: hash('fiscal'),
        receipt: { total: 180 },
        expires_at: new Date(Date.now() + 1800000).toISOString(),
      },
    ];
  let won,
    verified = 0;
  const draws = [];
  const db = database(
    { fortune_receipt_proofs: proofs, fortune_draws: draws, fortune_campaigns: [campaign()] },
    async (name, args) => {
      assert.equal(name, 'fortune_spin');
      assert.ok(args.p_random >= 0 && args.p_random < 1);
      assert.equal(args.p_guest_hash, guestHash);
      assert.equal(args.p_proof_token_hash, hash(receiptToken));
      assert.equal(args.p_claim_hash, hash(claimToken(args.p_draw_id, guestHash)));
      if (!won) {
        won = { ...draw(guestHash), id: args.p_draw_id, claim_hash: args.p_claim_hash };
        draws.push(won);
      }
      return won;
    },
  );
  const service = createFortuneService({
    db,
    locations: async () => branches,
    revalidateReceipt: async (input) => {
      assert.equal(input.receipt, proofs[0].receipt);
      assert.equal(input.branchId, branchId);
      assert.equal(input.maxAgeDays, 2);
      verified++;
    },
  });
  await assert.rejects(service.spin(randomUUID(), branchId, guestHash, receiptToken), {
    code: 'FORTUNE_RECEIPT_INVALID',
  });
  await assert.rejects(service.spin(campaignId, randomUUID(), guestHash, receiptToken), {
    code: 'FORTUNE_RECEIPT_INVALID',
  });
  await assert.rejects(service.spin(campaignId, branchId, hash('another'), receiptToken), {
    code: 'FORTUNE_RECEIPT_INVALID',
  });
  assert.equal(db.calls.length, 0);
  const first = await service.spin(campaignId, branchId, guestHash, receiptToken),
    again = await service.spin(campaignId, branchId, guestHash, receiptToken);
  assert.equal(first.claimToken, again.claimToken);
  assert.equal(first.claimToken, claimToken(first.win.id, guestHash));
  assert.notEqual(db.calls[0].args.p_draw_id, db.calls[1].args.p_draw_id);
  assert.equal(verified, 1);
  privateFree(first);
  privateFree(again);
});
test('account list and claim expose only owned vouchers; claim passes authenticated customer id', async () => {
  const guestHash = hash('guest'),
    row = draw(guestHash, customerId),
    token = opaqueToken();
  const db = database(
    { fortune_draws: [row, draw(guestHash, randomUUID())] },
    async (name, args) => {
      assert.equal(name, 'fortune_claim');
      assert.deepEqual(args, { p_claim_hash: hash(token), p_customer_id: customerId });
      return row;
    },
  );
  const service = createFortuneService({ db, locations: async () => branches });
  const listed = await service.list(customerId);
  assert.equal(listed.items.length, 1);
  privateFree(listed);
  const claimed = await service.claim(customerId, token);
  assert.equal(claimed.prize.redemptionCode, row.id);
  privateFree(claimed);
});

test('new spins reject cancellation and expired proof before reserving stock; existing outcomes survive those changes', async () => {
  const receiptToken = opaqueToken(),
    guestHash = hash('guest');
  const proof = {
    campaign_id: campaignId,
    branch_id: branchId,
    token_hash: hash(receiptToken),
    guest_hash: guestHash,
    receipt_identity: hash('fiscal'),
    receipt: { total: 180 },
    expires_at: new Date(Date.now() + 1800000).toISOString(),
  };
  const tables = {
    fortune_receipt_proofs: [proof],
    fortune_campaigns: [campaign()],
    fortune_draws: [],
  };
  const db = database(tables, async () => draw(guestHash));
  let checked = 0;
  const service = createFortuneService({
    db,
    locations: async () => branches,
    revalidateReceipt: async () => {
      checked++;
      throw Object.assign(new Error('Cancelled'), { code: 'FORTUNE_RECEIPT_NOT_FOUND' });
    },
  });
  await assert.rejects(service.spin(campaignId, branchId, guestHash, receiptToken), {
    code: 'FORTUNE_RECEIPT_NOT_FOUND',
  });
  assert.equal(checked, 1);
  assert.equal(db.calls.length, 0);
  proof.expires_at = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(service.spin(campaignId, branchId, guestHash, receiptToken), {
    code: 'FORTUNE_EXPIRED',
  });
  assert.equal(checked, 1);
  assert.equal(db.calls.length, 0);
  tables.fortune_campaigns[0].status = 'paused';
  tables.fortune_draws.push(draw(guestHash));
  const result = await service.spin(campaignId, branchId, guestHash, receiptToken);
  assert.equal(result.win.id, drawId);
  assert.equal(checked, 1);
  assert.equal(db.calls.length, 1);
});
test('bonus redemption succeeds when the normal loyalty queue returns void', async () => {
  const row = {
    ...draw(hash('guest'), customerId),
    status: 'redeemed',
    prize_snapshot: { kind: 'bonus', label: '100 бонусов', bonusAmount: 100 },
    redeemed_at: new Date().toISOString(),
  };
  let synced;
  const db = database({}, async (name, args) => {
    assert.equal(name, 'fortune_redeem_bonus');
    assert.deepEqual(args, { p_draw_id: row.id, p_customer_id: customerId });
    return { ...row, balance: 250 };
  });
  const service = createFortuneService({
    db,
    locations: async () => branches,
    sync: (id) => {
      synced = id;
    },
  });
  const result = await service.redeemBonus(customerId, row.id);
  assert.equal(result.balance, 250);
  assert.equal(synced, customerId);
  privateFree(result);
});

test('no-prize outcomes have no claim token and preserve the actual immutable wheel snapshot', async () => {
  const receiptToken = opaqueToken(),
    guestHash = hash('guest'),
    row = draw(guestHash);
  row.prize_snapshot.kind = 'none';
  const db = database(
    {
      fortune_draws: [row],
      fortune_receipt_proofs: [
        {
          campaign_id: campaignId,
          branch_id: branchId,
          token_hash: hash(receiptToken),
          guest_hash: guestHash,
          receipt_identity: row.receipt_identity,
        },
      ],
    },
    async () => row,
  );
  const result = await createFortuneService({ db }).spin(
    campaignId,
    branchId,
    guestHash,
    receiptToken,
  );
  assert.equal(result.claimToken, undefined);
  assert.deepEqual(result.wheel, row.wheel_snapshot);
  privateFree(result);
});

test('admin bulk list uses one RPC; staff voucher lookup hides fiscal and customer contact data and enforces branch scope', async () => {
  const row = campaign(),
    won = {
      ...draw(hash('guest'), customerId),
      customers: { name: 'Алия', phone: '+77770000000' },
    };
  const db = database({ fortune_draws: [won] }, async (name) => {
    assert.equal(name, 'fortune_campaign_list');
    return [row];
  });
  const service = createFortuneAdminService({ db, locations: async () => branches });
  const listed = await service.list({ role: 'owner' });
  assert.equal(listed.campaigns[0].id, campaignId);
  assert.equal(db.calls.length, 1);
  assert.equal(db.queries.length, 0);
  const result = await service.voucher({ role: 'cashier', branchIds: [branchId] }, won.id);
  assert.equal(result.voucher.customerName, 'Алия');
  privateFree(result);
  assert.equal(result.voucher.customerPhone, undefined);
  assert.equal(result.voucher.receiptNumber, undefined);
  assert.equal(result.voucher.receiptTotal, undefined);
  await assert.rejects(service.voucher({ role: 'cashier', branchIds: [randomUUID()] }, won.id), {
    code: 'FORTUNE_CLAIM_INVALID',
  });
  await assert.rejects(service.voucher({ role: 'cashier', branchIds: [] }, won.id), {
    code: 'FORTUNE_CLAIM_INVALID',
  });
  await assert.rejects(service.voucher({ role: 'marketer', branchIds: [branchId] }, won.id), {
    code: 'FORTUNE_FORBIDDEN',
  });
});
test('admin management uses expected revision and refuses unrelated roles; staff redemption is narrowly scoped', async () => {
  const row = campaign(),
    won = draw(hash('guest'), customerId);
  const db = database({ fortune_campaigns: [row] }, async (name, args) => {
    if (name === 'fortune_save_campaign') return { ...row, config: args.p_config, version: 3 };
    if (name === 'fortune_redeem_gift')
      return { ...won, status: 'redeemed', redeemed_at: new Date().toISOString() };
    return row;
  });
  const service = createFortuneAdminService({ db, locations: async () => branches });
  for (const role of ['viewer', 'marketer', 'cashier', 'branch_manager'])
    await assert.rejects(service.list({ role }), { code: 'FORTUNE_FORBIDDEN' });
  const edited = config();
  delete edited.prizes[0].id;
  const result = await service.save({ role: 'owner' }, row.id, { ...edited, expectedVersion: 2 });
  assert.equal(result.campaign.version, 3);
  assert.equal(db.calls[0].args.p_expected_version, 2);
  assert.equal(db.calls[0].args.p_config.expectedVersion, undefined);
  assert.match(db.calls[0].args.p_config.prizes[0].id, /^[0-9a-f-]{36}$/);
  await service.redeem({ role: 'cashier', username: 'cashier-qa', branchIds: [branchId] }, won.id);
  assert.deepEqual(db.calls.at(-1), {
    name: 'fortune_redeem_gift',
    args: { p_draw_id: won.id, p_branches: [branchId], p_actor: 'cashier-qa' },
  });
  await service.redeem({ role: 'cashier', username: 'unassigned', branchIds: [] }, won.id);
  assert.deepEqual(db.calls.at(-1).args.p_branches, ['00000000-0000-0000-0000-000000000000']);
  await assert.rejects(service.redeem({ role: 'marketer' }, won.id), { code: 'FORTUNE_FORBIDDEN' });
});
